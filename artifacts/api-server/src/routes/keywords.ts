import { Router, type IRouter, type Request, type Response } from "express";
import { GenerateKeywordsBody, GenerateKeywordsResponse } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  getProductInfoByAsin,
  isValidAsin,
  searchCompetitorAsins,
} from "../lib/amazon";

const router: IRouter = Router();

const MAX_BATCH = 15;
const CONCURRENCY = 5;

const SYSTEM_PROMPT = `You are a senior Amazon PPC expert focused on maximizing conversions and sales for an experienced Amazon seller.

Your task is to generate ONLY the highest-quality, most-converting Amazon ad keywords. Quality > quantity philosophy. Every single keyword must be one a serious PPC manager would bid on with their own money.

STEP 1: Understand the product
- Identify product type, sub-category, main use-case, and target audience
- Identify buying intent triggers (budget, premium, durability, daily use, etc.)
- Identify the key product attributes shoppers actually search for

STEP 2: Generate EXACTLY 30 keywords divided into 3 groups:

1. High Intent (10 keywords)
- Strong buying intent, ready-to-buy shoppers
- 2-4 words only
- Style: "best <product>", "<feature> <product>", "<size> <product>" — natural Amazon search behavior
- AVOID generic words like "buy", "cheap", "deal", "sale" unless extremely natural

2. Core Keywords (10 keywords)
- Main product keywords used by Amazon shoppers
- STRICT: 3 words preferred. 2 words allowed ONLY when 3 words would be unnatural. NEVER more than 3 words.
- Highly relevant, commonly searched, conversion-oriented

3. Long-Tail Keywords (10 keywords)
- Specific but NOT too long
- STRICT: 3-5 words only
- Must include use-case, feature, audience, or context (e.g. "for travel", "for gym", "with lid")
- Should feel like real Amazon search terms shoppers type

STRICT QUALITY BAR — REJECT ANY KEYWORD THAT:
- Is longer than 5 words or shorter than 2 words
- Is a single word
- Is a near-duplicate of another keyword (same root + filler word)
- Contains the user's brand name
- Is irrelevant to the actual product
- Is unnatural, sentence-like, or stuffed
- Is too broad (e.g. "products", "items", "things")
- Mentions an unrelated product
- Includes adult, medical, prescription, or restricted terms unless the product itself is in that category
- Is misspelled

After drafting, RE-READ each keyword and silently delete any that fail the bar above. Then replace deletions with stronger alternatives so each group has exactly 10. Final list must be 30 unique, top-tier keywords.

Also output ONE short Amazon search query (2-4 words) that would surface the strongest direct competitor listings for this product. This will be used to fetch real competitor ASINs from Amazon search. Choose the query that maximizes finding products in the same sub-category and price tier.

OUTPUT FORMAT (STRICT JSON ONLY, no markdown, no commentary):

{
  "keywords": [
    {"type": "High Intent", "value": "keyword"},
    {"type": "Core", "value": "keyword"},
    {"type": "Long Tail", "value": "keyword"}
  ],
  "competitor_search_query": "short amazon search query"
}`;

interface LlmOutput {
  keywords: Array<{ type: string; value: string }>;
  competitor_search_query?: string;
}

interface BatchItem {
  asin?: string;
  title: string;
  detectedBrand?: string | null;
  keywords: Array<{ type: "High Intent" | "Core" | "Long Tail"; value: string }>;
  competitor_asins: string[];
  error?: string;
}

function buildUserPrompt(input: {
  title: string;
  brand?: string | null;
  category?: string | null;
  priceRange?: string | null;
}): string {
  const lines: string[] = [`Product Title: ${input.title}`];
  if (input.brand) lines.push(`Brand (exclude from keywords): ${input.brand}`);
  if (input.category) lines.push(`Category: ${input.category}`);
  if (input.priceRange) lines.push(`Price Range: ${input.priceRange}`);
  lines.push("");
  lines.push("Return ONLY the JSON described in the system instructions. No prose.");
  return lines.join("\n");
}

async function generateForOne(
  asin: string | undefined,
  title: string,
  brand: string | null | undefined,
  category: string | null | undefined,
  priceRange: string | null | undefined,
): Promise<BatchItem> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 4096,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: buildUserPrompt({ title, brand, category, priceRange }),
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content ?? "";
  if (!content) throw new Error("AI returned empty content");

  const raw = JSON.parse(content) as LlmOutput;
  if (!Array.isArray(raw.keywords) || raw.keywords.length === 0) {
    throw new Error("AI returned no keywords");
  }

  // Filter brand-containing keywords as a safety net
  const brandLower = brand?.trim().toLowerCase();
  const brandTokens = brandLower
    ? brandLower.split(/\s+/).filter((t) => t.length >= 3)
    : [];
  const cleanedKeywords = raw.keywords.filter((k) => {
    if (!k?.value) return false;
    const v = k.value.toLowerCase();
    if (brandTokens.length && brandTokens.some((tok) => v.includes(tok))) return false;
    return true;
  });

  const searchQuery = raw.competitor_search_query?.trim() || title;
  let competitorAsins: string[] = [];
  try {
    competitorAsins = await searchCompetitorAsins(searchQuery, {
      limit: 5,
      excludeAsin: asin,
      excludeBrand: brand,
    });
  } catch {
    competitorAsins = [];
  }

  return {
    asin,
    title,
    detectedBrand: brand ?? null,
    keywords: cleanedKeywords as BatchItem["keywords"],
    competitor_asins: competitorAsins,
  };
}

async function processInPool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = CONCURRENCY,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

router.post("/keywords/generate", async (req: Request, res: Response) => {
  const parsed = GenerateKeywordsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: " + parsed.error.message });
    return;
  }

  const input = parsed.data;
  const inputAsins = (input.asins ?? [])
    .map((a) => a?.trim().toUpperCase() ?? "")
    .filter((a) => a.length > 0);
  const rawTitle = input.title?.trim() ?? "";

  if (inputAsins.length === 0 && !rawTitle) {
    res.status(400).json({ error: "Provide at least one ASIN, or a product title." });
    return;
  }

  if (inputAsins.length > MAX_BATCH) {
    res.status(400).json({ error: `Too many ASINs. Max ${MAX_BATCH} per request.` });
    return;
  }

  const invalid = inputAsins.filter((a) => !isValidAsin(a));
  if (invalid.length > 0) {
    res.status(400).json({
      error: `Invalid ASIN(s): ${invalid.join(", ")}. ASINs must be 10 chars, start with B0.`,
    });
    return;
  }

  try {
    let items: BatchItem[];

    if (inputAsins.length > 0) {
      items = await processInPool(inputAsins, async (asin): Promise<BatchItem> => {
        try {
          const info = await getProductInfoByAsin(asin);
          if (!info) {
            return {
              asin,
              title: "",
              keywords: [],
              competitor_asins: [],
              error: `Could not find Amazon product page for ${asin}.`,
            };
          }
          const brand = input.brand?.trim() || info.brand || null;
          return await generateForOne(
            asin,
            info.title,
            brand,
            input.category,
            input.priceRange,
          );
        } catch (err) {
          req.log.warn({ err, asin }, "Item failed");
          const message = err instanceof Error ? err.message : "Unknown error";
          return {
            asin,
            title: "",
            keywords: [],
            competitor_asins: [],
            error: message,
          };
        }
      });
    } else {
      const single = await generateForOne(
        undefined,
        rawTitle,
        input.brand,
        input.category,
        input.priceRange,
      );
      items = [single];
    }

    const payload = { items };
    const validated = GenerateKeywordsResponse.safeParse(payload);
    if (!validated.success) {
      req.log.error({ payload, error: validated.error }, "Output failed validation");
      res.status(500).json({ error: "Generation output failed validation" });
      return;
    }
    res.json(validated.data);
  } catch (err) {
    req.log.error({ err }, "Keyword generation failed");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Generation failed: ${message}` });
  }
});

router.get("/asin/lookup", async (req: Request, res: Response) => {
  const asinRaw = typeof req.query.asin === "string" ? req.query.asin.trim().toUpperCase() : "";
  if (!asinRaw) {
    res.status(400).json({ error: "Missing 'asin' query parameter." });
    return;
  }
  if (!isValidAsin(asinRaw)) {
    res.status(400).json({ error: "ASIN must be 10 characters and start with B0." });
    return;
  }
  try {
    const info = await getProductInfoByAsin(asinRaw);
    if (!info) {
      res.status(404).json({ error: `No Amazon page found for ASIN ${asinRaw}.` });
      return;
    }
    res.json({ asin: asinRaw, title: info.title, brand: info.brand });
  } catch (err) {
    req.log.error({ err, asin: asinRaw }, "ASIN lookup failed");
    res.status(502).json({ error: "Could not reach Amazon. Try again." });
  }
});

export default router;
