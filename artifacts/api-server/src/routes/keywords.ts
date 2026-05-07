import { Router, type IRouter, type Request, type Response } from "express";
import { GenerateKeywordsBody, GenerateKeywordsResponse } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  brandFromTitle,
  brandsMatch,
  getFullProductInfoByAsin,
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

interface CompetitorTarget {
  asin: string;
  title: string;
  image: string | null;
  price: number | null;
  rating: number | null;
  category: "higher_price" | "lower_rating";
}

interface BatchItem {
  asin?: string;
  title: string;
  image?: string | null;
  price?: number | null;
  rating?: number | null;
  detectedBrand?: string | null;
  analysis?: {
    coreProduct: string;
    attributes: string[];
    useCase?: string | null;
    audience?: string | null;
  };
  keywords: Array<{ type: "High Intent" | "Core" | "Long Tail"; value: string }>;
  competitor_targets: CompetitorTarget[];
  error?: string;
}

interface EnrichedHit extends SearchHit {
  actualBrand: string | null;
  actualTitle: string;
  actualImage: string | null;
  actualPrice: number | null;
  actualRating: number | null;
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
 * Fetch full product data for the top N candidates using throttled concurrency (4 at a time)
 * to avoid Amazon bot detection. Returns enriched hits with brand, title, image, price, rating.
 */
async function enrichCompetitorData(
  candidates: SearchHit[],
  limit: number,
): Promise<EnrichedHit[]> {
  const top = candidates.slice(0, limit);
  const results: EnrichedHit[] = [];
  const BATCH = 4;

  for (let i = 0; i < top.length; i += BATCH) {
    const batch = top.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (c): Promise<EnrichedHit> => {
        const info = await getFullProductInfoByAsin(c.asin);
        return {
          ...c,
          actualBrand: info?.brand ?? brandFromTitle(c.title),
          actualTitle: info?.title ?? c.title,
          actualImage: info?.image ?? c.searchImage ?? null,
          // Use product-page value, but fall back to search-result value so we never
          // discard a valid price/rating that was already scraped from search results
          actualPrice: info?.price ?? c.searchPrice ?? null,
          actualRating: info?.rating ?? c.searchRating ?? null,
        };
      }),
    );
    results.push(...batchResults);
    // Small pause between batches to reduce rate-limiting risk
    if (i + BATCH < top.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return results;
}

/**
 * From the LLM-approved (or heuristic) pool, build two target buckets:
 * - higher_price: up to 5 competitors priced above userPrice (or best available)
 * - lower_rating: up to 5 competitors rated below userRating (or best available)
 * Each bucket picks from the FULL pool independently with its own usedAsins set,
 * so ASINs never repeat within a bucket but each bucket tries its best to fill to 5.
 * Brand diversity: max 2 ASINs per brand per bucket.
 */
function buildTargetBuckets(
  orderedPool: EnrichedHit[],
  userPrice: number | null,
  userRating: number | null,
): CompetitorTarget[] {
  const results: CompetitorTarget[] = [];

  const pickBucket = (
    category: "higher_price" | "lower_rating",
    primaryFilter: (c: EnrichedHit) => boolean,
    scoreHit: (c: EnrichedHit) => number,
  ) => {
    // Each bucket gets its own independent tracking
    const usedAsins = new Set<string>();
    const usedBrands = new Map<string, number>();

    const fill = (pool: EnrichedHit[]) => {
      const sorted = [...pool]
        .filter((c) => !usedAsins.has(c.asin))
        .sort((a, b) => scoreHit(b) - scoreHit(a));
      for (const c of sorted) {
        if (results.filter((r) => r.category === category).length >= 5) break;
        const brand = normalizeBrand(c.actualBrand ?? "") || `__${c.asin}`;
        const brandCount = usedBrands.get(brand) ?? 0;
        if (brandCount >= 2) continue;
        results.push({ asin: c.asin, title: c.actualTitle, image: c.actualImage, price: c.actualPrice, rating: c.actualRating, category });
        usedAsins.add(c.asin);
        usedBrands.set(brand, brandCount + 1);
      }
    };

    // Pass 1: strict filter (higher price or lower rating)
    fill(orderedPool.filter(primaryFilter));

    // Pass 2: if still < 5, relax and use entire pool (any candidate with relevant data)
    if (results.filter((r) => r.category === category).length < 5) {
      const hasData = category === "higher_price"
        ? (c: EnrichedHit) => c.actualPrice != null
        : (c: EnrichedHit) => c.actualRating != null;
      fill(orderedPool.filter(hasData));
    }

    // Pass 3: last resort — any candidate regardless of price/rating availability
    if (results.filter((r) => r.category === category).length < 5) {
      fill(orderedPool);
    }
  };

  // Higher price bucket
  pickBucket(
    "higher_price",
    (c) => c.actualPrice != null && (userPrice == null || c.actualPrice > userPrice),
    (c) => {
      let score = 0;
      if (c.actualBrand) score += 10;
      if (c.actualPrice != null && userPrice != null) {
        // Prefer competitors slightly above user price (not 10x more expensive)
        const diff = c.actualPrice - userPrice;
        if (diff > 0) score += Math.max(0, 60 - diff * 3);
      } else if (c.actualPrice != null) {
        score += 30;
      }
      return score;
    },
  );

  // Lower rating bucket
  pickBucket(
    "lower_rating",
    (c) => c.actualRating != null && (userRating == null || c.actualRating < userRating),
    (c) => {
      let score = 0;
      if (c.actualBrand) score += 10;
      if (c.actualRating != null && userRating != null) {
        // Prefer competitors with rating just below user (close comparison)
        const diff = userRating - c.actualRating;
        if (diff > 0) score += Math.max(0, 60 - diff * 15);
      } else if (c.actualRating != null) {
        score += 30;
      }
      return score;
    },
  );

  return results;
}

async function pickAndBuildTargets(
  enriched: EnrichedHit[],
  userTitle: string,
  userBrand: string | null,
  coreProduct: string,
  attributes: string[],
  userPrice: number | null,
  userRating: number | null,
): Promise<CompetitorTarget[]> {
  // Hard-exclude user's brand
  const safeBrandPool = enriched.filter((c) => {
    if (!userBrand) return true;
    if (brandsMatch(userBrand, c.actualBrand)) return false;
    const normUser = normalizeBrand(userBrand);
    if (normUser.length >= 4 && normalizeBrand(c.actualTitle).includes(normUser)) return false;
    return true;
  });

  if (safeBrandPool.length === 0) return [];

  // Heuristic ordering: brand-diverse pool for small candidate sets
  const heuristicOrdered = (): EnrichedHit[] => {
    const ordered: EnrichedHit[] = [];
    const brandCount = new Map<string, number>();
    for (const c of safeBrandPool) {
      const key = normalizeBrand(c.actualBrand ?? "") || `__${ordered.length}`;
      const count = brandCount.get(key) ?? 0;
      if (count >= 2) continue;
      brandCount.set(key, count + 1);
      ordered.push(c);
    }
    // Add remaining for fallback
    safeBrandPool.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });
    return ordered;
  };

  const queryHints = [coreProduct, ...attributes].join(" ").trim();

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
            // Send all safe candidates to the LLM — let it judge relevance
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
      .filter((a): a is string => !!a && safeMap.has(a))
      .filter((a) => {
        const hit = safeMap.get(a);
        return !userBrand || !brandsMatch(userBrand, hit?.actualBrand ?? null);
      });

    // Build ordered pool: LLM picks first, then remaining safe pool for fallback
    const llmSet = new Set(llmPicks);
    const orderedPool: EnrichedHit[] = [
      ...llmPicks.map(a => safeMap.get(a)).filter((c): c is EnrichedHit => !!c),
      ...safeBrandPool.filter(c => !llmSet.has(c.asin)),
    ];

    return buildTargetBuckets(orderedPool, userPrice, userRating);
  } catch {
    return buildTargetBuckets(heuristicOrdered(), userPrice, userRating);
  }
}

async function generateForOne(
  asin: string | undefined,
  title: string,
  brand: string | null | undefined,
  image: string | null | undefined,
  userPrice: number | null | undefined,
  userRating: number | null | undefined,
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

  // Build search query list: most-specific → most-generic.
  // We run ALL queries and merge unique hits for the biggest possible candidate pool.
  const queryCandidates = Array.from(
    new Set(
      [
        raw.competitor_search_query?.trim(),
        analysis?.coreProduct?.trim(),
        analysis?.coreProduct && analysis.attributes?.[0]
          ? `${analysis.attributes[0]} ${analysis.coreProduct}`
          : null,
        title?.split(/\s*[-–—,(|]\s*/)[0]?.trim(),
        // Fallback: first 3 words of title (broad)
        title?.split(/\s+/).slice(0, 3).join(" ").trim(),
      ].filter((q): q is string => !!q && q.length >= 3),
    ),
  );

  let competitorTargets: CompetitorTarget[] = [];

  // Collect from ALL queries (default + price-desc) and merge unique hits
  const seenAsins = new Set<string>();
  const allHits: SearchHit[] = [];

  const addHits = (hits: SearchHit[]) => {
    for (const h of hits) {
      if (!seenAsins.has(h.asin)) {
        seenAsins.add(h.asin);
        allHits.push(h);
      }
    }
  };

  // Run default-sort searches across all query candidates
  await Promise.allSettled(
    queryCandidates.map(async (q) => {
      try {
        const hits = await searchCompetitorHits(q, {
          limit: 25,
          excludeAsin: asin,
          excludeBrand: userBrand,
        });
        addHits(hits);
      } catch { /* ignore */ }
    }),
  );

  // Also run price-desc on best query for higher-price candidates
  if (queryCandidates[0]) {
    try {
      const hpHits = await searchCompetitorHits(queryCandidates[0], {
        limit: 20,
        excludeAsin: asin,
        excludeBrand: userBrand,
        sortBy: "price-desc",
      });
      addHits(hpHits);
    } catch { /* ignore */ }
  }

  if (allHits.length > 0) {
    try {
      // Fetch full product data for up to 30 candidates
      const enriched = await enrichCompetitorData(allHits, 30);
      competitorTargets = await pickAndBuildTargets(
        enriched,
        title,
        userBrand,
        analysis?.coreProduct || queryCandidates[0] || title,
        analysis?.attributes ?? [],
        userPrice ?? null,
        userRating ?? null,
      );
    } catch {
      competitorTargets = [];
    }
  }

  return {
    asin,
    title,
    image: image ?? null,
    price: userPrice ?? null,
    rating: userRating ?? null,
    detectedBrand: userBrand,
    analysis,
    keywords: cleanedKeywords as BatchItem["keywords"],
    competitor_targets: competitorTargets,
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
              competitor_targets: [],
              error: `Could not find Amazon product page for ${asin}.`,
            };
          }
          const brand = input.brand?.trim() || info.brand || null;
          return await generateForOne(
            asin,
            info.title,
            brand,
            info.image,
            info.price,
            info.rating,
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
            competitor_targets: [],
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
        null,
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
