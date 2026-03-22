'use strict';

const { Resend } = require('resend');

// Lazy-init: only create the Resend client when actually needed,
// so the server still boots if the key isn't set.
let _resend = null;
function getResend() {
  if (!_resend) {
    const key = requireEnv('RESEND_API_KEY');
    _resend = new Resend(key);
  }
  return _resend;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Trim + truncate a string. Returns '' for non-strings. */
function safe(value, max = 5000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** Light email validation – only checks shape, not deliverability. */
function safeEmail(value) {
  const email = safe(value, 320);
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

/** Build a plain-text email body from key-value pairs, skipping empties. */
function buildTextBlock(fields) {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Core send wrapper
// ---------------------------------------------------------------------------

async function sendEmail({ from, to, replyTo, subject, fields }) {
  const text = buildTextBlock(fields);

  return getResend().emails.send({
    from,
    to,
    subject,
    text,
    replyTo: replyTo || undefined,
  });
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

async function sendSupportEmail({ name, email, subject, message, userId, page }) {
  return sendEmail({
    from: requireEnv('EMAIL_FROM_PP_SUPPORT'),
    to: requireEnv('SUPPORT_INBOX'),
    replyTo: safeEmail(email) || process.env.EMAIL_REPLY_TO_SUPPORT || undefined,
    subject: `[People Power Support] ${safe(subject, 200) || 'New support request'}`,
    fields: {
      Type: 'support',
      Name: safe(name, 200),
      Email: safeEmail(email),
      UserId: safe(userId, 200),
      Page: safe(page, 500),
      Message: safe(message, 5000),
    },
  });
}

async function sendContactEmail({ name, email, subject, message, page }) {
  const from =
    (process.env.EMAIL_FROM_PP_CONTACT || '').trim() ||
    requireEnv('EMAIL_FROM_PP_SUPPORT');
  const replyTo =
    safeEmail(email) ||
    (process.env.EMAIL_REPLY_TO_CONTACT || '').trim() ||
    (process.env.EMAIL_REPLY_TO_SUPPORT || '').trim() ||
    undefined;

  return sendEmail({
    from,
    to: requireEnv('CONTACT_INBOX'),
    replyTo,
    subject: `[People Power Contact] ${safe(subject, 200) || 'New contact message'}`,
    fields: {
      Type: 'contact',
      Name: safe(name, 200),
      Email: safeEmail(email),
      Page: safe(page, 500),
      Message: safe(message, 5000),
    },
  });
}

async function sendReportEmail({
  reporterName,
  reporterEmail,
  reason,
  details,
  targetType,
  targetId,
  reportedUserId,
  page,
}) {
  return sendEmail({
    from: requireEnv('EMAIL_FROM_PP_REPORTS'),
    to: requireEnv('REPORTS_INBOX'),
    replyTo: safeEmail(reporterEmail) || process.env.EMAIL_REPLY_TO_REPORTS || undefined,
    subject: `[People Power Report] ${safe(reason, 200) || 'New report submitted'}`,
    fields: {
      Type: 'report',
      ReporterName: safe(reporterName, 200),
      ReporterEmail: safeEmail(reporterEmail),
      Reason: safe(reason, 200),
      TargetType: safe(targetType, 100),
      TargetId: safe(targetId, 200),
      ReportedUserId: safe(reportedUserId, 200),
      Page: safe(page, 500),
      Details: safe(details, 5000),
    },
  });
}

module.exports = {
  sendSupportEmail,
  sendContactEmail,
  sendReportEmail,
};
