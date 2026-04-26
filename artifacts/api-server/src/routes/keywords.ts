import { Router, type IRouter, type Request, type Response } from "express";
import { GenerateKeywordsBody, GenerateKeywordsResponse } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  getProductTitleByAsin,
  isValidAsin,
  searchCompetitorAsins,
} from "../lib/amazon";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are a senior Amazon PPC expert focused on maximizing conversions and sales.

Your task is to generate HIGH-CONVERTING Amazon ad keywords.

STEP 1: Understand the product
- Identify product type, main use-case, and target audience
- Identify buying intent triggers (budget, premium, durability, daily use, etc.)

STEP 2: Generate EXACTLY 30 keywords divided into:

1. High Intent (10 keywords)
- Strong buying intent
- 2-4 words only
- Example style: "buy wireless earbuds", "best office chair"

2. Core Keywords (10 keywords)
- Main product keywords used by Amazon shoppers
- STRICT: 3 words preferred. 2 words allowed only when 3 words would be unnatural. NEVER more than 3 words.
- Highly relevant and commonly searched

3. Long-Tail Keywords (10 keywords)
- Specific but NOT too long
- STRICT: 3-5 words only
- Must include use-case, feature, or audience
- Should feel like real Amazon search terms, not sentences

STRICT KEYWORD RULES:
- No keyword longer than 5 words
- No single-word keywords
- No repetition or slight variations
- No unnatural or sentence-like phrases
- Avoid very broad terms
- Focus on conversion, not just traffic

STEP 3: Self-check
- Remove weak or irrelevant keywords
- Ensure all keywords are natural and usable
- Ensure no duplication
- Ensure Core keyword word counts follow the strict rule above

Also output ONE short Amazon search query (2-4 words) that would surface the strongest direct competitor listings for this product. This will be used to fetch real competitor ASINs from Amazon search.

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

function buildUserPrompt(input: {
  title: string;
  brand?: string | null;
  category?: string | null;
  priceRange?: string | null;
}): string {
  const lines: string[] = [`Product Title: ${input.title}`];
  if (input.brand) lines.push(`Brand: ${input.brand}`);
  if (input.category) lines.push(`Category: ${input.category}`);
  if (input.priceRange) lines.push(`Price Range: ${input.priceRange}`);
  lines.push("");
  lines.push("Return ONLY the JSON described in the system instructions. No prose.");
  return lines.join("\n");
}

router.post("/keywords/generate", async (req: Request, res: Response) => {
  const parsed = GenerateKeywordsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: " + parsed.error.message });
    return;
  }

  const input = parsed.data;
  const rawTitle = input.title?.trim() ?? "";
  const rawAsin = input.asin?.trim().toUpperCase() ?? "";

  if (!rawTitle && !rawAsin) {
    res.status(400).json({ error: "Provide a product title or an ASIN." });
    return;
  }

  if (rawAsin && !isValidAsin(rawAsin)) {
    res.status(400).json({
      error: "ASIN must be 10 characters and start with B0 (e.g. B07FZ8S74R).",
    });
    return;
  }

  let title = rawTitle;
  if (!title && rawAsin) {
    try {
      const fetched = await getProductTitleByAsin(rawAsin);
      if (!fetched) {
        res.status(404).json({
          error: `Could not find an Amazon product page for ASIN ${rawAsin}.`,
        });
        return;
      }
      title = fetched;
    } catch (err) {
      req.log.error({ err, asin: rawAsin }, "ASIN lookup failed");
      res.status(502).json({
        error: "Could not reach Amazon to look up that ASIN. Try again or paste the title manually.",
      });
      return;
    }
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: buildUserPrompt({
            title,
            brand: input.brand,
            category: input.category,
            priceRange: input.priceRange,
          }),
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content ?? "";
    if (!content) {
      req.log.error("OpenAI returned empty content");
      res.status(500).json({ error: "Generation returned no content" });
      return;
    }

    let raw: LlmOutput;
    try {
      raw = JSON.parse(content) as LlmOutput;
    } catch (err) {
      req.log.error({ err, content }, "Failed to parse OpenAI JSON");
      res.status(500).json({ error: "Generation returned invalid JSON" });
      return;
    }

    if (!Array.isArray(raw.keywords) || raw.keywords.length === 0) {
      res.status(500).json({ error: "Generation returned no keywords" });
      return;
    }

    let competitorAsins: string[] = [];
    const searchQuery = raw.competitor_search_query?.trim() || title;
    try {
      competitorAsins = await searchCompetitorAsins(searchQuery, 5, rawAsin || undefined);
    } catch (err) {
      req.log.warn({ err }, "Competitor ASIN search failed; returning empty list");
    }

    const payload = {
      resolvedTitle: title,
      keywords: raw.keywords,
      competitor_asins: competitorAsins,
    };

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
    const title = await getProductTitleByAsin(asinRaw);
    if (!title) {
      res.status(404).json({ error: `No Amazon page found for ASIN ${asinRaw}.` });
      return;
    }
    res.json({ asin: asinRaw, title });
  } catch (err) {
    req.log.error({ err, asin: asinRaw }, "ASIN lookup failed");
    res.status(502).json({ error: "Could not reach Amazon. Try again." });
  }
});

export default router;
