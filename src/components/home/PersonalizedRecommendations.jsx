import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Target } from 'lucide-react';
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

export default function PersonalizedRecommendations({ user, allMovements, interests }) {
  const movementSlice = useMemo(() => {
    const list = Array.isArray(allMovements) ? [...allMovements] : [];
    list.sort((a, b) => toNumber(b?.score ?? b?.momentum_score) - toNumber(a?.score ?? a?.momentum_score));
    return list.slice(0, 60);
  }, [allMovements]);

  const interestList = useMemo(() => {
    const arr = Array.isArray(interests) ? interests : [];
    return arr.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8);
  }, [interests]);

  const enabled = !!user && movementSlice.length > 0;

  const { data, isFetching, isError } = useQuery({
    queryKey: ['aiRecommendations', user?.email ?? 'anon', interestList.join('|'), movementSlice.map((m) => m?.id ?? m?._id).join('|')],
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 0,
    queryFn: async () => {
      // Fallback: top momentum movements
      const fallback = movementSlice.slice(0, 4);
      if (hasExceededAILimit()) return { results: fallback, mode: 'limit' };

      const candidates = movementSlice
        .map((m) => {
          const id = m?.id ?? m?._id;
          const title = String(m?.title || m?.name || '');
          const teaser = stripHtmlToText(m?.summary || m?.description || m?.description_html || '').slice(0, 140);
          const tags = Array.isArray(m?.tags) ? m.tags.slice(0, 6) : [];
          return { id: id != null ? String(id) : null, title, tags, teaser };
        })
        .filter((x) => x.id);

      const prompt = `You are recommending movements to a user.

User interests (may be empty): ${JSON.stringify(interestList)}

Select 4 movement IDs that best match this user's interests and likely intent.
Rules:
- Use semantic meaning, not just keyword match.
- Prefer variety (avoid 4 near-duplicates).
- Use only the provided fields.
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
      const cached = getCachedAIResult('aiRecommendations', payloadHash);
      if (cached) return { results: cached.results ?? fallback, mode: 'cache' };

      incrementAICounter();

      const response = await integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: responseSchema,
      });

      const ids = Array.isArray(response?.ids) ? response.ids.map(String) : [];
      const byId = new Map(movementSlice.map((m) => [String(m?.id ?? m?._id), m]));
      const results = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 4);

      const out = results.length ? { results, mode: 'ai' } : { results: fallback, mode: 'fallback' };
      cacheAIResult('aiRecommendations', payloadHash, out);
      return out;
    },
  });

  const results = data?.results ?? movementSlice.slice(0, 4);
  const mode = data?.mode ?? null;

  return (
    <EthicalAIWrapper type="suggestion" className="space-y-3">
      <div className="bg-white rounded-3xl border-3 border-slate-200 p-6 shadow-lg">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#FFC947] to-[#FFD666] flex items-center justify-center shadow-lg shadow-yellow-400/30">
              <Target className="w-5 h-5 text-slate-900" />
            </div>
            <div>
              <div className="text-sm font-black text-slate-900">Recommended for you</div>
              <div className="text-xs font-semibold text-slate-500">
                {interestList.length ? `Based on your interests: ${interestList.slice(0, 3).join(', ')}` : 'Based on momentum + general relevance'}
              </div>
            </div>
          </div>
          {isFetching ? <Loader2 className="w-4 h-4 text-[#3A3DFF] animate-spin" /> : null}
        </div>

        {isError ? (
          <div className="text-xs font-semibold text-slate-500 mb-3">
            AI recommendations are temporarily unavailable. Showing momentum-based picks.
          </div>
        ) : null}

        {mode === 'limit' ? (
          <div className="text-xs font-semibold text-slate-500 mb-3">
            AI usage limit reached for this session.
          </div>
        ) : null}

        <div className="space-y-2">
          {results.map((m) => {
            const id = m?.id ?? m?._id;
            const title = String(m?.title || m?.name || 'Untitled');
            const teaser = stripHtmlToText(m?.summary || m?.description || m?.description_html || '').slice(0, 90);
            return (
              <a
                key={String(id)}
                href={`/movements/${encodeURIComponent(String(id))}`}
                className="block p-4 rounded-2xl border-2 border-slate-200 bg-slate-50 hover:bg-white transition-colors"
              >
                <div className="font-black text-slate-900 line-clamp-1">{title}</div>
                <div className="text-xs font-semibold text-slate-600 mt-1 line-clamp-2">{teaser}</div>
              </a>
            );
          })}
        </div>

        <div className="mt-4 text-xs text-slate-500 font-semibold">
          AI-generated suggestions can be wrong. People Power does not verify movement claims.
        </div>
      </div>
    </EthicalAIWrapper>
  );
}