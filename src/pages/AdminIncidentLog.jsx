import React, { useMemo, useState } from 'react';
import AdminBackButton from '@/components/admin/AdminBackButton';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { fetchAdminIncidents } from '@/api/incidentsClient';
import ErrorState from '@/components/shared/ErrorState';

const PAGE_SIZE = 50;

function formatWhen(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function AdminIncidentLog() {
  const { session, isAdmin } = useAuth();

  const accessToken = session?.access_token ? String(session.access_token) : null;
  const canView = !!accessToken && !!isAdmin;

  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['adminIncidents', query, offset],
    enabled: canView,
    queryFn: async () => {
      return fetchAdminIncidents({ q: query, limit: PAGE_SIZE, offset }, { accessToken });
    },
    retry: 1,
  });

  const items = useMemo(() => {
    const list = data?.items;
    return Array.isArray(list) ? list : [];
  }, [data]);

  const hasMore = !!data?.has_more;

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <AdminBackButton />
        <button
          type="button"
          onClick={() => refetch()}
          disabled={!canView || isFetching}
          className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black text-sm hover:bg-slate-50 disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Incident Log</h1>
          <p className="text-slate-600 font-semibold text-sm">Metadata-only safety incidents (read-only).</p>
          <div className="inline-flex items-center mt-3 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-black uppercase">
            Admin view – tools not available to regular users
          </div>
        </div>

        {!accessToken ? (
          <div className="text-slate-600 font-semibold">Sign in to view incidents.</div>
        ) : !canView ? (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
            <div className="font-black text-slate-900">Not authorized</div>
            <div className="text-sm font-semibold mt-1">Admin access required.</div>
          </div>
        ) : (
          <form
            className="flex flex-col sm:flex-row sm:items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setOffset(0);
              setQuery(String(draftQuery || '').trim());
            }}
          >
            <input
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              placeholder="Search by event type, email, movement id…"
              className="flex-1 p-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-sm"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black text-sm hover:bg-slate-50"
            >
              Search
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftQuery('');
                setQuery('');
                setOffset(0);
              }}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black text-sm hover:bg-slate-50"
            >
              Clear
            </button>
          </form>
        )}
      </div>

      {canView ? (
        <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
          {isLoading ? (
            <div className="text-slate-600 font-semibold">Loading incidents…</div>
          ) : isError ? (
            <ErrorState
              compact
              error={error}
              onRetry={() => refetch()}
              onReload={() => window.location.reload()}
              className="border-slate-200"
            />
          ) : items.length === 0 ? (
            <div className="text-slate-600 font-semibold">No incidents found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="py-2 pr-3 font-black">When</th>
                    <th className="py-2 pr-3 font-black">Event</th>
                    <th className="py-2 pr-3 font-black">Actor</th>
                    <th className="py-2 pr-3 font-black">Movement</th>
                    <th className="py-2 pr-3 font-black">Trigger</th>
                    <th className="py-2 pr-3 font-black">Human</th>
                    <th className="py-2 pr-3 font-black">Related</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const id = String(it?.id || '');
                    const related =
                      it?.related_entity_type && it?.related_entity_id
                        ? `${String(it.related_entity_type)}:${String(it.related_entity_id)}`
                        : it?.related_entity_type
                          ? String(it.related_entity_type)
                          : '';

                    return (
                      <tr key={id} className="border-t border-slate-100">
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-700 font-semibold">
                          {formatWhen(it?.created_at)}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-900 font-black">
                          {String(it?.event_type || '')}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-700 font-semibold">
                          {String(it?.actor_email || '')}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-700 font-semibold">
                          {String(it?.movement_id || '')}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-700 font-semibold">
                          {String(it?.trigger_system || '')}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-700 font-semibold">
                          {it?.human_reviewed ? 'Yes' : 'No'}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-700 font-semibold">
                          {related}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500 font-semibold">
              Showing {items.length} (offset {offset})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0 || isFetching}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black text-sm hover:bg-slate-50 disabled:opacity-60"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={!hasMore || isFetching}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black text-sm hover:bg-slate-50 disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
