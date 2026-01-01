import { entities } from '@/api/appClient';

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REPORTS = 3;

export function normalizeReporterEmail(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return s || null;
}

function getRateKey(email) {
  return `peoplepower_report_rate:${email}`;
}

export function loadRecentReportTimes(email) {
  const key = getRateKey(email);
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr
      .map((t) => Number(t))
      .filter((t) => Number.isFinite(t))
      .filter((t) => now - t < RATE_WINDOW_MS);
  } catch {
    return [];
  }
}

export function saveRecentReportTimes(email, times) {
  const key = getRateKey(email);
  try {
    localStorage.setItem(key, JSON.stringify(times));
  } catch {
    // ignore
  }
}

export async function checkReportingEligibility(reporterEmail) {
  if (!reporterEmail) return { ok: false, reason: 'Please sign in to submit a report' };

  // Local anti-abuse gate (can be extended by admin tooling)
  try {
    const stats = await entities.UserReportStats.filter({ user_email: reporterEmail });
    const record = Array.isArray(stats) && stats.length ? stats[0] : null;
    const disabledUntil = record?.reporting_disabled_until ? new Date(record.reporting_disabled_until) : null;
    if (disabledUntil && !Number.isNaN(disabledUntil.getTime())) {
      if (disabledUntil.getTime() > Date.now()) {
        return { ok: false, reason: 'Reporting is temporarily disabled for this account.' };
      }
    }
  } catch {
    // ignore
  }

  const times = loadRecentReportTimes(reporterEmail);
  if (times.length >= RATE_MAX_REPORTS) {
    return { ok: false, reason: 'You’ve submitted several reports recently. Please wait and try again.' };
  }

  return { ok: true };
}
