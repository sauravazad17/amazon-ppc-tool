// Up-to-date user agents (2025) — rotated per request
const USER_AGENTS = [
  // Chrome on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  // Chrome on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  // Chrome on Windows (slightly older)
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  // Firefox on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
  // Firefox on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:136.0) Gecko/20100101 Firefox/136.0",
  // Edge on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0",
  // Safari on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
];

// Accept-Language variations to cycle through
const ACCEPT_LANGUAGES = [
  "en-US,en;q=0.9",
  "en-US,en;q=0.9,es;q=0.8",
  "en-GB,en;q=0.9,en-US;q=0.8",
  "en-US,en;q=0.8",
];

function buildHeaders(ua: string, referer?: string): Record<string, string> {
  const isFirefox = ua.includes("Firefox");
  const isSafari = ua.includes("Safari") && !ua.includes("Chrome");
  const lang = ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)] ?? "en-US,en;q=0.9";

  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept: isFirefox
      ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      : isSafari
        ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": lang,
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "max-age=0",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  };

  // Chromium-family sec- headers (not sent by Firefox or Safari)
  if (!isFirefox && !isSafari) {
    headers["Sec-CH-UA"] = '"Chromium";v="135", "Not-A.Brand";v="8"';
    headers["Sec-CH-UA-Mobile"] = "?0";
    headers["Sec-CH-UA-Platform"] = ua.includes("Windows") ? '"Windows"' : '"macOS"';
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = referer ? "same-origin" : "none";
    headers["Sec-Fetch-User"] = "?1";
  }

  if (referer) {
    headers["Referer"] = referer;
  }

  return headers;
}

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

function pickUa(seed: number): string {
  return USER_AGENTS[Math.abs(seed) % USER_AGENTS.length] ?? USER_AGENTS[0]!;
}

function isHtmlBlocked(html: string): boolean {
  if (!html || html.length < 500) return true;
  // Amazon bot-detection / captcha pages
  if (/Robot Check|Type the characters you see|To discuss automated access|api-services-support@amazon/i.test(html)) return true;
  // CAPTCHA markers
  if (/captcha|validateCaptcha|verify you are human|not a robot/i.test(html)) return true;
  // Sorry / error page
  if (/<title[^>]*>\s*(?:Sorry[!,]?|Page Not Found|404|503)/i.test(html)) return true;
  // Page is basically empty (anti-bot blank response)
  if (!/<html/i.test(html)) return true;
  return false;
}

async function fetchOnce(
  url: string,
  ua: string,
  timeoutMs: number,
  referer?: string,
): Promise<{ status: number; html: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: buildHeaders(ua, referer),
      signal: ctrl.signal,
      redirect: "follow",
    });
    const html = await res.text();
    return { status: res.status, html };
  } finally {
    clearTimeout(t);
  }
}

async function fetchAmazon(url: string, timeoutMs = 15_000): Promise<string> {
  const maxAttempts = 4;
  let lastErr: unknown = null;

  // Build a realistic referer: product pages come "from" the Amazon homepage or search
  const referer = url.includes("/s?")
    ? "https://www.amazon.com/"
    : "https://www.amazon.com/s?k=products";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Each attempt picks a different UA to vary the fingerprint
    const ua = pickUa(attempt * 3 + Math.floor(Math.random() * USER_AGENTS.length));
    try {
      const { status, html } = await fetchOnce(url, ua, timeoutMs, referer);
      if (status === 200 && !isHtmlBlocked(html)) {
        return html;
      }
      const blocked = status === 200 && isHtmlBlocked(html);
      // Retryable: 5xx, 429, or bot-detection page with 200
      if (status >= 500 || status === 429 || blocked) {
        lastErr = new Error(`Amazon returned HTTP ${status}${blocked ? " (bot-check)" : ""}`);
        if (attempt < maxAttempts - 1) {
          // Exponential back-off: 800ms → 1.6s → 3.2s + jitter
          const delay = 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw lastErr;
      }
      // Non-retryable (4xx other than 429)
      throw new Error(`Amazon returned HTTP ${status}`);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        const delay = 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Amazon fetch failed");
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

function extractPriceFromProductHtml(html: string): number | null {
  // Sanity-checked parse: price must be between $0.50 and $1999
  const tryParse = (s: string | undefined): number | null => {
    if (!s) return null;
    const v = parseFloat(s.replace(/,/g, ""));
    return !isNaN(v) && v >= 0.5 && v < 2000 ? v : null;
  };

  // --- Tier 1: JSON blobs — most reliable, not layout-dependent ---

  // 1. priceToPay (newest React data blob) — {"amount":"34.99","currency":"USD"}
  let m = html.match(/"priceToPay"\s*:\s*\{\s*"amount"\s*:\s*"([\d.]+)"/);
  let v = tryParse(m?.[1]);
  if (v) return v;

  // 2. priceAmount scalar (with or without quotes)
  m = html.match(/"priceAmount"\s*:\s*"?([\d.]+)"?/);
  v = tryParse(m?.[1]);
  if (v) return v;

  // 3. displayPrice with dollar sign
  m = html.match(/"displayPrice"\s*:\s*"\$([\d,]+(?:\.\d{1,2})?)"/);
  v = tryParse(m?.[1]);
  if (v) return v;

  // 4. buyingPrice / formattedPrice with dollar sign (explicit $ prevents matching ad/list prices)
  m = html.match(/"(?:buyingPrice|formattedPrice)"\s*:\s*"\$([\d,]+(?:\.\d{1,2})?)"/);
  v = tryParse(m?.[1]);
  if (v) return v;

  // --- Tier 2: HTML anchored to specific buybox IDs ---

  // 5. data-a-color="price" marks the ACTUAL selling price (not the grey strikethrough "was" price)
  const colorPriceBlock = html.match(/data-a-color="price"[^>]*>[\s\S]{0,400}?class="a-offscreen"\s*>\s*\$([\d,]+(?:\.\d{1,2})?)\s*</i);
  v = tryParse(colorPriceBlock?.[1]);
  if (v) return v;

  // 6. corePriceDisplay_desktop_feature_div → first a-offscreen inside it
  const corePriceSection = html.match(/id="corePriceDisplay_desktop_feature_div"([\s\S]{1,2000})/i);
  if (corePriceSection?.[1]) {
    const mo = corePriceSection[1].match(/class="a-offscreen"\s*>\s*\$([\d,]+(?:\.\d{1,2})?)\s*</i);
    v = tryParse(mo?.[1]);
    if (v) return v;
    // also try a-price-whole + a-price-fraction inside that section
    const wf = corePriceSection[1].match(/class="a-price-whole">([\d,]+)<[\s\S]{0,80}?class="a-price-fraction">(\d+)</i);
    if (wf?.[1] && wf?.[2]) {
      v = tryParse(`${wf[1].replace(/,/g, "")}.${wf[2]}`);
      if (v) return v;
    }
  }

  // 7. apex_offerDisplay_desktop → first a-offscreen
  const apexSection = html.match(/id="apex_offerDisplay[^"]*"([\s\S]{1,2000})/i);
  if (apexSection?.[1]) {
    const mo = apexSection[1].match(/class="a-offscreen"\s*>\s*\$([\d,]+(?:\.\d{1,2})?)\s*</i);
    v = tryParse(mo?.[1]);
    if (v) return v;
  }

  // 8. priceblock_ourprice / priceblock_dealprice (legacy layout)
  m = html.match(/id="priceblock_(?:ourprice|dealprice)"[^>]*>\s*\$([\d,]+(?:\.\d{1,2})?)/i);
  v = tryParse(m?.[1]);
  if (v) return v;

  // --- Tier 3: statistical fallback on all a-offscreen amounts ---
  const allOffscreen = [...html.matchAll(/class="a-offscreen"\s*>\s*\$([\d,]+(?:\.\d{1,2})?)\s*</gi)];
  const candidates = allOffscreen
    .map(match => parseFloat((match[1] ?? "").replace(/,/g, "")))
    .filter(n => !isNaN(n) && n >= 1 && n < 2000);
  if (candidates.length > 0) {
    candidates.sort((a, b) => a - b);
    const freq = new Map<number, number>();
    for (const n of candidates) freq.set(n, (freq.get(n) ?? 0) + 1);
    const bestCount = Math.max(...freq.values());
    const mostCommon = candidates.find(n => freq.get(n) === bestCount);
    if (mostCommon !== undefined) return mostCommon;
    return candidates[Math.floor(candidates.length / 2)] ?? null;
  }

  return null;
}

function extractRatingFromProductHtml(html: string): number | null {
  const tryRating = (s: string | undefined): number | null => {
    if (!s) return null;
    const v = parseFloat(s);
    return !isNaN(v) && v >= 1 && v <= 5 ? v : null;
  };

  // 1. ratingScore JSON key (most reliable, in JS state blob)
  let m = html.match(/"ratingScore"\s*:\s*"([\d.]+)"/);
  let v = tryRating(m?.[1]);
  if (v) return v;

  // 2. acrPopover title attribute — this is the main product star widget
  //    <span id="acrPopover" ... title="4.5 out of 5 stars">
  m = html.match(/id="acrPopover"[^>]*title="([\d.]+)\s+out\s+of\s+5\s+stars"/i);
  v = tryRating(m?.[1]);
  if (v) return v;

  // 3. a-icon-alt text — the hidden text inside the star icon
  //    <span class="a-icon-alt">4.5 out of 5 stars</span>
  m = html.match(/class="a-icon-alt"\s*>\s*([\d.]+)\s+out\s+of\s+5\s+stars\s*</i);
  v = tryRating(m?.[1]);
  if (v) return v;

  // 4. averageStarRating in JSON
  m = html.match(/"averageStarRating"\s*:\s*\{[^}]{0,200}"value"\s*:\s*"?([\d.]+)"?/);
  v = tryRating(m?.[1]);
  if (v) return v;

  // 5. aria-label on star span (search-result-style widget used in some PDP layouts)
  m = html.match(/aria-label="([\d.]+)\s+out\s+of\s+5\s+stars"[^>]*class="[^"]*a-star/i)
    ?? html.match(/class="[^"]*a-star[^"]*"[^>]*aria-label="([\d.]+)\s+out\s+of\s+5\s+stars"/i);
  v = tryRating(m?.[1]);
  if (v) return v;

  // 6. Last resort: first "X out of 5 stars" anywhere — but only accept "nice" values (x.0 or x.5)
  //    This avoids matching review snippet ratings like "4.0 out of 5 stars by reviewer"
  const all = [...html.matchAll(/([\d.]+)\s+out\s+of\s+5\s+stars/gi)];
  for (const match of all) {
    const n = parseFloat(match[1] ?? "");
    if (!isNaN(n) && n >= 1 && n <= 5) {
      // Only trust half-star increments (1.0, 1.5, 2.0, ..., 5.0) — product ratings always round to 0.1
      // but are displayed on product pages rounded to 0.5; accept any tenth
      return Math.round(n * 10) / 10;
    }
  }

  return null;
}

export interface ProductInfo {
  title: string;
  brand: string | null;
  image: string | null;
  price: number | null;
  rating: number | null;
}

export async function getProductInfoByAsin(
  asin: string,
): Promise<ProductInfo | null> {
  const clean = asin.trim().toUpperCase();
  if (!isValidAsin(clean)) return null;

  // Primary fetch: canonical product page
  const html = await fetchAmazon(`https://www.amazon.com/dp/${clean}`);
  const title = extractTitleFromProductHtml(html);
  if (!title) return null;
  const brand = extractBrandFromProductHtml(html);
  const image = extractImageFromProductHtml(html);
  let price = extractPriceFromProductHtml(html);
  let rating = extractRatingFromProductHtml(html);

  // Fallback for variant products: ?th=1&psc=1 forces the default variant
  // into the buybox without requiring a colour/size selection, exposing the price.
  if (price == null || rating == null) {
    try {
      const variantHtml = await fetchAmazon(
        `https://www.amazon.com/dp/${clean}?th=1&psc=1`,
      );
      if (price == null) price = extractPriceFromProductHtml(variantHtml);
      if (rating == null) rating = extractRatingFromProductHtml(variantHtml);
    } catch {
      // ignore — we'll return whatever we have
    }
  }

  return { title, brand, image, price, rating };
}

export async function getFullProductInfoByAsin(
  asin: string,
): Promise<ProductInfo | null> {
  try {
    return await getProductInfoByAsin(asin);
  } catch {
    return null;
  }
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
  searchPrice?: number | null;
  searchRating?: number | null;
  searchImage?: string | null;
}

/**
 * Scrape Amazon search results page for ASIN + title + price + rating + image.
 * Strategy: find each unique ASIN occurrence, then look at a window of HTML around it
 * for the nearest title (h2 / aria-label / alt text), price, rating and image.
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
    const end = Math.min(html.length, start + 12000);
    const win = html.slice(start, end);

    // --- Title ---
    let title = "";
    const h2 = win.match(
      /<h2[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/h2>/i,
    );
    if (h2?.[1]) {
      title = cleanWs(decodeEntities(h2[1].replace(/<[^>]+>/g, "")));
    }
    if (!title) {
      const aria = win.match(
        /aria-label="([^"]+)"[^>]*href="[^"]*\/dp\/B0[A-Z0-9]{8}/i,
      );
      if (aria?.[1]) title = cleanWs(decodeEntities(aria[1]));
    }
    if (!title) {
      const alt = win.match(/<img[^>]*alt="([^"]{20,})"/i);
      if (alt?.[1]) title = cleanWs(decodeEntities(alt[1]));
    }

    // --- Price (from a-offscreen span or a-price-whole) ---
    let searchPrice: number | null = null;
    const offscreen = win.match(/class="a-offscreen"\s*>\s*\$([\d,]+(?:\.\d{1,2})?)\s*</i);
    if (offscreen?.[1]) {
      const v = parseFloat(offscreen[1].replace(/,/g, ""));
      if (!isNaN(v) && v > 0) searchPrice = v;
    }
    if (searchPrice == null) {
      const wholeM = win.match(/class="a-price-whole"\s*>([\d,]+)<\/span>[\s\S]{0,60}class="a-price-fraction"\s*>(\d+)<\/span>/i);
      if (wholeM?.[1] && wholeM?.[2]) {
        const v = parseFloat(`${wholeM[1].replace(/,/g, "")}.${wholeM[2]}`);
        if (!isNaN(v) && v > 0) searchPrice = v;
      }
    }

    // --- Rating (from aria-label or "X out of 5") ---
    let searchRating: number | null = null;
    const ratingAria = win.match(/aria-label="([\d.]+)\s+out\s+of\s+5\s+stars"/i);
    if (ratingAria?.[1]) {
      const v = parseFloat(ratingAria[1]);
      if (!isNaN(v) && v >= 1 && v <= 5) searchRating = v;
    }
    if (searchRating == null) {
      const ratingText = win.match(/([\d.]+)\s+out\s+of\s+5\s+stars/i);
      if (ratingText?.[1]) {
        const v = parseFloat(ratingText[1]);
        if (!isNaN(v) && v >= 1 && v <= 5) searchRating = v;
      }
    }

    // --- Image ---
    let searchImage: string | null = null;
    const imgM = win.match(/<img[^>]+src="(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/i);
    if (imgM?.[1]) searchImage = imgM[1];

    hits.push({ asin, title, searchPrice, searchRating, searchImage });
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
    sortBy?: "price-desc" | "price-asc" | "review-rank";
  } = {},
): Promise<SearchHit[]> {
  const limit = options.limit ?? 25;
  let url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
  if (options.sortBy === "price-desc") url += "&s=price-desc-rank";
  else if (options.sortBy === "price-asc") url += "&s=price-asc-rank";
  else if (options.sortBy === "review-rank") url += "&s=review-rank";
  url += "&ref=nb_sb_noss";
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
