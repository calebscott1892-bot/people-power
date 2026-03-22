'use strict';

const {
  sendSupportEmail,
  sendContactEmail,
  sendReportEmail,
} = require('../services/email');

// ---------------------------------------------------------------------------
// Helpers (self-contained – no DB deps)
// ---------------------------------------------------------------------------

function clean(value, max = 5000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function validEmail(value) {
  const email = clean(value, 320);
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

/** @param {import('fastify').FastifyInstance} fastify */
module.exports = async function emailRoutes(fastify) {

  // ---- POST /api/support ----
  fastify.post('/api/support', async (request, reply) => {
    try {
      const body = request.body || {};

      const payload = {
        name: clean(body.name, 200),
        email: validEmail(body.email),
        subject: clean(body.subject, 200),
        message: clean(body.message, 5000),
        userId: clean(body.userId, 200),
        page: clean(body.page, 500),
      };

      if (!payload.message) {
        return reply.code(400).send({ ok: false, error: 'Message is required.' });
      }

      await sendSupportEmail(payload);

      return reply.send({ ok: true, message: 'Support request sent successfully.' });
    } catch (err) {
      request.log.error(err, 'Failed to send support email');
      return reply.code(500).send({ ok: false, error: 'Failed to send support request.' });
    }
  });

  // ---- POST /api/contact ----
  fastify.post('/api/contact', async (request, reply) => {
    try {
      const body = request.body || {};

      const payload = {
        name: clean(body.name, 200),
        email: validEmail(body.email),
        subject: clean(body.subject, 200),
        message: clean(body.message, 5000),
        page: clean(body.page, 500),
      };

      if (!payload.message) {
        return reply.code(400).send({ ok: false, error: 'Message is required.' });
      }

      await sendContactEmail(payload);

      return reply.send({ ok: true, message: 'Contact message sent successfully.' });
    } catch (err) {
      request.log.error(err, 'Failed to send contact email');
      return reply.code(500).send({ ok: false, error: 'Failed to send contact message.' });
    }
  });

  // ---- POST /api/report ----
  fastify.post('/api/report', async (request, reply) => {
    try {
      const body = request.body || {};

      const payload = {
        reporterName: clean(body.reporterName || body.name, 200),
        reporterEmail: validEmail(body.reporterEmail || body.email),
        reason: clean(body.reason, 200),
        details: clean(body.details || body.message, 5000),
        targetType: clean(body.targetType, 100),
        targetId: clean(body.targetId, 200),
        reportedUserId: clean(body.reportedUserId, 200),
        page: clean(body.page, 500),
      };

      if (!payload.reason && !payload.details) {
        return reply.code(400).send({ ok: false, error: 'Report reason or details are required.' });
      }

      await sendReportEmail(payload);

      return reply.send({ ok: true, message: 'Report sent successfully.' });
    } catch (err) {
      request.log.error(err, 'Failed to send report email');
      return reply.code(500).send({ ok: false, error: 'Failed to send report.' });
    }
  });
};
