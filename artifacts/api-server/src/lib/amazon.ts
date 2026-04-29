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

function pickLargestFromDynamic(jsonText: string): string | null {
  try {
    const parsed = JSON.parse(jsonText) as Record<string, [number, number] | number[]>;
    let best: { url: string; area: number } | null = null;
    for (const [url, dims] of Object.entries(parsed)) {
      if (!Array.isArray(dims) || dims.length < 2) continue;
      const w = Number(dims[0]) || 0;
      const h = Number(dims[1]) || 0;
      const area = w * h;
      if (!best || area > best.area) best = { url, area };
    }
    return best?.url ?? null;
  } catch {
    return null;
  }
}

function extractImageFromProductHtml(html: string): string | null {
  // Try Open Graph image first
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return og[1];
  // colorImages JSON: "hiRes":"https://..." (highest res, present even when other fields missing)
  const hiResJson = html.match(/"hiRes"\s*:\s*"(https:\/\/[^"\s]+\.(?:jpg|jpeg|png|webp))"/i);
  if (hiResJson?.[1]) return hiResJson[1];
  // data-old-hires anywhere on the landingImage tag (attribute order in HTML may vary)
  const hires = html.match(/data-old-hires="(https:\/\/[^"]+)"/i);
  if (hires?.[1]) return hires[1];
  // data-a-dynamic-image JSON: pick the largest variant
  const dyn = html.match(/id="landingImage"[^>]*data-a-dynamic-image="([^"]+)"/i)
          ?? html.match(/data-a-dynamic-image="([^"]+)"[^>]*id="landingImage"/i)
          ?? html.match(/data-a-dynamic-image="([^"]+)"/i);
  if (dyn?.[1]) {
    const decoded = decodeEntities(dyn[1]);
    const best = pickLargestFromDynamic(decoded);
    if (best) return best;
  }
  // landingImage src fallback
  const src = html.match(/id="landingImage"[^>]*src="(https:\/\/[^"]+)"/i)
          ?? html.match(/src="(https:\/\/[^"]+)"[^>]*id="landingImage"/i);
  if (src?.[1]) return src[1];
  // imgBlkFront (legacy book/media layout)
  const imgBlk = html.match(/id="imgBlkFront"[^>]*src="(https:\/\/[^"]+)"/i)
              ?? html.match(/src="(https:\/\/[^"]+)"[^>]*id="imgBlkFront"/i);
  if (imgBlk?.[1]) return imgBlk[1];
  // main-image-container fallback
  const mainImg = html.match(/id="main-image"[^>]*src="(https:\/\/[^"]+)"/i)
               ?? html.match(/src="(https:\/\/[^"]+)"[^>]*id="main-image"/i);
  if (mainImg?.[1]) return mainImg[1];
  // Last resort: first media-amazon.com product image URL in the page
  const anyImg = html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+%._-]+\.(?:jpg|jpeg|png|webp)/i);
  if (anyImg?.[0]) return anyImg[0];
  return null;
}

export interface ProductInfo {
  title: string;
  brand: string | null;
  image: string | null;
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
  const image = extractImageFromProductHtml(html);
  return { title, brand, image };
}

/**
 * Lightweight: fetch only the brand for a given ASIN. Returns null on any failure.
 * Used to verify competitor candidates aren't the same brand as the user's product.
 */
export async function getBrandByAsin(asin: string): Promise<string | null> {
  try {
    const info = await getProductInfoByAsin(asin);
    return info?.brand ?? null;
  } catch {
    return null;
  }
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
 * Normalize a brand string to a comparable form: lowercase, strip punctuation,
 * collapse whitespace. Handles "Oral-B" / "Oral B" / "OralB" / "ORAL-B" all → "oralb".
 */
export function normalizeBrand(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Best-effort brand extraction from an Amazon search result title.
 * Most listings start with the brand name; if not, returns first significant token.
 */
export function brandFromTitle(title: string): string {
  if (!title) return "";
  // Strip common leading articles/adjectives that aren't brands
  const cleaned = title.trim();
  // Take up to first comma, dash with spaces, or "(" as the lead segment
  const lead = cleaned.split(/\s*[,(\-–—]\s*/)[0] ?? "";
  const tokens = lead.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  // First token is usually brand. Could be 2 words for some brands ("Oral B", "Stanley Black").
  // Heuristic: if first 2 tokens are both Capitalized and short, treat as 2-word brand.
  if (
    tokens.length >= 2 &&
    /^[A-Z][a-zA-Z0-9&'.-]{0,12}$/.test(tokens[0]!) &&
    /^[A-Z][a-zA-Z0-9&'.-]{0,12}$/.test(tokens[1]!) &&
    tokens[0]!.length + tokens[1]!.length < 20
  ) {
    return `${tokens[0]} ${tokens[1]}`;
  }
  return tokens[0] ?? "";
}

/**
 * True if two brand strings refer to the same brand (handles punctuation/case).
 */
export function brandsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeBrand(a);
  const nb = normalizeBrand(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Substring containment for short brand tokens (e.g. "amazon" in "amazonbasics")
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  return false;
}

/**
 * Search Amazon and return up to `limit` ASIN+title hits, excluding excludeAsin and any hits
 * whose detected brand matches excludeBrand. The caller is responsible for picking the final
 * 5 with brand diversity.
 */
export async function searchCompetitorHits(
  query: string,
  options: {
    limit?: number;
    excludeAsin?: string | null;
    excludeBrand?: string | null;
  } = {},
): Promise<SearchHit[]> {
  const limit = options.limit ?? 25;
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&ref=nb_sb_noss`;
  const html = await fetchAmazon(url);

  const excludeAsin = options.excludeAsin?.toUpperCase();
  const userBrand = options.excludeBrand?.trim() ?? "";

  const allHits = parseSearchHits(html);
  const filtered: SearchHit[] = [];
  for (const hit of allHits) {
    if (excludeAsin && hit.asin === excludeAsin) continue;
    if (userBrand && hit.title) {
      const candidateBrand = brandFromTitle(hit.title);
      if (brandsMatch(userBrand, candidateBrand)) continue;
      // Also: if the user brand appears anywhere in the title (substring on normalized form),
      // still filter — catches cases where brand isn't first word.
      const normTitle = normalizeBrand(hit.title);
      const normUser = normalizeBrand(userBrand);
      if (normUser.length >= 4 && normTitle.includes(normUser)) continue;
    }
    filtered.push(hit);
    if (filtered.length >= limit) break;
  }
  return filtered;
}
