/**
 * Reports API client.
 *
 * Network-backed (Node server) endpoints (see Server/index.js):
 * - POST  /reports      -> Report
 * - GET   /reports      -> Report[] (requires staff auth)
 * - PATCH /reports/:id  -> Report (staff updates; `action_taken` is admin-only)
 *
 * Behavior:
 * - Network-first.
 * - Falls back to local stub entities if the backend is unavailable.
 *
 * @typedef {Object} Report
 * @property {string} id
 * @property {string} reporter_email
 * @property {string} reported_content_type
 * @property {string} reported_content_id
 * @property {string} report_category
 * @property {string|null} report_details
 * @property {string|null} evidence_file_url
 * @property {'pending'|'reviewing'|'resolved'|'dismissed'|string} status
 * @property {string|null} priority
 * @property {boolean|null} is_repeat_report
 * @property {string|null} created_at
 * @property {string|null} updated_at
 * @property {string|null} moderator_email
 * @property {string|null} moderator_notes
 * @property {string|null} action_taken
 */

import { entities } from '@/api/appClient';

const isDev = import.meta?.env?.DEV;
const BASE_URL = isDev
  ? (import.meta?.env?.VITE_SERVER_URL || 'http://localhost:3001')
  : (import.meta?.env?.VITE_API_BASE_URL || '/api');

function normalizeId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeEmail(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return s || null;
}

function nowIso() {
  return new Date().toISOString();
}

function looksLikeNetworkError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed') ||
    msg.includes('ECONNREFUSED')
  );
}

async function createLocalReport(payload, options) {
  const reporterEmail = normalizeEmail(options?.reporterEmail);
  const reportedContentType = payload?.reported_content_type ? String(payload.reported_content_type) : null;
  const reportedContentId = payload?.reported_content_id ? String(payload.reported_content_id) : null;
  const reportCategory = payload?.report_category ? String(payload.report_category) : null;

  if (!reporterEmail) throw new Error('Authentication required');
  if (!reportedContentType || !reportedContentId) throw new Error('Reported content is required');
  if (!reportCategory) throw new Error('Report reason is required');

  const existing = await entities.Report.filter({
    reporter_email: reporterEmail,
    reported_content_type: reportedContentType,
    reported_content_id: reportedContentId,
  });

  const isRepeatReport = Array.isArray(existing) && existing.length > 0;

  const created = await entities.Report.create({
    reporter_email: reporterEmail,
    reported_content_type: reportedContentType,
    reported_content_id: reportedContentId,
    report_category: reportCategory,
    report_details: payload?.report_details != null ? String(payload.report_details) : null,
    evidence_file_url: payload?.evidence_file_url ? String(payload.evidence_file_url) : null,
    created_at: nowIso(),
    updated_at: nowIso(),
    status: 'pending',
    priority: payload?.priority ? String(payload.priority) : 'normal',
    is_repeat_report: isRepeatReport,
  });

  // Lightweight local reporter stats (anti-abuse signals)
  try {
    const stats = await entities.UserReportStats.filter({ user_email: reporterEmail });
    if (Array.isArray(stats) && stats.length > 0) {
      const s = stats[0];
      await entities.UserReportStats.update(s.id, {
        reports_submitted: Number(s?.reports_submitted || 0) + 1,
        last_report_at: nowIso(),
      });
    } else {
      await entities.UserReportStats.create({
        user_email: reporterEmail,
        reports_submitted: 1,
        accurate_reports: 0,
        false_reports: 0,
        reporting_disabled_until: null,
        last_report_at: nowIso(),
      });
    }
  } catch {
    // ignore
  }

  return created;
}

export async function createReport(payload, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/reports`;

  // Network-first; local fallback when server is unavailable.
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload ?? {}),
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to submit report: ${res.status}`;
      throw new Error(message);
    }

    return body;
  } catch (e) {
    if (!looksLikeNetworkError(e)) throw e;
    return createLocalReport(payload, options);
  }
}

export async function fetchReports(params, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const status = params?.status ? String(params.status) : null;

  const query = new URLSearchParams();
  if (status) query.set('status', status);

  const url = `${BASE_URL.replace(/\/$/, '')}/reports${query.toString() ? `?${query}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to fetch reports: ${res.status}`;
      throw new Error(message);
    }

    return Array.isArray(body) ? body : body?.reports || [];
  } catch (e) {
    if (!looksLikeNetworkError(e)) throw e;
    const where = status ? { status } : null;
    const local = status ? await entities.Report.filter(where) : await entities.Report.list();
    return Array.isArray(local) ? local : [];
  }
}

export async function updateReport(id, payload, options) {
  const reportId = normalizeId(id);
  if (!reportId) throw new Error('Report ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/reports/${encodeURIComponent(reportId)}`;

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload ?? {}),
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to update report: ${res.status}`;
      throw new Error(message);
    }

    return body;
  } catch (e) {
    if (!looksLikeNetworkError(e)) throw e;
    const patch = { ...(payload ?? {}), updated_at: nowIso() };
    return entities.Report.update(reportId, patch);
  }
}
