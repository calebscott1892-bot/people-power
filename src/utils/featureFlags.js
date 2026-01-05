import { useQuery } from '@tanstack/react-query';
import { getServerBaseUrl } from '@/api/serverBase';

const FORCE_ALL_FLAGS_ON = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FORCE_ALL_FLAGS_ON === 'true' && import.meta.env.MODE !== 'production';

function stableHash(str) {
  // FNV-1a hash, returns 0-4294967295
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

let _flagsCache = null;
let _flagsCacheTime = 0;
const CACHE_MS = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.PROD) ? 0 : 60 * 1000;

async function fetchFlags() {
  if (CACHE_MS > 0 && _flagsCache && Date.now() - _flagsCacheTime < CACHE_MS) return _flagsCache;
  const baseUrl = getServerBaseUrl();
  const res = await fetch(`${baseUrl}/feature-flags`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('Failed to fetch feature flags');
  const data = await res.json();
  _flagsCache = data;
  _flagsCacheTime = Date.now();
  return data;
}

export function useFeatureFlag(name, userId, options = {}) {
  const defaultEnabled = options?.defaultEnabled === true;
  const enableWhileLoading = options?.enableWhileLoading === true;
  const query = useQuery({
    queryKey: ['featureFlags'],
    queryFn: fetchFlags,
    staleTime: CACHE_MS,
    enabled: !FORCE_ALL_FLAGS_ON,
  });

  if (FORCE_ALL_FLAGS_ON) {
    return { enabled: true, loading: false };
  }

  if (query.isLoading) {
    return { enabled: enableWhileLoading ? defaultEnabled : false, loading: true };
  }

  if (query.isError) {
    return { enabled: defaultEnabled, loading: false };
  }

  const flags = Array.isArray(query.data?.flags) ? query.data.flags : [];
  const flag = flags.find((f) => f.name === name);
  if (!flag) return { enabled: defaultEnabled, loading: false };
  if (!flag.enabled) return { enabled: false, loading: false };

  const pct = typeof flag.rollout_percentage === 'number' ? flag.rollout_percentage : 100;
  if (pct >= 100) return { enabled: true, loading: false };
  if (!userId) return { enabled: false, loading: false };

  const hash = stableHash(String(userId) + ':' + name) % 100;
  return { enabled: hash < pct, loading: false };
}
