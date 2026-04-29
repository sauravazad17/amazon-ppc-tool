import { Router, type IRouter, type Request, type Response } from "express";
import { GenerateKeywordsBody, GenerateKeywordsResponse } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  brandFromTitle,
  brandsMatch,
  getBrandByAsin,
  getProductInfoByAsin,
  isValidAsin,
  normalizeBrand,
  searchCompetitorHits,
  type SearchHit,
} from "../lib/amazon";

const router: IRouter = Router();

const MAX_BATCH = 15;
const CONCURRENCY = 5;
const MODEL = "gpt-5.4";

const SYSTEM_PROMPT = `You are a senior Amazon PPC expert with 10+ years optimizing campaigns for top sellers. You think like an Amazon shopper AND a conversion-focused PPC manager.

Your task: deeply understand a product, then generate ONLY the highest-converting Amazon ad keywords.

============================
STEP 1: DISTILL THE PRODUCT
============================
Amazon titles are long and SEO-stuffed. Your first job is to mentally strip the noise and identify what the product ACTUALLY is.

Extract the following:
- coreProduct: The 1-3 word universal product type a shopper would type in Amazon search. NOT the brand. NOT the variant. The category noun.
  Examples:
    "Oral-B Rechargeable Electric Toothbrush, iO5 Limited Deep Clean & Whiten, 5 Modes…" → "Electric Toothbrush"
    "Stanley Quencher H2.0 FlowState Stainless Steel Vacuum Insulated Tumbler 40oz Pink" → "Tumbler" (or "Insulated Tumbler")
    "Apple AirPods Pro (2nd Gen) Wireless Earbuds, Active Noise Cancelling…" → "Wireless Earbuds"
- attributes: 3-7 short tags pulled from the title that shoppers actually filter on. Examples: ["rechargeable", "5 modes", "pressure sensor", "travel case"], ["40oz", "stainless steel", "vacuum insulated", "pink"], ["noise cancelling", "spatial audio", "wireless", "iphone"].
- useCase: One short phrase: who uses it, when, why. e.g. "daily oral care at home and travel".
- audience: Who buys it. e.g. "adults wanting whiter teeth", "office workers", "gym-goers".

============================
STEP 2: GENERATE 30 KEYWORDS
============================
Now generate keywords using your distilled understanding. Anchor every keyword on the coreProduct + attributes you identified. Do NOT generate keywords about features that aren't in the title.

3 groups, EXACTLY 10 each:

1. **High Intent (10)** — strong buying intent, 2-4 words. These are searches by shoppers ready to buy a SPECIFIC kind of this product. Lead with the differentiating attribute, use case, audience, material, size, or category modifier — NOT with hype words. Examples for an Electric Toothbrush: "rechargeable electric toothbrush", "sonic toothbrush adults", "electric toothbrush travel case", "deep clean toothbrush", "5 mode toothbrush". Avoid generic fillers like "buy", "cheap", "deal", "amazing", "top rated".

2. **Core Keywords (10)** — main everyday search terms a shopper types. STRICT: 3 words preferred, 2 words allowed only when 3 would be unnatural. NEVER more than 3 words. Mostly noun-phrases describing the product itself (e.g. "electric toothbrush", "sonic toothbrush", "rechargeable toothbrush", "whitening toothbrush"). These should NOT lead with "best".

3. **Long-Tail Keywords (10)** — specific, intent-rich. STRICT: 3-5 words. Must include a specific use-case, attribute, audience, or scenario (e.g. "electric toothbrush for sensitive gums", "travel toothbrush with case", "rechargeable toothbrush for adults").

============================
THE "BEST..." RULE — VERY STRICT
============================
Most shoppers do NOT search "best <product>" — that's a Google query, not an Amazon query. Across ALL 30 keywords combined you may use the word "best" AT MOST 1 TIME, and only in the High Intent group. The first keyword of any group MUST NOT begin with "best". Vary your keyword starters: lead with attributes, sizes, materials, audiences, use cases, colors, certifications — anything specific to this product. If a keyword starts with "best" or "top", rewrite it.

============================
QUALITY BAR — REJECT KEYWORDS THAT:
============================
- Are longer than 5 words or shorter than 2 words
- Are single-word
- Are near-duplicates (same root + filler) — every keyword must add a NEW angle
- Contain the user's brand name in any form
- Mention features/attributes the product does NOT actually have (do not invent specs)
- Are unrelated to the coreProduct
- Are generic / meaningless ("products", "items", "things", "stuff", "online", "amazon")
- Sound unnatural, stuffed, or like a marketing tagline rather than a search query
- Are misspelled
- Mention an unrelated product category
- Lead with hype adjectives ("best", "top", "amazing", "ultimate", "premium" as the FIRST word)
- Repeat the same modifier across many keywords (don't put "professional" or "heavy duty" on 5 of them)

After drafting, RE-READ each keyword as if you were searching on Amazon. Ask: "Would a real shopper actually type this exact phrase?" If no, delete and replace. Each group must have EXACTLY 10 final keywords.

============================
STEP 3: COMPETITOR SEARCH QUERY
============================
Output ONE short Amazon search query (2-4 words) we'll use to fetch real competitor ASINs from Amazon. The query should:
- Use the coreProduct
- Add 1-2 differentiating attributes (size, type, material) so results match this product's tier
- NOT include the user's brand
- Feel like a natural Amazon search

Examples:
  Coreproduct "Electric Toothbrush" + attributes [rechargeable, 5 modes] → "rechargeable electric toothbrush"
  Coreproduct "Tumbler" + attributes [40oz, stainless steel] → "40 oz insulated tumbler"

============================
OUTPUT FORMAT (STRICT JSON):
============================
{
  "analysis": {
    "coreProduct": "string",
    "attributes": ["string", "string"],
    "useCase": "string",
    "audience": "string"
  },
  "keywords": [
    {"type": "High Intent", "value": "..."},
    {"type": "Core", "value": "..."},
    {"type": "Long Tail", "value": "..."}
  ],
  "competitor_search_query": "..."
}

No markdown. No commentary. Just JSON.`;

const COMPETITOR_PICK_PROMPT = `You are an Amazon PPC strategist picking up to 5 competitor ASINs for ad targeting.

You'll receive:
- The user's product (title + brand + core product type + key attributes)
- A list of candidate competing products with ASIN + title + verified brand

Pick the BEST competitors that satisfy ALL of these:
1. SIMILARITY FIRST — must be the SAME product type and tier as the user's product (same coreProduct AND share at least 1-2 of the user's key attributes like size, capacity, technology, audience). A different sub-category does NOT count even if same broad category. Example: if user sells a "rechargeable electric toothbrush", manual toothbrushes and water flossers DO NOT qualify.
2. NEVER from the user's brand. The verified brand is given for each candidate — if it equals or contains the user's brand, SKIP it.
3. Brand diversity: cover at least 3 DIFFERENT brands. No more than 2 ASINs from the same brand.
4. Real standalone products (no bundles, refills, accessories, replacement parts, cases, or unrelated items).
5. Prefer well-known direct competitor brands; if needed, include 1-2 strong alternative brands for diversity.

If fewer than 5 candidates meet ALL criteria, return fewer (3 or 4 is fine — quality over quantity).

Return strict JSON:
{
  "selected": ["B0XXXXXXXX", ...],
  "rationale_brands": ["BrandA", "BrandB", ...]
}
No markdown, no commentary.`;

interface LlmKeywordOutput {
  analysis?: {
    coreProduct?: string;
    attributes?: string[];
    useCase?: string;
    audience?: string;
  };
  keywords: Array<{ type: string; value: string }>;
  competitor_search_query?: string;
}

interface LlmCompetitorOutput {
  selected?: string[];
  rationale_brands?: string[];
}

interface BatchItem {
  asin?: string;
  title: string;
  image?: string | null;
  detectedBrand?: string | null;
  analysis?: {
    coreProduct: string;
    attributes: string[];
    useCase?: string | null;
    audience?: string | null;
  };
  keywords: Array<{ type: "High Intent" | "Core" | "Long Tail"; value: string }>;
  competitor_asins: string[];
  error?: string;
}

interface EnrichedHit extends SearchHit {
  actualBrand: string | null;
}

function buildKeywordPrompt(input: {
  title: string;
  brand?: string | null;
  category?: string | null;
  priceRange?: string | null;
}): string {
  const lines: string[] = [`Product Title: ${input.title}`];
  if (input.brand) lines.push(`Brand (exclude from keywords): ${input.brand}`);
  if (input.category) lines.push(`Category hint: ${input.category}`);
  if (input.priceRange) lines.push(`Price Range: ${input.priceRange}`);
  lines.push("", "Return ONLY the JSON described in the system instructions.");
  return lines.join("\n");
}

function buildCompetitorPickPrompt(args: {
  userTitle: string;
  userBrand: string | null;
  coreProduct: string;
  attributes: string[];
  candidates: EnrichedHit[];
}): string {
  const lines: string[] = [];
  lines.push(`User product title: ${args.userTitle}`);
  lines.push(`User brand: ${args.userBrand ?? "unknown"}`);
  lines.push(`Core product type: ${args.coreProduct}`);
  if (args.attributes.length) {
    lines.push(`Key attributes (must share at least 1-2 with picks): ${args.attributes.join(", ")}`);
  }
  lines.push("");
  lines.push("Candidates (ASIN | verified brand | title):");
  for (const c of args.candidates) {
    lines.push(`- ${c.asin} | ${c.actualBrand ?? "unknown"} | ${c.title || "(no title)"}`);
  }
  lines.push("");
  lines.push("Pick the strongest competitors per the rules. Up to 5. Return JSON only.");
  return lines.join("\n");
}

/**
 * For the top N candidates, fetch their actual brand from the product page in parallel.
 * Falls back to brandFromTitle if the fetch fails.
 */
async function enrichWithActualBrand(
  candidates: SearchHit[],
  limit: number,
): Promise<EnrichedHit[]> {
  const top = candidates.slice(0, limit);
  const enriched = await Promise.all(
    top.map(async (c): Promise<EnrichedHit> => {
      const brand = await getBrandByAsin(c.asin);
      return { ...c, actualBrand: brand ?? brandFromTitle(c.title) };
    }),
  );
  return enriched;
}

async function pickDiverseCompetitors(
  enriched: EnrichedHit[],
  userTitle: string,
  userBrand: string | null,
  coreProduct: string,
  attributes: string[],
): Promise<string[]> {
  // Drop any candidate that matches the user's brand (verified) — hard exclusion.
  const safeBrandPool = enriched.filter((c) => {
    if (!userBrand) return true;
    if (brandsMatch(userBrand, c.actualBrand)) return false;
    // Extra safety: substring of user brand inside title
    const normUser = normalizeBrand(userBrand);
    if (normUser.length >= 4 && normalizeBrand(c.title).includes(normUser)) return false;
    return true;
  });

  // Heuristic fallback: enforce max 2 per brand on the safe pool.
  const heuristic = (): string[] => {
    const selected: string[] = [];
    const brandCount = new Map<string, number>();
    for (const c of safeBrandPool) {
      if (selected.length >= 5) break;
      const key = normalizeBrand(c.actualBrand ?? "") || `__${selected.length}`;
      const count = brandCount.get(key) ?? 0;
      if (count >= 2) continue;
      brandCount.set(key, count + 1);
      selected.push(c.asin);
    }
    return selected;
  };

  if (safeBrandPool.length === 0) return [];
  if (safeBrandPool.length <= 3) return heuristic();

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: COMPETITOR_PICK_PROMPT },
        {
          role: "user",
          content: buildCompetitorPickPrompt({
            userTitle,
            userBrand,
            coreProduct,
            attributes,
            candidates: safeBrandPool,
          }),
        },
      ],
      response_format: { type: "json_object" },
    });
    const content = completion.choices[0]?.message?.content ?? "";
    const raw = JSON.parse(content) as LlmCompetitorOutput;
    const safeMap = new Map(safeBrandPool.map((c) => [c.asin, c]));
    const llmPicks = (raw.selected ?? [])
      .map((a) => a?.trim().toUpperCase())
      .filter((a): a is string => !!a && safeMap.has(a));

    // Final safety pass: enforce no-user-brand (already done) and max-2-per-brand on LLM picks
    const safe: string[] = [];
    const brandCount = new Map<string, number>();
    for (const asin of llmPicks) {
      const hit = safeMap.get(asin);
      if (!hit) continue;
      // Re-verify brand exclusion (paranoid)
      if (userBrand && brandsMatch(userBrand, hit.actualBrand)) continue;
      const key = normalizeBrand(hit.actualBrand ?? "") || `__${safe.length}`;
      const count = brandCount.get(key) ?? 0;
      if (count >= 2) continue;
      brandCount.set(key, count + 1);
      safe.push(asin);
      if (safe.length >= 5) break;
    }

    // Soft top-up: if LLM returned fewer than 5, fill from the safe brand pool while
    // still honoring max-2-per-brand. We only relax similarity here — never user-brand.
    if (safe.length < 5) {
      for (const c of safeBrandPool) {
        if (safe.length >= 5) break;
        if (safe.includes(c.asin)) continue;
        const key = normalizeBrand(c.actualBrand ?? "") || `__${safe.length}`;
        const count = brandCount.get(key) ?? 0;
        if (count >= 2) continue;
        brandCount.set(key, count + 1);
        safe.push(c.asin);
      }
    }

    return safe;
  } catch {
    return heuristic();
  }
}

async function generateForOne(
  asin: string | undefined,
  title: string,
  brand: string | null | undefined,
  image: string | null | undefined,
  category: string | null | undefined,
  priceRange: string | null | undefined,
): Promise<BatchItem> {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 4096,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: buildKeywordPrompt({ title, brand, category, priceRange }),
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content ?? "";
  if (!content) throw new Error("AI returned empty content");

  const raw = JSON.parse(content) as LlmKeywordOutput;
  if (!Array.isArray(raw.keywords) || raw.keywords.length === 0) {
    throw new Error("AI returned no keywords");
  }

  const analysis = raw.analysis
    ? {
        coreProduct: raw.analysis.coreProduct?.trim() || "Product",
        attributes: Array.isArray(raw.analysis.attributes)
          ? raw.analysis.attributes.map((a) => String(a)).filter(Boolean)
          : [],
        useCase: raw.analysis.useCase?.trim() || null,
        audience: raw.analysis.audience?.trim() || null,
      }
    : undefined;

  // Filter brand-containing keywords as a safety net (normalized substring)
  const userBrand = brand?.trim() || null;
  const brandNorm = userBrand ? normalizeBrand(userBrand) : "";
  const cleanedKeywords = raw.keywords.filter((k) => {
    if (!k?.value) return false;
    if (brandNorm && brandNorm.length >= 3) {
      const v = normalizeBrand(k.value);
      if (v.includes(brandNorm)) return false;
    }
    return true;
  });

  const searchQuery =
    raw.competitor_search_query?.trim() ||
    analysis?.coreProduct ||
    title;
  let competitorAsins: string[] = [];
  try {
    const candidates = await searchCompetitorHits(searchQuery, {
      limit: 20,
      excludeAsin: asin,
      excludeBrand: userBrand,
    });
    // Verify each top candidate's actual brand from its product page (parallel) so we
    // never accidentally include a same-brand competitor when the search-result title
    // doesn't lead with the brand name.
    const enriched = await enrichWithActualBrand(candidates, 12);
    competitorAsins = await pickDiverseCompetitors(
      enriched,
      title,
      userBrand,
      analysis?.coreProduct || searchQuery,
      analysis?.attributes ?? [],
    );
  } catch {
    competitorAsins = [];
  }

  return {
    asin,
    title,
    image: image ?? null,
    detectedBrand: userBrand,
    analysis,
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
            info.image,
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
        null,
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
