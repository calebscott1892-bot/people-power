import { QueryClient } from '@tanstack/react-query';

const MINUTE_MS = 60 * 1000;

export const DEFAULT_QUERY_OPTIONS = {
  // Requested defaults
  staleTime: 5 * MINUTE_MS,
  // TanStack Query v5 uses gcTime (cacheTime in v4)
  gcTime: 15 * MINUTE_MS,
  refetchOnWindowFocus: false,
  retry: 1,
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
