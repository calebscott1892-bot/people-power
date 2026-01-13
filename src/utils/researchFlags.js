import { useQuery } from '@tanstack/react-query';
import { getServerBaseUrl } from '@/api/serverBase';
import { httpFetch } from '@/utils/httpFetch';

async function fetchResearchFlags({ userId, movementId }) {
  const params = [];
  if (userId) params.push(`user_id=${encodeURIComponent(userId)}`);
  if (movementId) params.push(`movement_id=${encodeURIComponent(movementId)}`);
  const baseUrl = getServerBaseUrl();
  const url = `${baseUrl}/research-flags${params.length ? '?' + params.join('&') : ''}`;
  const res = await httpFetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Failed to fetch research flags');
  return res.json();
}

export function useResearchFlagsForUser(userId) {
  return useQuery({
    queryKey: ['researchFlags', 'user', userId],
    queryFn: () => fetchResearchFlags({ userId }),
    staleTime: 5 * 60 * 1000,
    enabled: !!userId,
    select: (data) => ({ enabled: !!data?.enabled, features: data?.features || [] })
  });
}

export function useResearchFlagsForMovement(movementId) {
  return useQuery({
    queryKey: ['researchFlags', 'movement', movementId],
    queryFn: () => fetchResearchFlags({ movementId }),
    staleTime: 5 * 60 * 1000,
    enabled: !!movementId,
    select: (data) => ({ enabled: !!data?.enabled, features: data?.features || [] })
  });
}
