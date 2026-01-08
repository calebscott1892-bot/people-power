/**
 * Simple email helper
 * - SMTP only (via nodemailer)
 * - DEMO_MODE aware: in DEMO mode, just log; in REAL mode, actually send
 * - Throws on SMTP config errors or send failures in REAL mode
 *
 * Email configuration env vars:
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
 * - EMAIL_FROM or SMTP_FROM
 * - DEBUG_EMAIL_TO (optional, for /debug/send-test-email)
 */

const nodemailer = require('nodemailer');

const DEMO_MODE = process.env.DEMO_MODE === 'true';

let smtpTransport = null;

/**
 * Get or create SMTP transport.
 * Throws if required SMTP env vars are missing in REAL mode.
 */
function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;

  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASSWORD || '';
  const secure = process.env.SMTP_SECURE === 'true';

  if (!host || !port || !user || !pass) {
    throw new Error(
      '[email] SMTP config missing: require SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD'
    );
  }

  smtpTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return smtpTransport;
}

/**
 * Send email
 * In DEMO_MODE: logs and returns success (no-op)
 * In REAL mode: actually sends and throws on failure
 *
 * @param {Object} opts
 * @param {string} opts.to - recipient email
 * @param {string} opts.subject - email subject
 * @param {string} opts.text - plain text body
 * @param {string} opts.html - html body (optional)
 * @returns {Promise<{ok: boolean, messageId?: string, demoMode?: boolean}>}
 */
async function sendEmail({ to, subject, text, html }) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM;

  if (!from) {
    throw new Error('[email] EMAIL_FROM or SMTP_FROM env var is required');
  }

  if (DEMO_MODE) {
    console.log('[email][DEMO_MODE] would send email', { to, subject });
    return { ok: true, demoMode: true };
  }

  const transport = getSmtpTransport();

  try {
    const info = await transport.sendMail({ from, to, subject, text, html });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[email] sendEmail failed', err);
    throw err;
  }
}

module.exports = { sendEmail };
