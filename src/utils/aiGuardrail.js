// In-memory AI guardrails: cache + per-session budgeting.
// Not persisted between reloads.

const MAX_AI_CALLS_PER_SESSION = 15;

/** @type {Map<string, any>} */
const cache = new Map();
let aiCallsThisSession = 0;

function stableStringify(value) {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${parts.join(',')}}`;
}

// Lightweight non-crypto hash (good enough for in-memory cache keys).
function hashString(input) {
  const s = String(input ?? '');
  let hash = 5381;
  for (let i = 0; i < s.length; i += 1) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
  }
  // unsigned 32-bit
  return (hash >>> 0).toString(16);
}

export function hashPayload(payload) {
  return hashString(stableStringify(payload));
}

function makeCacheKey(queryKey, payloadHash) {
  const q = Array.isArray(queryKey) ? queryKey.join('|') : String(queryKey ?? '');
  return `${q}::${String(payloadHash ?? '')}`;
}

export function cacheAIResult(queryKey, payloadHash, result) {
  const key = makeCacheKey(queryKey, payloadHash);
  cache.set(key, result);
  return result;
}

export function getCachedAIResult(queryKey, payloadHash) {
  const key = makeCacheKey(queryKey, payloadHash);
  return cache.has(key) ? cache.get(key) : null;
}

export function incrementAICounter() {
  aiCallsThisSession += 1;
  return aiCallsThisSession;
}

export function hasExceededAILimit() {
  return aiCallsThisSession >= MAX_AI_CALLS_PER_SESSION;
}

export function getAICallsThisSession() {
  return aiCallsThisSession;
}

export function getMaxAICallsPerSession() {
  return MAX_AI_CALLS_PER_SESSION;
}
