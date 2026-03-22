import { QueryClient } from '@tanstack/react-query';

const MINUTE_MS = 60 * 1000;

export const DEFAULT_QUERY_OPTIONS = {
  // Social data should feel live — keep stale window short.
  staleTime: 30 * 1000, // 30 seconds
  // TanStack Query v5 uses gcTime (cacheTime in v4)
  gcTime: 10 * MINUTE_MS,
  // Re-sync when the user returns to the tab so data is always fresh.
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
  retry: 2,
};

export function createPeoplePowerQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        ...DEFAULT_QUERY_OPTIONS,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
