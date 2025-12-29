import { useQuery } from '@tanstack/react-query';

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
const CACHE_MS = 60 * 1000;

async function fetchFlags() {
  if (_flagsCache && Date.now() - _flagsCacheTime < CACHE_MS) return _flagsCache;
  const res = await fetch('/feature-flags');
  if (!res.ok) throw new Error('Failed to fetch feature flags');
  const data = await res.json();
  _flagsCache = data;
  _flagsCacheTime = Date.now();
  return data;
}

export function useFeatureFlag(name, userId) {
  return useQuery({
    queryKey: ['featureFlag', name, userId],
    queryFn: async () => {
      if (FORCE_ALL_FLAGS_ON) return { enabled: true };
      const { flags } = await fetchFlags();
      const flag = Array.isArray(flags) ? flags.find(f => f.name === name) : null;
      if (!flag) return { enabled: false };
      if (!flag.enabled) return { enabled: false };
      const pct = typeof flag.rollout_percentage === 'number' ? flag.rollout_percentage : 100;
      if (pct >= 100 || !userId) return { enabled: true };
      // Deterministic hash
      const hash = stableHash(String(userId) + ':' + name) % 100;
      return { enabled: hash < pct };
    },
    staleTime: CACHE_MS,
    select: (data) => ({ enabled: !!data?.enabled, loading: false }),
  });
}
