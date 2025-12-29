import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { TrendingUp, Loader2, Target, Users, BarChart3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from "sonner";
import EthicalAIWrapper from '../ai/EthicalAIWrapper';
import { integrations } from "@/api/appClient";
import {
  cacheAIResult,
  getCachedAIResult,
  hasExceededAILimit,
  incrementAICounter,
  hashPayload,
} from '@/utils/aiGuardrail';

export default function ImpactProjector({ movementData, onProjectionGenerated }) {
  const [generating, setGenerating] = useState(false);
  const [goals, setGoals] = useState(movementData.impact_goals?.join('\n') || '');
  const [targetAudience, setTargetAudience] = useState(movementData.target_audience || '');
  const [projection, setProjection] = useState(null);
  const [limitNotice, setLimitNotice] = useState('');

  const generateProjection = async () => {
    setLimitNotice('');
    if (!movementData.title || !movementData.description) {
      toast.error('Please complete movement title and description first');
      return;
    }

    if (hasExceededAILimit()) {
      setLimitNotice('AI usage limit reached for this session.');
      return;
    }

    setGenerating(true);
    try {
      const payloadHash = hashPayload({
        movementId: movementData?.id ?? movementData?._id ?? null,
        title: movementData.title,
        description: movementData.description,
        tags: movementData.tags || [],
        location: movementData.location || null,
        goals,
        targetAudience,
      });

      const cached = getCachedAIResult('aiImpactProjection', payloadHash);
      if (cached) {
        setProjection(cached);
        return;
      }

      incrementAICounter();
      const response = await integrations.Core.InvokeLLM({
        prompt: `Analyze this movement and provide ESTIMATED impact projections (NOT certainties):

Movement: "${movementData.title}"
Description: "${movementData.description}"
Tags: ${movementData.tags?.join(', ') || 'None'}
Location: ${movementData.location?.city ? `${movementData.location.city}, ${movementData.location.country}` : 'Global'}
Goals: ${goals || 'Not specified'}
Target Audience: ${targetAudience || 'General public'}

CRITICAL CONSTRAINTS:
- Frame ALL outputs as estimates and possibilities, NOT predictions or certainties
- Use language like "may potentially", "could reach", "estimated", "possible"
- NO prescriptive language or moral judgments
- Present options, not commands

Based on similar movements and current trends, provide ESTIMATES for:
1. Estimated reach range (people who might potentially engage)
2. Impact score estimate (0-100, considering feasibility, relevance, timing)
3. Possible success factors (3-4 factors)
4. Potential challenges (3-4 challenges)
5. Estimated timeline for possible impact (in weeks)
6. Suggested next steps (3-4 options to consider)`,
        response_json_schema: {
          type: "object",
          properties: {
            projected_reach: { type: "number" },
            impact_score: { type: "number" },
            success_factors: {
              type: "array",
              items: { type: "string" }
            },
            challenges: {
              type: "array",
              items: { type: "string" }
            },
            timeline_weeks: { type: "number" },
            next_steps: {
              type: "array",
              items: { type: "string" }
            },
            confidence_level: { type: "string" }
          }
        }
      });

      setProjection(response);
      cacheAIResult('aiImpactProjection', payloadHash, response);
      if (onProjectionGenerated) {
        onProjectionGenerated({
          projected_reach: response.projected_reach,
          projected_impact_score: response.impact_score,
          impact_goals: goals.split('\n').filter(g => g.trim()),
          target_audience: targetAudience
        });
      }
    } catch {
      toast.error('Failed to generate projection');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <EthicalAIWrapper type="prediction">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border-3 border-green-200 p-6 shadow-xl"
      >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900">Impact Projector</h3>
          <p className="text-sm text-slate-600 font-semibold">Predict your movement&apos;s reach and impact</p>
        </div>
      </div>

      <div className="space-y-4">
        {limitNotice ? (
          <div className="text-xs font-semibold text-slate-600">{limitNotice}</div>
        ) : null}
        <div>
          <label className="text-xs font-bold text-slate-700 uppercase mb-2 block">
            Impact Goals (one per line)
          </label>
          <Textarea
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            placeholder="e.g., Reduce plastic waste by 30%&#10;Engage 1000 volunteers&#10;Pass local ordinance"
            className="h-24 rounded-xl border-2 resize-none"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 uppercase mb-2 block">
            Target Audience
          </label>
          <Input
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder="e.g., Young professionals in urban areas"
            className="rounded-xl border-2"
          />
        </div>

        <Button
          onClick={generateProjection}
          disabled={generating}
          className="w-full h-12 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 rounded-xl font-bold"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <BarChart3 className="w-4 h-4 mr-2" />
              Generate Projection
            </>
          )}
        </Button>
      </div>

      {projection && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 space-y-4"
        >
          <div className="text-xs font-semibold text-slate-500">AI-generated — may be incomplete or inaccurate</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-600 uppercase">Estimated Reach</span>
              </div>
              <p className="text-3xl font-black text-slate-900">~{projection.projected_reach.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-1">Estimate only</p>
            </div>
            <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-green-600" />
                <span className="text-xs font-bold text-slate-600 uppercase">Impact Score</span>
              </div>
              <p className="text-3xl font-black text-slate-900">{projection.impact_score}/100</p>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
            <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">Success Factors</h4>
            <ul className="space-y-1">
              {projection.success_factors?.map((factor, i) => (
                <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                  <span className="text-green-500">✓</span>
                  {factor}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
            <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">Potential Challenges</h4>
            <ul className="space-y-1">
              {projection.challenges?.map((challenge, i) => (
                <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                  <span className="text-orange-500">⚠</span>
                  {challenge}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
            <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">Recommended Next Steps</h4>
            <ul className="space-y-1">
              {projection.next_steps?.map((step, i) => (
                <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                  <span className="text-blue-500">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border-2 border-indigo-200">
            <p className="text-sm text-slate-700">
              <strong>Estimated Timeline:</strong> May potentially see measurable impact in approximately{' '}
              <strong className="text-[#3A3DFF]">{projection.timeline_weeks} weeks</strong> with consistent effort.
            </p>
            <p className="text-xs text-slate-500 mt-1">This is an estimate, not a guarantee</p>
          </div>
        </motion.div>
      )}
      </motion.div>
    </EthicalAIWrapper>
  );
}