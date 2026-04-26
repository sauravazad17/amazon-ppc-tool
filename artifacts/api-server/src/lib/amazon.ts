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

/**
 * Parse a free-form text blob (textarea content) into a deduped list of valid ASINs.
 * Accepts comma, space, newline, tab, semicolon separators. Strips amazon URLs like
 * https://www.amazon.com/dp/B0XXXXXXXX/...
 */
export function parseAsinList(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const tokens = input
    .toUpperCase()
    .replace(/HTTPS?:\/\/\S*?\/DP\/(B0[A-Z0-9]{8})\S*/g, " $1 ")
    .replace(/\/DP\/(B0[A-Z0-9]{8})/g, " $1 ")
    .split(/[\s,;|]+/);
  for (const t of tokens) {
    const cleaned = t.replace(/[^A-Z0-9]/g, "");
    if (isValidAsin(cleaned) && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
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

function cleanWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractTitleFromProductHtml(html: string): string | null {
  const productTitleMatch = html.match(
    /id="productTitle"[^>]*>([\s\S]*?)<\/span>/i,
  );
  if (productTitleMatch?.[1]) {
    const title = cleanWs(decodeEntities(productTitleMatch[1]));
    if (title) return title;
  }
  const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTagMatch?.[1]) {
    const cleaned = cleanWs(
      decodeEntities(titleTagMatch[1])
        .replace(/^Amazon\.com\s*[:\-]?\s*/i, "")
        .replace(/\s*[:\-]\s*Amazon\.com.*$/i, ""),
    );
    if (cleaned && !/Robot Check|captcha/i.test(cleaned)) return cleaned;
  }
  return null;
}

function extractBrandFromProductHtml(html: string): string | null {
  // bylineInfo: "Visit the X Store" or "Brand: X"
  const byline = html.match(/id="bylineInfo"[^>]*>([\s\S]*?)<\/a>/i);
  if (byline?.[1]) {
    const text = cleanWs(decodeEntities(byline[1].replace(/<[^>]+>/g, "")));
    let m = text.match(/^Visit the (.+?) Store$/i);
    if (m?.[1]) return cleanWs(m[1]);
    m = text.match(/^Brand:\s*(.+)$/i);
    if (m?.[1]) return cleanWs(m[1]);
    m = text.match(/^(.+?)\s+Store$/i);
    if (m?.[1]) return cleanWs(m[1]);
    if (text && text.length < 60) return text;
  }
  // Look for "Brand" row in product overview table
  const brandRow = html.match(
    /<tr[^>]*>\s*<td[^>]*>\s*<span[^>]*>\s*Brand\s*<\/span>\s*<\/td>\s*<td[^>]*>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/i,
  );
  if (brandRow?.[1]) return cleanWs(decodeEntities(brandRow[1]));
  return null;
}

export interface ProductInfo {
  title: string;
  brand: string | null;
}

export async function getProductInfoByAsin(
  asin: string,
): Promise<ProductInfo | null> {
  const clean = asin.trim().toUpperCase();
  if (!isValidAsin(clean)) return null;
  const html = await fetchAmazon(`https://www.amazon.com/dp/${clean}`);
  const title = extractTitleFromProductHtml(html);
  if (!title) return null;
  const brand = extractBrandFromProductHtml(html);
  return { title, brand };
}

export interface SearchHit {
  asin: string;
  title: string;
}

/**
 * Scrape Amazon search results page for ASIN + title pairs in the order they appear.
 * Strategy: find each unique ASIN occurrence, then look at a window of HTML around it
 * for the nearest title (h2 / aria-label / alt text).
 */
function parseSearchHits(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const re = /data-asin="(B0[A-Z0-9]{8})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const asin = m[1];
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);
    const start = m.index;
    const end = Math.min(html.length, start + 8000);
    const window = html.slice(start, end);

    let title = "";
    const h2 = window.match(
      /<h2[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/h2>/i,
    );
    if (h2?.[1]) {
      title = cleanWs(decodeEntities(h2[1].replace(/<[^>]+>/g, "")));
    }
    if (!title) {
      const aria = window.match(
        /aria-label="([^"]+)"[^>]*href="[^"]*\/dp\/B0[A-Z0-9]{8}/i,
      );
      if (aria?.[1]) title = cleanWs(decodeEntities(aria[1]));
    }
    if (!title) {
      const alt = window.match(/<img[^>]*alt="([^"]{20,})"/i);
      if (alt?.[1]) title = cleanWs(decodeEntities(alt[1]));
    }
    hits.push({ asin, title });
  }
  return hits;
}

/**
 * Search Amazon and return up to `limit` competitor ASINs whose title does NOT contain the
 * excluded brand. Also excludes excludeAsin itself.
 */
export async function searchCompetitorAsins(
  query: string,
  options: {
    limit?: number;
    excludeAsin?: string | null;
    excludeBrand?: string | null;
  } = {},
): Promise<string[]> {
  const limit = options.limit ?? 5;
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&ref=nb_sb_noss`;
  const html = await fetchAmazon(url);

  const exclude = options.excludeAsin?.toUpperCase();
  const brand = options.excludeBrand?.trim().toLowerCase();
  const brandTokens = brand
    ? brand.split(/\s+/).filter((t) => t.length >= 3)
    : [];

  const hits = parseSearchHits(html);
  const results: string[] = [];
  for (const hit of hits) {
    if (exclude && hit.asin === exclude) continue;
    if (brandTokens.length && hit.title) {
      const lowerTitle = hit.title.toLowerCase();
      const matches = brandTokens.some((tok) =>
        new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
          lowerTitle,
        ),
      );
      if (matches) continue;
    }
    results.push(hit.asin);
    if (results.length >= limit) break;
  }
  // If brand filtering left us short, top up with unfiltered (still excluding self) so user always gets some.
  if (results.length < limit) {
    for (const hit of hits) {
      if (results.includes(hit.asin)) continue;
      if (exclude && hit.asin === exclude) continue;
      results.push(hit.asin);
      if (results.length >= limit) break;
    }
  }
  return results;
}
