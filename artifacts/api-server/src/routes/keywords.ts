import { Router, type IRouter, type Request, type Response } from "express";
import { GenerateKeywordsBody, GenerateKeywordsResponse } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are a senior Amazon PPC expert focused on maximizing conversions and sales.

Your task is to generate HIGH-CONVERTING Amazon ad keywords and relevant competitor ASIN targets.

STEP 1: Understand the product
- Identify product type, main use-case, and target audience
- Identify buying intent triggers (budget, premium, durability, daily use, etc.)

STEP 2: Generate EXACTLY 30 keywords divided into:

1. High Intent (10 keywords)
- Strong buying intent
- 2-4 words only
- Example style: "buy wireless earbuds", "best office chair"

2. Core Keywords (10 keywords)
- Main product keywords
- 2-3 words preferred
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

STEP 3: Generate EXACTLY 5 competitor ASIN targets

RULES:
- Valid Amazon ASIN format (10 characters, starts with B0)
- Same category and use-case
- Realistic competing products
- Not accessories or unrelated items

STEP 4: Self-check
- Remove weak or irrelevant keywords
- Ensure all keywords are natural and usable
- Ensure no duplication
- Ensure ASINs look realistic

OUTPUT FORMAT (STRICT JSON ONLY, no markdown, no commentary):

{
  "keywords": [
    {"type": "High Intent", "value": "keyword"},
    {"type": "Core", "value": "keyword"},
    {"type": "Long Tail", "value": "keyword"}
  ],
  "competitor_asins": [
    "B0XXXXXXXX",
    "B0XXXXXXXX",
    "B0XXXXXXXX",
    "B0XXXXXXXX",
    "B0XXXXXXXX"
  ]
}`;

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

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content ?? "";
    if (!content) {
      req.log.error("OpenAI returned empty content");
      res.status(500).json({ error: "Generation returned no content" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch (err) {
      req.log.error({ err, content }, "Failed to parse OpenAI JSON");
      res.status(500).json({ error: "Generation returned invalid JSON" });
      return;
    }

    const validated = GenerateKeywordsResponse.safeParse(raw);
    if (!validated.success) {
      req.log.error({ raw, error: validated.error }, "Generation output failed validation");
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

export default router;
