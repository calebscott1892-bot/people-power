import { entities } from '@/api/appClient';
import { createIncident } from '@/api/incidentsClient';
import { isAdmin } from '@/utils/staff';

const IS_DEV = !!import.meta?.env?.DEV;

function now() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return s || null;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function storageKey(email, action, contextId) {
  const ctx = contextId ? String(contextId) : 'global';
  return `peoplepower_action_rate:${email}:${action}:${ctx}`;
}

function loadTimes(key, windowMs) {
  if (!IS_DEV) return [];
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    const cutoff = now() - windowMs;
    return arr
      .map((t) => Number(t))
      .filter((t) => Number.isFinite(t))
      .filter((t) => t >= cutoff);
  } catch {
    return [];
  }
}

function saveTimes(key, times) {
  if (!IS_DEV) return;
  try {
    localStorage.setItem(key, JSON.stringify(times.slice(-200)));
  } catch {
    // ignore
  }
}

async function getHeuristicTrustScore(email) {
  if (!IS_DEV) return 0.55;
  const userEmail = normalizeEmail(email);
  if (!userEmail) return 0.5;

  // Prefer stored trust score if present.
  try {
    const found = await entities.UserTrustScore.filter({ user_email: userEmail });
    const record = Array.isArray(found) && found.length ? found[0] : null;
    const stored = record?.trust_score ?? record?.score;
    const n = Number(stored);
    if (Number.isFinite(n)) return clamp(n, 0.05, 0.95);
  } catch {
    // ignore
  }

  // Heuristic based on report accuracy signals (if available).
  let score = 0.55;
  try {
    const stats = await entities.UserReportStats.filter({ user_email: userEmail });
    const s = Array.isArray(stats) && stats.length ? stats[0] : null;
    const accurate = Number(s?.accurate_reports || 0) || 0;
    const falseReports = Number(s?.false_reports || 0) || 0;

    if (accurate >= 3) score += 0.15;
    if (accurate >= 10) score += 0.1;
    if (falseReports >= 2) score -= 0.2;
    if (falseReports >= 5) score -= 0.15;
  } catch {
    // ignore
  }

  score = clamp(score, 0.15, 0.9);

  // Best-effort persist so future checks are cheap.
  try {
    const existing = await entities.UserTrustScore.filter({ user_email: userEmail });
    const record = Array.isArray(existing) && existing.length ? existing[0] : null;
    if (record?.id) {
      await entities.UserTrustScore.update(record.id, {
        trust_score: score,
        updated_at: nowIso(),
      });
    } else {
      await entities.UserTrustScore.create({
        user_email: userEmail,
        trust_score: score,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
  } catch {
    // ignore
  }

  return score;
}

function limitsFor(action, trustScore) {
  // Minimal defaults: tighter for low-trust accounts.
  const t = Number.isFinite(trustScore) ? trustScore : 0.55;

  if (action === 'boost_vote') {
    return {
      windowMs: 5 * 60 * 1000,
      max: t >= 0.75 ? 20 : t >= 0.45 ? 10 : 5,
    };
  }

  if (action === 'comment_post') {
    return {
      windowMs: 60 * 1000,
      max: t >= 0.75 ? 12 : t >= 0.45 ? 6 : 3,
    };
  }

  if (action === 'movement_create') {
    return {
      windowMs: 60 * 60 * 1000,
      max: t >= 0.75 ? 4 : t >= 0.45 ? 2 : 1,
    };
  }

  if (action === 'collaborator_invite') {
    return {
      windowMs: 10 * 60 * 1000,
      max: t >= 0.75 ? 12 : t >= 0.45 ? 6 : 3,
    };
  }

  if (action === 'message_send') {
    return {
      windowMs: 60 * 1000,
      max: t >= 0.75 ? 30 : t >= 0.45 ? 15 : 8,
    };
  }

  if (action === 'conversation_create') {
    return {
      windowMs: 60 * 60 * 1000,
      max: t >= 0.75 ? 20 : t >= 0.45 ? 8 : 3,
    };
  }

  if (action === 'user_follow') {
    return {
      windowMs: 10 * 60 * 1000,
      max: t >= 0.75 ? 40 : t >= 0.45 ? 20 : 10,
    };
  }

  if (action === 'movement_follow') {
    return {
      windowMs: 10 * 60 * 1000,
      max: t >= 0.75 ? 40 : t >= 0.45 ? 20 : 10,
    };
  }

  if (action === 'petition_sign') {
    return {
      windowMs: 10 * 60 * 1000,
      max: t >= 0.75 ? 25 : t >= 0.45 ? 12 : 6,
    };
  }

  if (action === 'petition_create') {
    return {
      windowMs: 60 * 60 * 1000,
      max: t >= 0.75 ? 10 : t >= 0.45 ? 5 : 2,
    };
  }

  if (action === 'event_create') {
    return {
      windowMs: 60 * 60 * 1000,
      max: t >= 0.75 ? 12 : t >= 0.45 ? 6 : 3,
    };
  }

  if (action === 'movement_evidence_submit') {
    return {
      windowMs: 60 * 60 * 1000,
      max: t >= 0.75 ? 12 : t >= 0.45 ? 6 : 3,
    };
  }

  return {
    windowMs: 60 * 1000,
    max: t >= 0.75 ? 20 : t >= 0.45 ? 10 : 5,
  };
}

async function recordSuspiciousActivity({ email, action, contextId, reason, retryAfterMs, trustScore, accessToken }) {
  const userEmail = normalizeEmail(email);
  if (!userEmail) return;

  try {
    await entities.SuspiciousActivity.create({
      user_email: userEmail,
      activity_type: 'rate_limited',
      action,
      context_id: contextId ? String(contextId) : null,
      created_at: nowIso(),
      details: { reason },
    });
  } catch {
    // ignore
  }

  // Best-effort durable incident log (server). Metadata only.
  try {
    if (accessToken) {
      await createIncident(
        {
          event_type: 'rate_limited',
          trigger_system: 'client_rate_limit',
          human_reviewed: false,
          context: {
            action,
            context_id: contextId ? String(contextId) : null,
            retry_after_ms: Number.isFinite(Number(retryAfterMs)) ? Number(retryAfterMs) : 0,
            trust_score: Number.isFinite(Number(trustScore)) ? Number(trustScore) : null,
          },
        },
        { accessToken }
      );
    }
  } catch {
    // ignore
  }
}

export async function checkActionAllowed({ email, action, contextId, accessToken }) {
  if (!IS_DEV) {
    return { ok: true, retryAfterMs: 0, trustScore: null, bypassed: true };
  }
  const userEmail = normalizeEmail(email);
  if (!userEmail) {
    return { ok: false, retryAfterMs: 0, reason: 'Please log in to continue.' };
  }
  if (isAdmin(userEmail)) {
    return { ok: true, retryAfterMs: 0, trustScore: 1, bypassed: true };
  }

  const trustScore = await getHeuristicTrustScore(userEmail);
  const { windowMs, max } = limitsFor(action, trustScore);

  const key = storageKey(userEmail, action, contextId);
  const times = loadTimes(key, windowMs);

  if (times.length >= max) {
    const oldest = times[0];
    const retryAfterMs = Math.max(0, oldest + windowMs - now());
    const reason = 'Please slow down — this action is temporarily rate-limited to reduce brigading/spam.';
    await recordSuspiciousActivity({ email: userEmail, action, contextId, reason, retryAfterMs, trustScore, accessToken });
    return { ok: false, retryAfterMs, reason, trustScore };
  }

  saveTimes(key, [...times, now()]);
  return { ok: true, retryAfterMs: 0, trustScore };
}

export function formatWaitMs(ms) {
  const s = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  return `${s}s`;
}
