import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, Lightbulb, Target, Tag, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from "sonner";
import EthicalAIWrapper, { sanitizeAIOutput } from '../ai/EthicalAIWrapper';
import { integrations } from "@/api/appClient";
import {
  cacheAIResult,
  getCachedAIResult,
  hasExceededAILimit,
  incrementAICounter,
  hashPayload,
} from '@/utils/aiGuardrail';

export default function AIMovementAssistant({ onApplySuggestion, aiEnabled = true }) {
  const [activeTab, setActiveTab] = useState('ideas');
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [limitNotice, setLimitNotice] = useState('');

  const isAIEnabled = (() => {
    if (aiEnabled === false) return false;
    try {
      return localStorage.getItem('peoplepower_ai_opt_in') === 'true';
    } catch {
      return true;
    }
  })();

  const generateIdeas = async () => {
    setLimitNotice('');
    if (!isAIEnabled) {
      toast.error('Enable AI features in your profile to use this.');
      return;
    }
    if (!input.trim()) {
      toast.error('Please describe your interests or cause');
      return;
    }

    if (hasExceededAILimit()) {
      setLimitNotice('AI usage limit reached for this session.');
      return;
    }

    setGenerating(true);
    try {
      const promptPayload = { kind: 'movement_ideas', input: String(input) };
      const payloadHash = hashPayload(promptPayload);
      const cached = getCachedAIResult('aiMovementIdeas', payloadHash);
      if (cached) {
        setResult(cached);
        return;
      }

      incrementAICounter();
      const response = await integrations.Core.InvokeLLM({
        prompt: `Generate 3 creative movement ideas based on: "${input}"

CRITICAL CONSTRAINTS:
- Use neutral, informational language only
- NO prescriptive language ("you must", "you should", "you need to")
- NO moral judgments or ethical claims
- Present possibilities and options, not commands

For each movement, provide:
- A compelling title (5-8 words)
- A brief description (2-3 sentences, neutral tone)
- Why it could be relevant now

Make them actionable, inspiring, and specific without being prescriptive.`,
        response_json_schema: {
          type: "object",
          properties: {
            ideas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  why_now: { type: "string" }
                }
              }
            }
          }
        }
      });

      // Sanitize AI output
      const sanitized = {
        ideas: response.ideas?.map(idea => ({
          title: sanitizeAIOutput(idea.title),
          description: sanitizeAIOutput(idea.description),
          why_now: sanitizeAIOutput(idea.why_now)
        }))
      };
      setResult(sanitized);
      cacheAIResult('aiMovementIdeas', payloadHash, sanitized);
    } catch {
      toast.error('Failed to generate ideas');
    } finally {
      setGenerating(false);
    }
  };

  const draftDescription = async () => {
    setLimitNotice('');
    if (!isAIEnabled) {
      toast.error('Enable AI features in your profile to use this.');
      return;
    }
    if (!input.trim()) {
      toast.error('Please describe your movement idea');
      return;
    }

    if (hasExceededAILimit()) {
      setLimitNotice('AI usage limit reached for this session.');
      return;
    }

    setGenerating(true);
    try {
      const promptPayload = { kind: 'movement_description', input: String(input) };
      const payloadHash = hashPayload(promptPayload);
      const cached = getCachedAIResult('aiMovementDescription', payloadHash);
      if (cached) {
        setResult(cached);
        return;
      }

      incrementAICounter();
      const response = await integrations.Core.InvokeLLM({
        prompt: `Create a compelling movement description and objectives for: "${input}"

CRITICAL CONSTRAINTS:
- Use neutral, informational language
- NO prescriptive language ("you must", "you should")
- NO moral judgments
- Present options and possibilities, not commands

Include:
- A powerful opening statement
- Clear problem statement
- Specific goals and objectives
- Call to action (as suggestion, not command)

Keep it inspiring but concrete, around 200-250 words.`,
        response_json_schema: {
          type: "object",
          properties: {
            description: { type: "string" },
            objectives: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      // Sanitize AI output
      const sanitized = {
        description: sanitizeAIOutput(response.description),
        objectives: response.objectives?.map(obj => sanitizeAIOutput(obj))
      };
      setResult(sanitized);
      cacheAIResult('aiMovementDescription', payloadHash, sanitized);
    } catch {
      toast.error('Failed to draft description');
    } finally {
      setGenerating(false);
    }
  };

  const suggestTags = async () => {
    setLimitNotice('');
    if (!isAIEnabled) {
      toast.error('Enable AI features in your profile to use this.');
      return;
    }
    if (!input.trim()) {
      toast.error('Please describe your movement');
      return;
    }

    if (hasExceededAILimit()) {
      setLimitNotice('AI usage limit reached for this session.');
      return;
    }

    setGenerating(true);
    try {
      const promptPayload = { kind: 'movement_strategy', input: String(input) };
      const payloadHash = hashPayload(promptPayload);
      const cached = getCachedAIResult('aiMovementStrategy', payloadHash);
      if (cached) {
        setResult(cached);
        return;
      }

      incrementAICounter();
      const response = await integrations.Core.InvokeLLM({
        prompt: `For this movement: "${input}"

Suggest:
- 5-7 relevant tags (single words or short phrases)
- 3 outreach strategies to gain initial supporters
- 3 key messaging points

Make suggestions specific and actionable.`,
        response_json_schema: {
          type: "object",
          properties: {
            tags: {
              type: "array",
              items: { type: "string" }
            },
            outreach_strategies: {
              type: "array",
              items: { type: "string" }
            },
            messaging_points: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setResult(response);
      cacheAIResult('aiMovementStrategy', payloadHash, response);
    } catch {
      toast.error('Failed to generate suggestions');
    } finally {
      setGenerating(false);
    }
  };

  const tabs = [
    { id: 'ideas', label: 'Generate Ideas', icon: Lightbulb, action: generateIdeas },
    { id: 'description', label: 'Draft Description', icon: Target, action: draftDescription },
    { id: 'strategy', label: 'Tags & Strategy', icon: Users, action: suggestTags }
  ];

  return (
    <EthicalAIWrapper type="suggestion">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl border-3 border-purple-200 p-6 shadow-xl"
      >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900">AI Movement Assistant</h3>
          <p className="text-sm text-slate-600 font-semibold">Get help creating your movement</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setResult(null);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-lg'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Input */}
      <div className="space-y-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            activeTab === 'ideas' 
              ? "Describe your interests or cause (e.g., 'I care about local environmental issues and community gardens')"
              : activeTab === 'description'
              ? "Brief idea for your movement (e.g., 'Community cleanup initiative for local parks')"
              : "Describe your movement concept"
          }
          className="h-24 rounded-xl border-2 resize-none"
        />

        <Button
          onClick={tabs.find(t => t.id === activeTab).action}
          disabled={generating || !input.trim()}
          className="w-full h-12 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 rounded-xl font-bold"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate
            </>
          )}
        </Button>
      </div>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-4 space-y-3"
          >
            {limitNotice ? (
              <div className="text-xs font-semibold text-slate-600">{limitNotice}</div>
            ) : (
              <div className="text-xs font-semibold text-slate-500">AI-generated — may be incomplete or inaccurate</div>
            )}
            {activeTab === 'ideas' && result.ideas?.map((idea, idx) => (
              <div key={idx} className="bg-white rounded-xl p-4 border-2 border-slate-200">
                <h4 className="font-black text-slate-900 mb-2">{idea.title}</h4>
                <p className="text-sm text-slate-700 mb-2">{idea.description}</p>
                <p className="text-xs text-slate-500 mb-3">
                  <strong>Why now:</strong> {idea.why_now}
                </p>
                <Button
                  onClick={() => onApplySuggestion({ title: idea.title, description: idea.description })}
                  size="sm"
                  variant="outline"
                  className="font-bold"
                >
                  Use This Idea
                </Button>
              </div>
            ))}

            {activeTab === 'description' && (
              <div className="bg-white rounded-xl p-4 border-2 border-slate-200 space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase mb-1 block">Description</label>
                  <p className="text-sm text-slate-700">{result.description}</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase mb-1 block">Objectives</label>
                  <ul className="list-disc pl-5 space-y-1">
                    {result.objectives?.map((obj, idx) => (
                      <li key={idx} className="text-sm text-slate-700">{obj}</li>
                    ))}
                  </ul>
                </div>
                <Button
                  onClick={() => onApplySuggestion({ description: result.description })}
                  size="sm"
                  className="bg-purple-500 hover:bg-purple-600 font-bold"
                >
                  Use This Description
                </Button>
              </div>
            )}

            {activeTab === 'strategy' && (
              <div className="bg-white rounded-xl p-4 border-2 border-slate-200 space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase mb-2 block flex items-center gap-2">
                    <Tag className="w-3 h-3" />
                    Suggested Tags
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {result.tags?.map((tag, idx) => (
                      <span key={idx} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs font-bold">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <Button
                    onClick={() => onApplySuggestion({ tags: result.tags })}
                    size="sm"
                    variant="outline"
                    className="font-bold mt-2"
                  >
                    Add These Tags
                  </Button>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase mb-2 block">Outreach Strategies</label>
                  <ul className="list-disc pl-5 space-y-1">
                    {result.outreach_strategies?.map((strategy, idx) => (
                      <li key={idx} className="text-sm text-slate-700">{strategy}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase mb-2 block">Key Messages</label>
                  <ul className="list-disc pl-5 space-y-1">
                    {result.messaging_points?.map((point, idx) => (
                      <li key={idx} className="text-sm text-slate-700">{point}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      </motion.div>
    </EthicalAIWrapper>
  );
}