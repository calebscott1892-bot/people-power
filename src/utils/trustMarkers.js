import { EARLY_MEMBER_CUTOFF_ISO } from '@/config/trustMarkers';

function toFiniteNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return null;
  const d = new Date(raw);
  // Invalid date
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function computeBoostsEarned(movements) {
  if (!Array.isArray(movements)) return 0;
  return movements.reduce((sum, m) => sum + toFiniteNumber(m?.boosts_count ?? m?.upvotes ?? m?.boosts), 0);
}

export function getSoftTrustMarkers({ movementsPosted = 0, boostsEarned = 0, joinedAt } = {}) {
  const markers = [];

  if (toFiniteNumber(movementsPosted) >= 3) markers.push('Active Member');
  if (toFiniteNumber(boostsEarned) >= 10) markers.push('Community Builder');

  const joinedIso = toIso(joinedAt);
  const cutoffIso = toIso(EARLY_MEMBER_CUTOFF_ISO);
  if (joinedIso && cutoffIso && joinedIso <= cutoffIso) markers.push('Early Member');

  return markers;
}
