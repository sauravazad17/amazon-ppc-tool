const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
};

export const ASIN_REGEX = /^B0[A-Z0-9]{8}$/;

export function isValidAsin(value: string): boolean {
  return ASIN_REGEX.test(value.trim().toUpperCase());
}

async function fetchAmazon(url: string, timeoutMs = 12_000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: COMMON_HEADERS,
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`Amazon returned HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export async function getProductTitleByAsin(asin: string): Promise<string | null> {
  const clean = asin.trim().toUpperCase();
  if (!isValidAsin(clean)) return null;
  const html = await fetchAmazon(`https://www.amazon.com/dp/${clean}`);

  const productTitleMatch = html.match(
    /id="productTitle"[^>]*>([\s\S]*?)<\/span>/i,
  );
  if (productTitleMatch?.[1]) {
    const title = decodeEntities(productTitleMatch[1]).replace(/\s+/g, " ").trim();
    if (title) return title;
  }

  const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTagMatch?.[1]) {
    const cleaned = decodeEntities(titleTagMatch[1])
      .replace(/Amazon\.com\s*[:\-]?\s*/i, "")
      .replace(/\s*[:\-]\s*Amazon\.com.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned && !/Robot Check|captcha/i.test(cleaned)) {
      return cleaned;
    }
  }

  return null;
}

export async function searchCompetitorAsins(
  query: string,
  limit = 5,
  excludeAsin?: string,
): Promise<string[]> {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&ref=nb_sb_noss`;
  const html = await fetchAmazon(url);

  const exclude = excludeAsin?.toUpperCase();
  const seen = new Set<string>();
  const results: string[] = [];

  const re = /data-asin="(B0[A-Z0-9]{8})"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const asin = match[1];
    if (!asin || seen.has(asin)) continue;
    if (exclude && asin === exclude) continue;
    seen.add(asin);
    results.push(asin);
    if (results.length >= limit) break;
  }

  return results;
}
