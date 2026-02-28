/**
 * Lightweight response classifier for detecting unexpected non-JSON responses
 * on backend API requests (e.g. Cloudflare challenge pages, HTML interstitials,
 * CDN error pages).
 *
 * Design constraints:
 * - Must not consume the response body (uses res.clone().text() for a small snippet).
 * - Must be safe to call on any Response, including opaque/errored ones.
 * - Returns a plain classification object, never throws.
 */

// Known Cloudflare markers found in challenge/block pages.
const CF_MARKERS = [
  'cf-browser-verification',
  'cf-challenge-running',
  'cf_chl_opt',
  'cf-mitigated',
  'cf-ray',
  'cloudflare',
  'jschl-answer',
  'managed_checking_msg',
  'challenge-platform',
  'turnstile',
];

/**
 * @typedef {Object} ResponseClassification
 * @property {string}  contentType       - Raw content-type header value (or '').
 * @property {boolean} isHtml            - True if content-type indicates text/html.
 * @property {boolean} isJson            - True if content-type indicates application/json.
 * @property {boolean} isExpectedApiType - True if the content type looks like a normal API response.
 * @property {boolean} looksLikeCfChallenge - True if HTML snippet contains Cloudflare markers.
 * @property {boolean} looksLikeInterstitial - True if HTML snippet looks like a generic interstitial/block page.
 * @property {string}  classification    - Short label: 'json' | 'cf_challenge' | 'interstitial' | 'html_unknown' | 'unexpected_type' | 'unknown'.
 * @property {string|null} snippet       - First ~300 chars of body if HTML, null otherwise.
 * @property {string[]} cfMarkersFound   - Which CF markers were detected (empty array if none).
 */

/**
 * Classify a fetch Response to detect unexpected non-JSON payloads.
 *
 * @param {Response} res - The fetch Response object.
 * @param {Object} [options]
 * @param {number} [options.snippetLength=300] - Max chars to read from HTML body for marker detection.
 * @returns {Promise<ResponseClassification>}
 */
export async function classifyResponse(res, options) {
  const snippetLength = options?.snippetLength ?? 300;

  const result = {
    contentType: '',
    isHtml: false,
    isJson: false,
    isExpectedApiType: false,
    looksLikeCfChallenge: false,
    looksLikeInterstitial: false,
    classification: 'unknown',
    snippet: null,
    cfMarkersFound: [],
  };

  if (!res || typeof res !== 'object') return result;

  // Extract content-type safely.
  try {
    const ct = res.headers?.get ? res.headers.get('content-type') : null;
    result.contentType = ct ? String(ct).trim().toLowerCase() : '';
  } catch {
    // ignore -- opaque responses may throw
  }

  const ct = result.contentType;
  result.isHtml = ct.includes('text/html') || ct.includes('application/xhtml');
  result.isJson = ct.includes('application/json') || ct.includes('+json');
  result.isExpectedApiType = result.isJson || ct.includes('text/plain') || ct === '';

  // If the content-type looks like normal JSON, classify immediately.
  if (result.isJson) {
    result.classification = 'json';
    return result;
  }

  // If the response is not HTML and not an unexpected type, exit early.
  if (!result.isHtml && result.isExpectedApiType) {
    result.classification = 'unknown';
    return result;
  }

  // For HTML responses (or unexpected content types), read a small snippet for
  // marker detection. We clone to avoid consuming the body.
  let snippet = '';
  try {
    const text = await res.clone().text();
    snippet = text ? text.slice(0, Math.max(snippetLength, 100)) : '';
  } catch {
    // Body may be locked or opaque; that's OK.
    snippet = '';
  }

  const lower = snippet.toLowerCase();

  if (result.isHtml) {
    result.snippet = snippet || null;

    // Check for Cloudflare-specific markers.
    const found = CF_MARKERS.filter((marker) => lower.includes(marker));
    result.cfMarkersFound = found;
    result.looksLikeCfChallenge = found.length > 0;

    // Check for generic interstitial markers (non-CF).
    const genericInterstitialMarkers = [
      'please wait',
      'checking your browser',
      'just a moment',
      'access denied',
      'blocked',
      'you have been blocked',
      'security check',
      'ddos protection',
    ];
    result.looksLikeInterstitial =
      result.looksLikeCfChallenge ||
      genericInterstitialMarkers.some((m) => lower.includes(m));

    if (result.looksLikeCfChallenge) {
      result.classification = 'cf_challenge';
    } else if (result.looksLikeInterstitial) {
      result.classification = 'interstitial';
    } else {
      result.classification = 'html_unknown';
    }
  } else {
    // Not HTML but not an expected API type either (e.g. text/xml, image/*, etc.)
    result.snippet = snippet || null;
    result.classification = 'unexpected_type';
  }

  return result;
}

/**
 * Quick synchronous check: does the content-type header look like HTML?
 * Use this for fast gating before the async classifyResponse.
 *
 * @param {Response} res
 * @returns {boolean}
 */
export function hasHtmlContentType(res) {
  try {
    const ct = res?.headers?.get ? res.headers.get('content-type') : null;
    if (!ct) return false;
    const lower = String(ct).trim().toLowerCase();
    return lower.includes('text/html') || lower.includes('application/xhtml');
  } catch {
    return false;
  }
}
