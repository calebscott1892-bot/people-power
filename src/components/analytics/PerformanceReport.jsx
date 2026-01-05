import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { FileText, Loader2, Download } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { toast } from "sonner";
import { integrations } from "@/api/appClient";
import {
  cacheAIResult,
  getCachedAIResult,
  hasExceededAILimit,
  incrementAICounter,
  hashPayload,
} from '@/utils/aiGuardrail';

export default function PerformanceReport({ movement }) {
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);
  const [limitNotice, setLimitNotice] = useState('');

  const generateReport = async () => {
    setLimitNotice('');
    if (hasExceededAILimit()) {
      setLimitNotice('AI usage limit reached for this session.');
      return;
    }
    setGenerating(true);
    try {
      const daysSinceLaunch = Math.floor((Date.now() - new Date(movement.created_date)) / (1000 * 60 * 60 * 24));
      const totalParticipants = movement.verified_participants || 0;

      const payloadHash = hashPayload({
        movementId: movement?.id ?? movement?._id ?? null,
        title: movement?.title,
        created_date: movement?.created_date,
        tags: movement?.tags || [],
        metrics: {
          boosts: movement?.boosts_count ?? movement?.upvotes ?? movement?.boosts ?? 0,
          supporters: movement?.supporters || 0,
          participants: totalParticipants,
          momentum_score: movement?.momentum_score || 0,
          actual_reach: movement?.actual_reach || 0,
          projected_reach: movement?.projected_reach || null,
          engagement_rate: movement?.impact_metrics?.engagement_rate || 0,
          growth_rate: movement?.impact_metrics?.growth_rate || 0,
          conversion_rate: movement?.impact_metrics?.conversion_rate || 0,
        },
      });

      const cached = getCachedAIResult('aiPerformanceReport', payloadHash);
      if (cached) {
        setReport(cached);
        return;
      }

      incrementAICounter();
      
      const response = await integrations.Core.InvokeLLM({
        prompt: `Generate a comprehensive performance report for this movement:

Movement: "${movement.title}"
Launched: ${format(new Date(movement.created_date), 'MMM d, yyyy')} (${daysSinceLaunch} days ago)
Tags: ${movement.tags?.join(', ') || 'None'}
Location: ${movement.location?.city ? `${movement.location.city}, ${movement.location.country}` : 'Global'}

Current Metrics:
- Boosts: ${movement.boosts || 0}
- Supporters: ${movement.supporters || 0}
- Participants: ${totalParticipants}
- Momentum Score: ${movement.momentum_score || 0}
- Actual Reach: ${movement.actual_reach || 0}
- Projected Reach: ${movement.projected_reach || 'Not set'}

Metrics Over Time:
- Daily Engagement Rate: ${movement.impact_metrics?.engagement_rate || 0}%
- Growth Rate: ${movement.impact_metrics?.growth_rate || 0}%
- Conversion Rate: ${movement.impact_metrics?.conversion_rate || 0}%

Provide a detailed report with:
1. Executive Summary (2-3 sentences)
2. Key Performance Highlights (3-4 metrics with insights)
3. Trend Analysis (growth patterns, engagement trends)
4. Areas of Success (what's working well)
5. Areas for Improvement (specific actionable recommendations)
6. Comparison to similar movements (if applicable)`,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            key_highlights: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  metric: { type: "string" },
                  value: { type: "string" },
                  insight: { type: "string" },
                  trend: { type: "string" }
                }
              }
            },
            trend_analysis: { type: "string" },
            success_areas: {
              type: "array",
              items: { type: "string" }
            },
            improvement_areas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            },
            comparison: { type: "string" },
            overall_health_score: { type: "number" }
          }
        }
      });

      setReport(response);
      cacheAIResult('aiPerformanceReport', payloadHash, response);
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const exportReport = () => {
    if (!report) return;
    
    const reportText = `
PERFORMANCE REPORT: ${movement.title}
Generated: ${format(new Date(), 'MMM d, yyyy h:mm a')}

EXECUTIVE SUMMARY
${report.executive_summary}

KEY HIGHLIGHTS
${report.key_highlights?.map(h => `- ${h.metric}: ${h.value}\n  ${h.insight} (${h.trend})`).join('\n')}

TREND ANALYSIS
${report.trend_analysis}

SUCCESS AREAS
${report.success_areas?.map((s, i) => `${i + 1}. ${s}`).join('\n')}

IMPROVEMENT RECOMMENDATIONS
${report.improvement_areas?.map((a, i) => `${i + 1}. ${a.area}\n   ${a.recommendation}`).join('\n')}

COMPARISON
${report.comparison}

Overall Health Score: ${report.overall_health_score}/100
    `.trim();

    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${movement.title.replace(/[^a-z0-9]/gi, '_')}_report.txt`;
    a.click();
    toast.success('Report exported!');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border-3 border-blue-200 p-6 shadow-xl"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900">Performance Report</h3>
            <p className="text-sm text-slate-600 font-semibold">Comprehensive analytics summary</p>
          </div>
        </div>
        {report && (
          <Button onClick={exportReport} size="sm" variant="outline" className="rounded-xl font-bold">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        )}
      </div>

      {limitNotice ? (
        <div className="text-xs font-semibold text-slate-600 mb-3">{limitNotice}</div>
      ) : report ? (
        <div className="text-xs font-semibold text-slate-500 mb-3">AI-generated — may be incomplete or inaccurate</div>
      ) : null}

      {!report ? (
        <Button
          onClick={generateReport}
          disabled={generating}
          className="w-full h-12 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 rounded-xl font-bold"
        >
          {generating ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating Report...</>
          ) : (
            <><FileText className="w-4 h-4 mr-2" />Generate Report</>
          )}
        </Button>
      ) : (
        <div className="space-y-4">
          {/* Health Score */}
          <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-slate-600 uppercase">Overall Health</span>
              <span className={`text-3xl font-black ${
                report.overall_health_score >= 70 ? 'text-green-600' :
                report.overall_health_score >= 40 ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {report.overall_health_score}/100
              </span>
            </div>
            <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${report.overall_health_score}%` }}
                className={`h-full ${
                  report.overall_health_score >= 70 ? 'bg-green-500' :
                  report.overall_health_score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
              />
            </div>
          </div>

          {/* Executive Summary */}
          <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
            <h4 className="text-sm font-black text-slate-900 uppercase mb-2">Executive Summary</h4>
            <p className="text-slate-700 leading-relaxed">{report.executive_summary}</p>
          </div>

          {/* Key Highlights */}
          <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
            <h4 className="text-sm font-black text-slate-900 uppercase mb-3">Key Highlights</h4>
            <div className="space-y-3">
              {report.key_highlights?.map((highlight, i) => (
                <div key={i} className="flex gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-slate-900">{highlight.metric}</span>
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-bold">
                        {highlight.trend}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-[#3A3DFF] mb-1">{highlight.value}</p>
                    <p className="text-sm text-slate-600">{highlight.insight}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trend Analysis */}
          <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
            <h4 className="text-sm font-black text-slate-900 uppercase mb-2">Trend Analysis</h4>
            <p className="text-slate-700 leading-relaxed">{report.trend_analysis}</p>
          </div>

          {/* Success Areas */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border-2 border-green-200">
            <h4 className="text-sm font-black text-slate-900 uppercase mb-2">What&apos;s Working</h4>
            <ul className="space-y-1">
              {report.success_areas?.map((area, i) => (
                <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                  <span className="text-green-500">✓</span>
                  {area}
                </li>
              ))}
            </ul>
          </div>

          {/* Improvements */}
          <div className="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-xl p-4 border-2 border-orange-200">
            <h4 className="text-sm font-black text-slate-900 uppercase mb-3">Recommended Improvements</h4>
            <div className="space-y-3">
              {report.improvement_areas?.map((item, i) => (
                <div key={i}>
                  <p className="font-bold text-slate-900 text-sm mb-1">{item.area}</p>
                  <p className="text-sm text-slate-600">{item.recommendation}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
