import React, { useEffect, useMemo, useState } from 'react';
import { entities } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { logError } from '@/utils/logError';

/**
 * Emotional Temperature / Intensity Detection
 * Detects high-intensity movements that may require warnings
 */

export class IntensityDetector {
  
  /**
   * Analyze movement content for emotional intensity
   */
  static async analyzeMovement(movement) {
    try {
      const content = `${movement.title} ${movement.description}`.toLowerCase();
      
      // Keywords indicating different warning flags
      const urgentKeywords = ['urgent', 'now', 'immediately', 'emergency', 'crisis', 'act fast', 'time sensitive'];
      const controversialKeywords = ['ban', 'boycott', 'protest', 'expose', 'corruption', 'scandal', 'demand'];
      const strongClaimKeywords = ['proof', 'evidence shows', 'clearly', 'undeniable', 'fact', 'definitely'];
      const riskKeywords = ['confront', 'action required', 'show up', 'physical', 'location', 'meet at'];
      
      const warningFlags = [];
      
      if (urgentKeywords.some(kw => content.includes(kw))) {
        warningFlags.push('urgent_action');
      }
      if (controversialKeywords.some(kw => content.includes(kw))) {
        warningFlags.push('controversial');
      }
      if (strongClaimKeywords.some(kw => content.includes(kw))) {
        warningFlags.push('strong_claims');
      }
      if (riskKeywords.some(kw => content.includes(kw))) {
        warningFlags.push('real_world_risk');
      }
      
      // Determine intensity level
      let intensityLevel = 'low';
      let requiresFriction = false;
      
      if (warningFlags.length >= 3) {
        intensityLevel = 'critical';
        requiresFriction = true;
      } else if (warningFlags.length >= 2) {
        intensityLevel = 'high';
        requiresFriction = true;
      } else if (warningFlags.length >= 1) {
        intensityLevel = 'medium';
        requiresFriction = false;
      }
      
      // Check if intensity record exists
      const existing = await entities.MovementIntensity.filter({
        movement_id: movement.id
      }, null, { limit: 1, fields: ['id', 'movement_id'] });
      
      const intensityData = {
        movement_id: movement.id,
        intensity_level: intensityLevel,
        warning_flags: warningFlags,
        requires_friction: requiresFriction,
        auto_detected: true,
        detection_confidence: warningFlags.length / 4 // 0-1 score
      };
      
      if (existing.length > 0) {
        await entities.MovementIntensity.update(existing[0].id, intensityData);
      } else {
        await entities.MovementIntensity.create(intensityData);
      }
      
      return intensityData;
    } catch (error) {
      // Use logError for structured error logging if needed
      return null;
    }
  }

  /**
   * Check if movement requires emotional temperature warning
   */
  static async requiresWarning(movementId) {
    try {
      // Check user preference
      const skipWarnings = localStorage.getItem('peoplepower_skip_intensity_warnings');
      if (skipWarnings === 'true') return false;
      
      const intensities = await entities.MovementIntensity.filter({
        movement_id: movementId
      }, null, { limit: 1, fields: ['id', 'movement_id', 'requires_friction'] });
      
      if (intensities.length === 0) return false;
      
      return intensities[0].requires_friction;
    } catch (error) {
      logError(error, 'IntensityDetector warning requirement check failed');
      return false;
    }
  }

  /**
   * Detect harassment patterns in comments
   */
  static async detectHarassment(movementId) {
    try {
      const comments = await entities.Comment.filter({ movement_id: movementId }, '-created_date', {
        limit: 300,
        fields: ['id', 'movement_id', 'user_email', 'content', 'created_date'],
      });
      
      // Get recent comments (last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentComments = comments.filter(c => 
        new Date(c.created_date) > oneHourAgo
      );
      
      // Signals of harassment
      let signals = 0;
      
      // High volume of comments in short time
      if (recentComments.length > 20) {
        signals += 2;
      }
      
      // Multiple comments from same user
      const userCounts = {};
      recentComments.forEach(c => {
        userCounts[c.user_email] = (userCounts[c.user_email] || 0) + 1;
      });
      const repeatedUsers = Object.values(userCounts).filter(count => count > 3).length;
      if (repeatedUsers > 0) {
        signals += repeatedUsers;
      }
      
      // Negative sentiment keywords
      const negativeKeywords = ['hate', 'idiot', 'stupid', 'fake', 'liar', 'scam'];
      const negativeComments = recentComments.filter(c => 
        negativeKeywords.some(kw => c.content.toLowerCase().includes(kw))
      );
      if (negativeComments.length > 5) {
        signals += 2;
      }
      
      // If signals detected, auto-enable protection
      if (signals >= 3) {
        const protections = await entities.HarassmentProtection.filter({
          entity_type: 'movement',
          entity_id: movementId
        }, null, { limit: 1, fields: ['id', 'slow_mode_enabled'] });
        
        if (protections.length === 0) {
          await entities.HarassmentProtection.create({
            entity_type: 'movement',
            entity_id: movementId,
            slow_mode_enabled: true,
            slow_mode_seconds: 60,
            auto_enabled: true,
            harassment_signals_detected: signals,
            enabled_by: 'system'
          });
        } else {
          await entities.HarassmentProtection.update(protections[0].id, {
            harassment_signals_detected: signals,
            auto_enabled: true,
            slow_mode_enabled: signals >= 5 ? true : protections[0].slow_mode_enabled
          });
        }
      }
      
      return signals;
    } catch (error) {
      logError(error, 'IntensityDetector harassment detection failed');
      return 0;
    }
  }
}

export default function IntensityDetectorComponent() {
  return <IntensityDetectorPanel />;
}

export function IntensityDetectorPanel({ movement, className = '' }) {
  const movementId = String(movement?.id ?? movement?._id ?? '').trim();
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const flags = Array.isArray(result?.warning_flags) ? result.warning_flags : [];

  const levelMeta = useMemo(() => {
    const lvl = String(result?.intensity_level || 'low');
    if (lvl === 'critical') return { label: 'Critical', cls: 'text-orange-600' };
    if (lvl === 'high') return { label: 'High', cls: 'text-yellow-600' };
    if (lvl === 'medium') return { label: 'Medium', cls: 'text-slate-700' };
    return { label: 'Low', cls: 'text-slate-600' };
  }, [result]);

  useEffect(() => {
    let cancelled = false;
    async function loadExisting() {
      if (!movementId) return;
      try {
        const existing = await entities.MovementIntensity.filter({ movement_id: movementId }, null, {
          limit: 1,
          fields: ['id', 'movement_id', 'intensity_level', 'warning_flags', 'requires_friction', 'detection_confidence'],
        });
        if (!cancelled) setResult(existing?.[0] || null);
      } catch {
        if (!cancelled) setResult(null);
      }
    }
    loadExisting();
    return () => {
      cancelled = true;
    };
  }, [movementId]);

  const run = async () => {
    if (!movementId || !movement) return;
    setRunning(true);
    try {
      const r = await IntensityDetector.analyzeMovement(movement);
      setResult(r);
    } finally {
      setRunning(false);
    }
  };

  if (!movementId) {
    return (
      <div className={cn('p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600', className)}>
        Intensity detector is available once a movement is loaded.
      </div>
    );
  }

  return (
    <div className={cn('p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4', className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-black text-slate-900">Intensity check</div>
          <div className="text-sm text-slate-600 font-semibold">Heuristic scan for urgency / risk cues.</div>
        </div>
        <Button type="button" variant="outline" className="rounded-xl font-black" onClick={run} disabled={running || !movement}>
          {running ? 'Scanning…' : 'Scan'}
        </Button>
      </div>

      {result ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Level</div>
            <div className={cn('text-lg font-black', levelMeta.cls)}>{levelMeta.label}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Flags</div>
            <div className="text-lg font-black text-slate-900">{flags.length}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Friction</div>
            <div className="text-lg font-black text-slate-900">{result?.requires_friction ? 'On' : 'Off'}</div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-slate-600 font-semibold">No scan recorded yet.</div>
      )}

      {flags.length > 0 ? (
        <div className="text-sm text-slate-700 font-semibold">
          <div className="font-black text-slate-900 mb-2">Flags</div>
          <div className="flex flex-wrap gap-2">
            {flags.map((f) => (
              <span key={f} className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-black text-slate-700">
                {String(f).replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
