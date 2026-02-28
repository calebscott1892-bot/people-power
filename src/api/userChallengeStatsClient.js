import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';
import { getAwTimeKey } from '@/utils/awTime';

const BASE = () => String(SERVER_BASE || '').replace(/\/+$/, '');

async function safeReadJson(res) {
  try { return await res.json(); } catch { return null; }
}

function normalizeEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  return s || null;
}

export async function fetchOrCreateUserChallengeStats(_userEmail) {
  const url = `${BASE()}/challenge-stats`;
  const res = await httpFetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body?.error || body?.message || 'Failed to load challenge stats';
    throw new Error(msg);
  }
  return body || null;
}

export async function unlockExpressionReward(userEmail, reward) {
  if (!reward?.id) throw new Error('Invalid reward');
  const url = `${BASE()}/challenge-stats/unlock`;
  const res = await httpFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: String(reward.type || ''),
      id: String(reward.id || ''),
      points: Number(reward.points || 0),
    }),
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body?.error || body?.message || 'Failed to unlock reward';
    throw new Error(msg);
  }
  return body || null;
}

function todayKey() {
  return getAwTimeKey();
}

export async function listChallengeCompletions({ userEmail } = {}) {
  const email = normalizeEmail(userEmail);
  let url = `${BASE()}/challenge-completions`;
  if (email) url += `?user_email=${encodeURIComponent(email)}`;
  const res = await httpFetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body?.error || body?.message || 'Failed to load completions';
    throw new Error(msg);
  }
  return Array.isArray(body) ? body : [];
}

export async function recordChallengeCompletion(userEmail, challenge, completionPayload) {
  const email = normalizeEmail(userEmail);
  if (!email) throw new Error('Missing user email');
  if (!challenge?.id) throw new Error('Missing challenge');

  const t = todayKey();
  const challengeId = String(challenge.id);
  const points = Number(challenge?.points || 0) || 0;

  const evidenceText = completionPayload?.evidence_text ? String(completionPayload.evidence_text) : null;
  const evidenceImageUrl = completionPayload?.evidence_image_url ? String(completionPayload.evidence_image_url) : null;
  const derivedEvidenceType = (() => {
    const hasText = !!(evidenceText && evidenceText.trim());
    const hasImage = !!evidenceImageUrl;
    if (hasText && hasImage) return 'text_image';
    if (hasText) return 'text';
    if (hasImage) return 'image';
    return String(completionPayload?.evidence_type || 'none');
  })();

  const url = `${BASE()}/challenge-completions`;
  const res = await httpFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge_id: challengeId,
      date: t,
      points,
      evidence_type: derivedEvidenceType,
      evidence_text: evidenceText,
      evidence_image_url: evidenceImageUrl,
    }),
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body?.error || body?.message || 'Failed to record completion';
    throw new Error(msg);
  }
  return body?.completion || body || null;
}
