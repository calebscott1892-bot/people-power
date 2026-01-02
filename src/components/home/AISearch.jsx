import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Sparkles, Loader2 } from 'lucide-react';
import EthicalAIWrapper from '@/components/ai/EthicalAIWrapper';
import { integrations } from '@/api/appClient';
import {
  cacheAIResult,
  getCachedAIResult,
  hasExceededAILimit,
  incrementAICounter,
  hashPayload,
} from '@/utils/aiGuardrail';

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function stripHtmlToText(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function localSearch(movements, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const list = Array.isArray(movements) ? movements : [];
  return list
    .map((m) => {
      const title = String(m?.title || m?.name || '');
      const desc = stripHtmlToText(m?.description || m?.description_html || m?.summary || '');
      const hay = `${title} ${desc}`.toLowerCase();
      const hits = hay.includes(q) ? 2 : 0;
      const wordHits = q.split(/\s+/).filter(Boolean).reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
      const score = hits + wordHits + toNumber(m?.score ?? m?.momentum_score) * 0.01;
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.m);
}

export default function AISearch({ allMovements }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 750);
    return () => clearTimeout(t);
  }, [query]);

  const trimmed = String(debounced || '').trim();
  const enabled = trimmed.length >= 3;

  const movementSlice = useMemo(() => {
    const list = Array.isArray(allMovements) ? [...allMovements] : [];
    list.sort((a, b) => toNumber(b?.score ?? b?.momentum_score) - toNumber(a?.score ?? a?.momentum_score));
    return list.slice(0, 50);
  }, [allMovements]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ['aiSearch', trimmed, movementSlice.map((m) => m?.id ?? m?._id).join('|')],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 0,
    queryFn: async () => {
      if (hasExceededAILimit()) return { results: localSearch(movementSlice, trimmed), mode: 'limit' };

      // Minimal payload: titles + tags + short teaser only.
      const candidates = movementSlice.map((m) => {
        const id = m?.id ?? m?._id;
        const title = String(m?.title || m?.name || '');
        const teaser = stripHtmlToText(m?.summary || m?.description || m?.description_html || '').slice(0, 160);
        const tags = Array.isArray(m?.tags) ? m.tags.slice(0, 6) : [];
        return { id: id != null ? String(id) : null, title, tags, teaser };
      }).filter((x) => x.id);

      const prompt = `You are helping users find relevant community-led movements.

User query: "${trimmed}"

Return the 6 most relevant movement IDs from the list below.
Rules:
- Use semantic meaning, not just keyword match.
- Use only the provided fields (title, tags, teaser).
- Output IDs only; do not invent IDs.

Movements:
${JSON.stringify(candidates)}
`;

      const responseSchema = {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['ids'],
      };

      const payloadHash = hashPayload({ prompt, responseSchema });
      const cached = getCachedAIResult('aiSearch', payloadHash);
      if (cached) return { results: cached.results ?? [], mode: 'cache' };

      incrementAICounter();

      const response = await integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: responseSchema,
      });

      const ids = Array.isArray(response?.ids) ? response.ids.map(String) : [];
      const byId = new Map(movementSlice.map((m) => [String(m?.id ?? m?._id), m]));
      const results = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 6);

      // Fallback if model returns nothing useful
      if (!results.length) {
        return { results: localSearch(movementSlice, trimmed), mode: 'fallback' };
      }

      cacheAIResult('aiSearch', payloadHash, { results });
      return { results, mode: 'ai' };
    },
  });

  const results = data?.results ?? [];
  const mode = data?.mode ?? null;

  return (
    <EthicalAIWrapper type="suggestion" className="space-y-3">
      <div className="bg-white rounded-3xl border-3 border-slate-200 p-5 shadow-lg">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Sparkles className="w-5 h-5 text-[#FFC947]" fill="#FFC947" />
            </div>
            <div>
              <div className="text-sm font-black text-slate-900">AI Search</div>
              <div className="text-xs font-semibold text-slate-500">Opt-in only. Uses a limited per-session budget.</div>
            </div>
          </div>
          {isFetching ? <Loader2 className="w-4 h-4 text-[#3A3DFF] animate-spin" /> : null}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try: ‘environmental initiatives in my area’"
            className="w-full pl-9 pr-3 py-3 rounded-2xl border-2 border-slate-200 bg-white font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FFC947]"
          />
        </div>

        {enabled ? (
          <div className="mt-4 space-y-2">
            {isError ? (
              <div className="text-sm font-semibold text-slate-600">
                AI search is temporarily unavailable. Showing best-effort local results.
              </div>
            ) : null}

            {mode === 'limit' ? (
              <div className="text-xs font-semibold text-slate-500">
                AI usage limit reached for this session.
              </div>
            ) : null}

            {results.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {results.map((m) => {
                  const id = m?.id ?? m?._id;
                  const title = String(m?.title || m?.name || 'Untitled');
                  const teaser = stripHtmlToText(m?.summary || m?.description || m?.description_html || '').slice(0, 80);
                  return (
                    <a
                      key={String(id)}
                      href={`/movement/${encodeURIComponent(String(id))}`}
                      className="block p-4 rounded-2xl border-2 border-slate-200 bg-slate-50 hover:bg-white transition-colors"
                    >
                      <div className="font-black text-slate-900 line-clamp-1">{title}</div>
                      <div className="text-xs font-semibold text-slate-600 mt-1 line-clamp-2">{teaser}</div>
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm font-semibold text-slate-500">No matches yet.</div>
            )}
          </div>
        ) : (
          <div className="mt-3 text-xs font-semibold text-slate-500">Type at least 3 characters.</div>
        )}
      </div>
    </EthicalAIWrapper>
  );
}