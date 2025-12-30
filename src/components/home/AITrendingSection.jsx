import React, { useCallback, useEffect, useState } from 'react';
import { Flame, Loader2, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import TagBadge from '../shared/TagBadge';
import { integrations } from '@/api/appClient';
import {
  cacheAIResult,
  getCachedAIResult,
  hasExceededAILimit,
  incrementAICounter,
  hashPayload,
} from '@/utils/aiGuardrail';
import { logError } from '@/utils/logError';

export default function AITrendingSection({ movements }) {
  const [trending, setTrending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limitReached, setLimitReached] = useState(false);

  const analyzeTrending = useCallback(async () => {
    setLoading(true);
    try {
      const fallback = Array.isArray(movements) ? movements.slice(0, 3) : [];
      if (!Array.isArray(movements) || movements.length === 0) {
        setTrending([]);
        setLimitReached(false);
        return;
      }

      const summary = movements.map(m => ({
        id: m.id,
        title: m.title,
        tags: m.tags,
        momentum_score: m.momentum_score,
        boosts: m.boosts,
        downvotes: m.downvotes,
        verified_participants: m.verified_participants,
        unverified_participants: m.unverified_participants,
        supporters: m.supporters,
        created_at: m.created_at
      }));

      const prompt = `Analyze these movements and identify the top 3 truly trending ones based on:
- Recent momentum (not just total score)
- Topic relevance and timeliness
- Community engagement patterns
- Social impact potential

Movements data:
${JSON.stringify(summary)}

Return the 3 movement IDs that are genuinely trending right now.`;

      const responseSchema = {
        type: "object",
        properties: {
          trending_ids: {
            type: "array",
            items: { type: "string" }
          },
          reason: {
            type: "string"
          }
        }
      };

      const payloadHash = hashPayload({ prompt, responseSchema });
      const cached = getCachedAIResult('aiTrending', payloadHash);
      if (cached && Array.isArray(cached.trending)) {
        setTrending(cached.trending);
        setLimitReached(false);
        return;
      }

      if (hasExceededAILimit()) {
        setTrending(fallback);
        setLimitReached(true);
        return;
      }

      incrementAICounter();

      const response = await integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          ...responseSchema,
          required: ['trending_ids'],
        },
      });

      const trendingMovements = response.trending_ids
        .map(id => movements.find(m => m.id === id))
        .filter(Boolean)
        .slice(0, 3);
      
      const picked = trendingMovements.length ? trendingMovements : fallback;
      setTrending(picked);
      setLimitReached(false);
      cacheAIResult('aiTrending', payloadHash, { trending: picked, reason: response?.reason || null });
    } catch (error) {
      logError(error, 'AI trending analysis failed');
      // Fallback to momentum score
      setTrending(movements.slice(0, 3));
      setLimitReached(false);
    } finally {
      setLoading(false);
    }
  }, [movements]);

  useEffect(() => {
    if (movements.length > 0) {
      analyzeTrending();
    }
  }, [movements.length, analyzeTrending]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 text-[#3A3DFF] animate-spin" />
      </div>
    );
  }

  if (trending.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-orange-50 to-red-50 rounded-3xl border-3 border-orange-200 p-6 shadow-xl"
    >
      <div className="flex items-center gap-3 mb-6">
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center"
        >
          <Flame className="w-5 h-5 text-white" fill="white" />
        </motion.div>
        <div>
          <h2 className="text-xl font-black text-slate-900">Trending Now</h2>
          <p className="text-sm text-slate-600 font-semibold">AI-curated movements gaining momentum</p>
          <p className="text-xs text-slate-500 font-semibold mt-1">AI-generated — may be incomplete or inaccurate</p>
          {limitReached ? (
            <p className="text-xs text-slate-500 font-semibold mt-1">AI usage limit reached for this session.</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        {trending.map((movement, idx) => (
          <Link
            key={movement.id}
            to={`/movements/${encodeURIComponent(String(movement.id))}`}
            className="block relative overflow-hidden"
          >
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="p-5 bg-white rounded-2xl border-3 border-slate-200 hover:border-orange-400 transition-all group"
            >
              <div className="absolute top-3 right-3 w-8 h-8 bg-gradient-to-br from-orange-400 to-red-400 rounded-lg flex items-center justify-center shadow-lg">
                <span className="text-white font-black text-sm">#{idx + 1}</span>
              </div>

              <h3 className="font-black text-lg text-slate-900 group-hover:text-orange-600 transition-colors mb-3 pr-10">
                {movement.title}
              </h3>

              <div className="flex items-center justify-between">
                <div className="flex gap-2 flex-wrap flex-1">
                  {movement.tags?.slice(0, 2).map((tag, i) => (
                    <TagBadge key={i} tag={tag} />
                  ))}
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <TrendingUp className="w-4 h-4 text-orange-600" />
                  <span className="font-black text-orange-600 text-sm">
                    {movement.momentum_score > 0 ? '+' : ''}{movement.momentum_score}
                  </span>
                </div>
              </div>
            </motion.div>
          </Link>
        ))}
      </div>
    </motion.div>
  );
}
