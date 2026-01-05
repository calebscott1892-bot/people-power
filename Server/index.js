// --- Initialization: Fastify, dotenv, uuid ---
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fastify = require('fastify')({
  // NOTE: Safety: enforce a global payload ceiling to deter oversized bodies.
  bodyLimit: 10 * 1024 * 1024, // 10MB
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    redact: [
      'req.headers.authorization',
      'request.headers.authorization',
      'headers.authorization',
      'authorization',
    ],
  },
  disableRequestLogging: true,
});
const { v4: uuidv4 } = require('uuid');

// ✅ CORS: explicitly allow the SPA origins (prod + dev).
// Registered BEFORE any routes so headers apply to 4xx/5xx as well.
const explicitCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

fastify.register(require('@fastify/cors'), {
  origin: (origin, cb) => {
    // allow curl / server-to-server (no origin)
    if (!origin) return cb(null, true);
    try {
      const url = new URL(origin);
      const host = url.hostname;
      const isLocalhost = host === 'localhost' || host === '127.0.0.1';
      const isAllowedHost =
        isLocalhost ||
        host === 'peoplepower.app' ||
        host === 'www.peoplepower.app' ||
        host.endsWith('.pages.dev') ||
        explicitCorsOrigins.includes(origin) ||
        explicitCorsOrigins.includes(host);
      if (isAllowedHost) return cb(null, true);
    } catch {
      // ignore
    }
    return cb(null, false);
  },
  // We use Authorization headers (Bearer tokens) and fetch() from the SPA.
  credentials: true,
  // Ensure CORS headers are added early and still present on 4xx/5xx.
  hook: 'onRequest',
  // Keep header names lowercase; preflight request headers are often lowercase.
  allowedHeaders: ['content-type', 'authorization', 'accept', 'x-requested-with', 'x-client-info'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
});

// Healthcheck (keep simple and always registered)
fastify.get('/health', async (_request, _reply) => {
  return {
    ok: true,
    status: 'healthy',
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'unknown',
  };
});

fastify.get('/debug/storage-mode', async (_request, _reply) => {
  return {
    storageMode,
    hasDatabaseUrl: !!process.env.DATABASE_URL,
  };
});

const RATE_LIMITS = {
  global: { max: 100, timeWindow: 5 * 60 * 1000 }, // 5 minutes
  admin: { max: 60, timeWindow: 60 * 1000 }, // 1 minute
  movementCreate: { max: 5, timeWindow: 60 * 60 * 1000 }, // 1 hour
  conversationCreate: { max: 10, timeWindow: 60 * 60 * 1000 }, // 1 hour
  messageSend: { max: 60, timeWindow: 60 * 1000 }, // 1 minute
  reportCreate: { max: 10, timeWindow: 60 * 60 * 1000 }, // 1 hour
  petitionSign: { max: 30, timeWindow: 60 * 60 * 1000 }, // 1 hour
  upload: { max: 20, timeWindow: 60 * 60 * 1000 }, // 1 hour
  evidenceSubmit: { max: 10, timeWindow: 60 * 60 * 1000 }, // 1 hour
  commentCreate: { max: 30, timeWindow: 60 * 60 * 1000 }, // 1 hour
  search: { max: 60, timeWindow: 60 * 1000 }, // 1 minute
};

// NOTE: Safety: enforce max size / length to prevent abuse & excessive resource use.
const MAX_TEXT_LENGTHS = {
  movementTitle: 120,
  movementSummary: 1000,
  movementDescription: 4000,
  movementDescriptionHtml: 8000,
  movementClaim: 1200,
  movementClaimEvidenceUrl: 800,
  movementClaimEvidenceFilename: 260,
  movementClaimEvidenceMime: 120,
  movementMediaUrl: 800,
  movementTag: 48,
  locationLabel: 120,
  challengeTitle: 140,
  challengeDescription: 1200,
  challengeCategory: 60,
  reportContentType: 80,
  reportContentId: 120,
  reportCategory: 80,
  reportTitle: 140,
  reportDetails: 2000,
  reportBugDetails: 1000,
  reportEvidenceUrl: 800,
  profileDisplayName: 120,
  profileUsername: 32,
  profileBio: 1000,
  profilePhotoUrl: 800,
  profileBannerUrl: 800,
  profileSkill: 80,
  messageCiphertext: 100000,
};

const E2EE_BODY_PREFIX = 'pp_e2ee_v1:';
const MAX_GROUP_PARTICIPANTS = 10;
const GROUP_POST_MODES = new Set(['owner_only', 'admins', 'selected', 'all']);

// --- Realtime messaging (WebSocket) ---
// Best-effort realtime: clients still fall back to HTTP refetch.
const wsClientsByEmail = new Map(); // email -> Set<WebSocket>
const wsEmailByClient = new WeakMap(); // WebSocket -> email
let realtimeWss = null;
let realtimeInitialized = false;

function wsSafeSend(ws, payload) {
  try {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function wsBroadcastToEmails(emails, payload) {
  const list = Array.isArray(emails) ? emails : [];
  const unique = Array.from(new Set(list.map((e) => normalizeEmail(e)).filter(Boolean)));
  for (const email of unique) {
    const set = wsClientsByEmail.get(email);
    if (!set || set.size === 0) continue;
    for (const ws of set) wsSafeSend(ws, payload);
  }
}

async function getAuthedEmailFromAccessToken(token) {
  const clean = token ? String(token).trim() : '';
  if (!clean) return null;
  try {
    if (!supabase?.auth?.getUser) return null;
    const timeoutMs = Number(process.env.SUPABASE_AUTH_TIMEOUT_MS || 7000);
    const { data, error } = await Promise.race([
      supabase.auth.getUser(clean),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase auth timeout')), timeoutMs)),
    ]);
    if (error || !data?.user) return null;

    // NOTE (future): if we decide to require verified emails for certain sensitive actions,
    // we can enforce it here using `data.user.email_confirmed_at`.
    return normalizeEmail(data.user.email);
  } catch {
    return null;
  }
}

function initRealtimeServer() {
  if (realtimeInitialized) return;
  realtimeInitialized = true;

  realtimeWss = new WebSocketServer({ noServer: true });

  fastify.server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/ws') return;

      const token = url.searchParams.get('access_token') || '';
      const email = await getAuthedEmailFromAccessToken(token);
      if (!email) {
        socket.destroy();
        return;
      }

      req.pp_user_email = email;
      realtimeWss.handleUpgrade(req, socket, head, (ws) => {
        realtimeWss.emit('connection', ws, req);
      });
    } catch {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
  });

  realtimeWss.on('connection', (ws, req) => {
    const email = normalizeEmail(req?.pp_user_email);
    if (!email) {
      try {
        ws.close();
      } catch {
        // ignore
      }
      return;
    }

    const set = wsClientsByEmail.get(email) || new Set();
    set.add(ws);
    wsClientsByEmail.set(email, set);
    wsEmailByClient.set(ws, email);

    fastify.log.info({ path: '/ws' }, 'ws client connected');

    wsSafeSend(ws, { type: 'hello', ok: true });

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw || ''));
      } catch {
        return;
      }
      const type = msg?.type ? String(msg.type) : '';
      const byEmail = normalizeEmail(wsEmailByClient.get(ws));
      if (!byEmail) return;

      if (type === 'ping') {
        wsSafeSend(ws, { type: 'pong', ts: Date.now() });
        return;
      }

      if (type === 'message:delivered') {
        const messageId = msg?.messageId ? String(msg.messageId) : '';
        if (!messageId) return;
        try {
          if (!hasDatabaseUrl) {
            const updated = memoryMarkMessageDelivered(messageId, byEmail);
            if (!updated?.conversation_id) return;
            const convo = getMemoryConversationById(updated.conversation_id);
            const participants = Array.isArray(convo?.participant_emails) ? convo.participant_emails : [];
            wsBroadcastToEmails(participants, {
              type: 'message:delivered',
              conversationId: String(updated.conversation_id),
              messageId,
              by: byEmail,
            });
            return;
          }

          await ensureMessagesTables();
          const res = await pool.query(
            `SELECT m.id, m.conversation_id, m.sender_email, c.participant_emails, c.request_status, c.blocked_by_email
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE m.id = $1
             LIMIT 1`,
            [messageId]
          );
          const row = res.rows?.[0] || null;
          if (!row) return;
          const participants = Array.isArray(row.participant_emails)
            ? row.participant_emails.map((x) => normalizeEmail(x)).filter(Boolean)
            : [];
          if (!participants.includes(byEmail)) return;

          const status = String(row?.request_status || 'accepted');
          const blockedBy = normalizeEmail(row?.blocked_by_email);
          if (status === 'blocked' && blockedBy && blockedBy !== byEmail) return;
          if (normalizeEmail(row.sender_email) === byEmail) return;

          await pool.query(
            `UPDATE messages
             SET delivered_to = CASE
               WHEN delivered_to @> ARRAY[$2] THEN delivered_to
               ELSE array_append(delivered_to, $2)
             END
             WHERE id = $1`,
            [messageId, byEmail]
          );

          wsBroadcastToEmails(participants, {
            type: 'message:delivered',
            conversationId: String(row.conversation_id),
            messageId,
            by: byEmail,
          });
        } catch (e) {
          fastify.log.warn({ err: e }, 'WS delivered ack failed');
        }
        return;
      }

      if (type === 'conversation:read') {
        const conversationId = msg?.conversationId ? String(msg.conversationId) : '';
        if (!conversationId) return;

        try {
          if (!hasDatabaseUrl) {
            const convo = getMemoryConversationById(conversationId);
            if (!convo) return;
            const participants = Array.isArray(convo?.participant_emails)
              ? convo.participant_emails.map((x) => normalizeEmail(x)).filter(Boolean)
              : [];
            if (!participants.includes(byEmail)) return;
            memoryMarkConversationRead(conversationId, byEmail);
            wsBroadcastToEmails(participants, {
              type: 'conversation:read',
              conversationId: String(conversationId),
              by: byEmail,
              ts: Date.now(),
            });
            return;
          }

          await ensureMessagesTables();
          const convoRes = await pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [conversationId]);
          const convo = convoRes.rows?.[0] || null;
          if (!convo) return;
          const participants = Array.isArray(convo.participant_emails)
            ? convo.participant_emails.map((x) => normalizeEmail(x)).filter(Boolean)
            : [];
          if (!participants.includes(byEmail)) return;

          const status = String(convo?.request_status || 'accepted');
          const blockedBy = normalizeEmail(convo?.blocked_by_email);
          if (status === 'blocked' && blockedBy && blockedBy !== byEmail) return;

          await pool.query(
            `UPDATE messages
             SET read_by = CASE
               WHEN read_by @> ARRAY[$2] THEN read_by
               ELSE array_append(read_by, $2)
             END
             WHERE conversation_id = $1
               AND sender_email <> $2`,
            [conversationId, byEmail]
          );

          wsBroadcastToEmails(participants, {
            type: 'conversation:read',
            conversationId: String(conversationId),
            by: byEmail,
            ts: Date.now(),
          });
        } catch (e) {
          fastify.log.warn({ err: e }, 'WS read ack failed');
        }
      }
    });

    ws.on('close', () => {
      const e = normalizeEmail(wsEmailByClient.get(ws));
      if (!e) return;
      const set2 = wsClientsByEmail.get(e);
      if (!set2) return;
      set2.delete(ws);
      if (set2.size === 0) wsClientsByEmail.delete(e);

      fastify.log.info({ path: '/ws' }, 'ws client disconnected');
    });

    ws.on('error', (err) => {
      // Keep low-noise; never throw.
      fastify.log.warn({ err, path: '/ws' }, 'ws client error');
    });
  });
}

function rateLimitKeyGenerator(request) {
  const authHeader = request.headers?.authorization ? String(request.headers.authorization) : '';
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const ip = request.ip ? String(request.ip) : '';
  return `${ip}:${token || 'anon'}`;
}

const adminRateLimitCache = new Map();

async function isAdminRateLimitAllowList(request) {
  const authHeader = request.headers?.authorization ? String(request.headers.authorization) : '';
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return false;

  const cached = adminRateLimitCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.isAdmin;

  try {
    if (!supabase?.auth?.getUser) return false;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      adminRateLimitCache.set(token, { isAdmin: false, expiresAt: Date.now() + 60 * 1000 });
      return false;
    }
    const isAdmin = getStaffRoleForUser(data.user) === 'admin';
    adminRateLimitCache.set(token, { isAdmin, expiresAt: Date.now() + 5 * 60 * 1000 });
    return isAdmin;
  } catch {
    return false;
  }
}

fastify.register(require('@fastify/rate-limit'), {
  global: true,
  max: RATE_LIMITS.global.max,
  timeWindow: RATE_LIMITS.global.timeWindow,
  keyGenerator: rateLimitKeyGenerator,
  allowList: isAdminRateLimitAllowList,
  errorResponseBuilder: () => ({ error: 'Too many requests, please slow down.' }),
});

// --- Upload limits ---
const MAX_UPLOAD_BYTES = process.env.MAX_UPLOAD_BYTES ? parseInt(process.env.MAX_UPLOAD_BYTES, 10) : 5 * 1024 * 1024; // 5MB default
const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'application/pdf',
];
const IMAGE_ONLY_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

// --- Core requires ---
const { Pool } = require('pg');
const { z } = require('zod');
const BadWordsFilter = require('bad-words');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// ...existing code...
// All await statements must be inside async functions or route handlers.

// Create or update a feature flag
fastify.post('/admin/feature-flags', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });
  const { name, enabled, rollout_percentage, description } = request.body || {};
  if (!name) return reply.code(400).send({ error: 'Flag name required' });
  await ensureFeatureFlagsTable();
  // Upsert by name
  const id = uuidv4();
  const now = new Date().toISOString();
  const res = await pool.query(
    `INSERT INTO feature_flags (id, name, enabled, rollout_percentage, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (name) DO UPDATE SET enabled = $3, rollout_percentage = $4, description = $5, updated_at = $6
     RETURNING *`,
    [id, name, enabled !== false, rollout_percentage == null ? 100 : rollout_percentage, description || '', now]
  );
  return reply.send({ flag: res.rows?.[0] });
});

// Delete a feature flag
fastify.delete('/admin/feature-flags/:id', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });
  const id = String(request.params.id);
  await ensureFeatureFlagsTable();
  await pool.query('DELETE FROM feature_flags WHERE id = $1', [id]);
  return reply.send({ ok: true });
});

// List all feature flags (admin-only)
fastify.get('/admin/feature-flags', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });
  await ensureFeatureFlagsTable();
  const res = await pool.query('SELECT * FROM feature_flags ORDER BY updated_at DESC');
  return reply.send({ flags: res.rows });
});

// Fetch all feature flags (public, for frontend)
fastify.get('/feature-flags', async (_request, reply) => {
  if (!hasDatabaseUrl) return reply.send({ flags: [] });
  await ensureFeatureFlagsTable();
  const res = await pool.query('SELECT * FROM feature_flags');
  return reply.send({ flags: res.rows });
});

// --- Admin Daily Challenges ---
fastify.get('/admin/challenges', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });
  await ensureChallengesTable();
  const res = await pool.query('SELECT * FROM challenges ORDER BY updated_at DESC');
  return reply.send({ challenges: res.rows || [] });
});

fastify.post('/admin/challenges', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });

  const schema = z.object({
    id: z.string().optional(),
    title: z.string().min(1).max(MAX_TEXT_LENGTHS.challengeTitle),
    description: z.string().max(MAX_TEXT_LENGTHS.challengeDescription).optional().nullable(),
    category: z.string().min(1).max(MAX_TEXT_LENGTHS.challengeCategory),
    start_date: z.string().optional().nullable(),
    end_date: z.string().optional().nullable(),
    status: z.enum(['active', 'archived']).optional(),
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid challenge payload' });

  const category = String(parsed.data.category).trim().toLowerCase();
  if (!ALLOWED_CHALLENGE_CATEGORIES.has(category)) {
    return reply.code(400).send({ error: 'Invalid challenge category' });
  }

  const normalizeDate = (value) => {
    const s = value == null ? '' : String(value).trim();
    if (!s) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  const startDate = normalizeDate(parsed.data.start_date);
  const endDate = normalizeDate(parsed.data.end_date);
  if (startDate && endDate && endDate < startDate) {
    return reply.code(400).send({ error: 'end_date must be after start_date' });
  }

  await ensureChallengesTable();

  const id = parsed.data.id ? String(parsed.data.id) : randomUUID();
  const now = nowIso();
  const title = cleanText(parsed.data.title, MAX_TEXT_LENGTHS.challengeTitle);
  const description = parsed.data.description
    ? cleanText(parsed.data.description, MAX_TEXT_LENGTHS.challengeDescription)
    : null;
  const status = parsed.data.status || 'active';

  const res = await pool.query(
    `INSERT INTO challenges (id, title, description, category, start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (id) DO UPDATE
       SET title = $2,
           description = $3,
           category = $4,
           start_date = $5,
           end_date = $6,
           status = $7,
           updated_at = $8
     RETURNING *`,
    [id, title, description, category, startDate, endDate, status, now]
  );

  return reply.send({ challenge: res.rows?.[0] || null });
});

fastify.delete('/admin/challenges/:id', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });
  const id = String(request.params?.id || '').trim();
  if (!id) return reply.code(400).send({ error: 'Challenge id is required' });
  await ensureChallengesTable();
  await pool.query(
    'UPDATE challenges SET status = $2, updated_at = NOW() WHERE id = $1',
    [id, 'archived']
  );
  return reply.send({ ok: true });
});

// Public challenges feed (non-admin)
fastify.get('/challenges', async (_request, reply) => {
  if (!hasDatabaseUrl) return reply.send({ challenges: [] });
  await ensureChallengesTable();
  const today = nowIso().slice(0, 10);
  const res = await pool.query(
    `SELECT * FROM challenges
     WHERE status != 'archived'
       AND (start_date IS NULL OR start_date <= $1)
       AND (end_date IS NULL OR end_date >= $1)
     ORDER BY start_date NULLS LAST, created_at DESC`,
    [today]
  );
  return reply.send({ challenges: res.rows || [] });
});
// --- Feature Flags Table ---
async function ensureFeatureFlagsTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      rollout_percentage INT NOT NULL DEFAULT 100,
      description TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_feature_flags_name ON feature_flags (name)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_feature_flags_updated_at ON feature_flags (updated_at DESC)');
}

async function ensureChallengesTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NULL,
      category TEXT NOT NULL,
      start_date DATE NULL,
      end_date DATE NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges (status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_challenges_dates ON challenges (start_date, end_date)');
}
// --- Research Mode Config API (admin-only) ---


// List all research configs
fastify.get('/admin/research-mode-configs', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });
  await ensureResearchModeConfigTable();
  const res = await pool.query('SELECT * FROM research_mode_configs ORDER BY updated_at DESC');
  return reply.send({ configs: res.rows });
});

// Create or update a research config
fastify.post('/admin/research-mode-configs', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });
  const { scope, scope_id, enabled_features } = request.body || {};
  if (!['user','movement','global'].includes(scope)) return reply.code(400).send({ error: 'Invalid scope' });
  if ((scope === 'user' || scope === 'movement') && !scope_id) return reply.code(400).send({ error: 'scope_id required' });
  await ensureResearchModeConfigTable();
  // Upsert by (scope, scope_id)
  const id = uuidv4();
  const now = new Date().toISOString();
  const res = await pool.query(
    `INSERT INTO research_mode_configs (id, scope, scope_id, enabled_features, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (scope, scope_id) DO UPDATE SET enabled_features = $4, updated_at = $5
     RETURNING *`,
    [id, scope, scope_id || null, enabled_features || [], now]
  );
  return reply.send({ config: res.rows?.[0] });
});

// Delete a research config
fastify.delete('/admin/research-mode-configs/:id', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });
  const id = String(request.params.id);
  await ensureResearchModeConfigTable();
  await pool.query('DELETE FROM research_mode_configs WHERE id = $1', [id]);
  return reply.send({ ok: true });
});

// Fetch merged research flags for a user or movement (public, but only returns enabled features)
fastify.get('/research-flags', async (request, reply) => {
  const { user_id, movement_id } = request.query || {};
  if (!hasDatabaseUrl) return reply.send({ enabled: false, features: [] });
  await ensureResearchModeConfigTable();
  // Fetch global
  const configs = [];
  const resGlobal = await pool.query('SELECT * FROM research_mode_configs WHERE scope = $1', ['global']);
  if (resGlobal.rows?.length) configs.push(...resGlobal.rows);
  if (user_id) {
    const resUser = await pool.query('SELECT * FROM research_mode_configs WHERE scope = $1 AND scope_id = $2', ['user', user_id]);
    if (resUser.rows?.length) configs.push(...resUser.rows);
  }
  if (movement_id) {
    const resMove = await pool.query('SELECT * FROM research_mode_configs WHERE scope = $1 AND scope_id = $2', ['movement', movement_id]);
    if (resMove.rows?.length) configs.push(...resMove.rows);
  }
  // Merge features
  const features = Array.from(new Set(configs.flatMap(c => c.enabled_features || [])));
  return reply.send({ enabled: features.length > 0, features });
});
// --- Research Mode Config Table ---
async function ensureResearchModeConfigTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS research_mode_configs (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK (scope IN ('user', 'movement', 'global')),
      scope_id TEXT NULL,
      enabled_features TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_research_mode_scope ON research_mode_configs (scope, scope_id)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_research_mode_scope_unique ON research_mode_configs (scope, scope_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_research_mode_updated_at ON research_mode_configs (updated_at DESC)');
}
// GET /admin/community-health (admin-only, aggregate stats, no private content)
fastify.get('/admin/community-health', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;
  if (!hasDatabaseUrl) return reply.code(503).send({ error: 'Database unavailable' });
  // Time windows
  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const iso7d = since7d.toISOString();
  const iso14d = since14d.toISOString();
  // Aggregate queries
  const queries = {
    total_users: `SELECT COUNT(*)::int FROM users`,
    active_users: `SELECT COUNT(DISTINCT user_id)::int FROM analytics_events WHERE timestamp >= $1 AND timestamp < $2`,
    new_users: `SELECT COUNT(*)::int FROM users WHERE created_at >= $1 AND created_at < $2`,
    movements_created: `SELECT COUNT(*)::int FROM movements WHERE created_at >= $1 AND created_at < $2`,
    reports_created: `SELECT COUNT(*)::int FROM reports WHERE created_at >= $1 AND created_at < $2`,
    reports_with_action: `SELECT COUNT(*)::int FROM reports WHERE created_at >= $1 AND created_at < $2 AND action_taken IS NOT NULL`,
    suspicious_activity_flags: `SELECT COUNT(*)::int FROM suspicious_activity WHERE created_at >= $1 AND created_at < $2`,
    harassment_protection_triggers: `SELECT COUNT(*)::int FROM moderation_events WHERE created_at >= $1 AND created_at < $2 AND event_type = 'harassment_protection'`,
    crisis_detection_events: `SELECT COUNT(*)::int FROM moderation_events WHERE created_at >= $1 AND created_at < $2 AND event_type = 'crisis_detection'`,
    avg_report_response_time: `SELECT AVG(EXTRACT(EPOCH FROM (action_taken_at - created_at)))::float FROM reports WHERE created_at >= $1 AND created_at < $2 AND action_taken_at IS NOT NULL`,
    content_category_dist: `SELECT category, COUNT(*)::int FROM movements WHERE created_at >= $1 AND created_at < $2 GROUP BY category`,
  };
  // Helper to run all queries for a window
  async function getStats(since, until) {
    const results = {};
    for (const [key, sql] of Object.entries(queries)) {
      try {
        if (key === 'total_users') {
          const res = await pool.query(sql);
          results[key] = res.rows?.[0]?.count ?? 0;
        } else if (key === 'content_category_dist') {
          const res = await pool.query(sql, [since, until]);
          results[key] = Array.isArray(res.rows)
            ? res.rows.map(r => ({ category: r.category || 'uncategorized', count: r.count }))
            : [];
        } else if (key === 'avg_report_response_time') {
          const res = await pool.query(sql, [since, until]);
          results[key] = res.rows?.[0]?.avg ?? null;
        } else {
          const res = await pool.query(sql, [since, until]);
          results[key] = res.rows?.[0]?.count ?? 0;
        }
      } catch {
        results[key] = null;
      }
    }
    // Compute % of reports resulting in action
    let pct_reports_action = null;
    if (results.reports_created && results.reports_with_action != null) {
      pct_reports_action = results.reports_created > 0 ? Math.round(100 * results.reports_with_action / results.reports_created) : null;
    }
    return { ...results, pct_reports_action };
  }
  // Get current and previous 7d stats
  const [current, previous] = await Promise.all([
    getStats(iso7d, now.toISOString()),
    getStats(iso14d, iso7d),
  ]);
  // Compose response
  const resp = {
    window: { since: iso7d, until: now.toISOString() },
    current,
    previous,
  };
  return reply.send(resp);
});
// Movement field locks (owner-only)
const memoryMovementLocks = new Map(); // Map<movementId, { title: bool, description: bool, claims: bool }>
async function ensureMovementLocksTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_locks (
      movement_id TEXT PRIMARY KEY,
      title_locked BOOLEAN NOT NULL DEFAULT FALSE,
      description_locked BOOLEAN NOT NULL DEFAULT FALSE,
      claims_locked BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
}

async function getMovementLocks(movementId) {
  if (!movementId) return {};
  if (!hasDatabaseUrl) return memoryMovementLocks.get(movementId) || {};
  await ensureMovementLocksTable();
  const res = await pool.query('SELECT * FROM movement_locks WHERE movement_id = $1 LIMIT 1', [movementId]);
  const row = res.rows?.[0];
  return row ? {
    title: !!row.title_locked,
    description: !!row.description_locked,
    claims: !!row.claims_locked,
  } : {};
}

async function setMovementLock(movementId, field, locked) {
  if (!movementId || !['title','description','claims'].includes(field)) return;
  if (!hasDatabaseUrl) {
    const cur = memoryMovementLocks.get(movementId) || {};
    memoryMovementLocks.set(movementId, { ...cur, [field]: !!locked });
    return memoryMovementLocks.get(movementId);
  }
  await ensureMovementLocksTable();
  const col = field + '_locked';
  await pool.query(
    `INSERT INTO movement_locks (movement_id, ${col}) VALUES ($1, $2)
     ON CONFLICT (movement_id) DO UPDATE SET ${col} = $2`,
    [movementId, !!locked]
  );
  return getMovementLocks(movementId);
}

// GET movement locks (owner/admin only)
fastify.get('/movements/:id/locks', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;
  const movementId = String(request.params.id);
  if (!movementId) return reply.code(400).send({ error: 'Movement id required' });
  const email = normalizeEmail(authedUser.email);
  const staffRole = getStaffRoleForEmail(email);
  let isOwner = false;
  try {
    const ownerEmail = await getMovementOwnerEmail(movementId);
    isOwner = ownerEmail && ownerEmail === email;
  } catch {
    // Ignore lookup failures; fall back to staff-only access.
  }
  if (!isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });
  const locks = await getMovementLocks(movementId);
  return reply.send({ locks });
});

// POST movement lock (owner/admin only)
fastify.post('/movements/:id/locks', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;
  const movementId = String(request.params.id);
  if (!movementId) return reply.code(400).send({ error: 'Movement id required' });
  const email = normalizeEmail(authedUser.email);
  const staffRole = getStaffRoleForEmail(email);
  let isOwner = false;
  try {
    const ownerEmail = await getMovementOwnerEmail(movementId);
    isOwner = ownerEmail && ownerEmail === email;
  } catch {
    // Ignore lookup failures; fall back to staff-only access.
  }
  if (!isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });
  const { field, locked } = request.body || {};
  if (!['title','description','claims'].includes(field)) return reply.code(400).send({ error: 'Invalid field' });
  const locks = await setMovementLock(movementId, field, !!locked);
  await logCollaboratorAction({
    movement_id: movementId,
    actor_user_id: authedUser.id || authedUser.email,
    action_type: 'change_settings',
    target_id: field,
    metadata: { locked: !!locked }
  });
  return reply.send({ locks });
});
// Utility: Get user trust score (returns 0-100, fallback 50)
async function getUserTrustScore(email) {
  if (!email) return 50;
  if (!hasDatabaseUrl) return 50;
  try {
    const res = await pool.query('SELECT trust_score FROM profiles WHERE email = $1 LIMIT 1', [email]);
    const score = res.rows?.[0]?.trust_score;
    if (typeof score === 'number') return score;
  } catch {
    // Ignore trust lookup errors; use default score.
  }
  return 50;
}

const TRUST_SCORE_THRESHOLD = 60;
// GET /movements/:id/collaborator-actions (owner/admin only)
fastify.get('/movements/:id/collaborator-actions', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;
  const movementId = String(request.params.id);
  if (!movementId) return reply.code(400).send({ error: 'Movement id required' });
  const email = normalizeEmail(authedUser.email);
  const staffRole = getStaffRoleForEmail(email);
  // Only owner or admin can view
  let isOwner = false;
  try {
    const ownerEmail = await getMovementOwnerEmail(movementId);
    isOwner = ownerEmail && ownerEmail === email;
  } catch {
    // Ignore lookup failures; fall back to staff-only access.
  }
  if (!isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });
  let logs = [];
  if (!hasDatabaseUrl) {
    logs = memoryCollaboratorActionLogs.filter(l => l.movement_id === movementId).slice(0, 10);
  } else {
    await ensureCollaboratorActionLogTable();
    const res = await pool.query(
      `SELECT * FROM collaborator_action_logs WHERE movement_id = $1 ORDER BY timestamp DESC LIMIT 10`,
      [movementId]
    );
    logs = res.rows;
  }
  return reply.send({ actions: logs });
});
// CollaboratorActionLog: DB and memory fallback
const memoryCollaboratorActionLogs = [];

async function ensureCollaboratorActionLogTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS collaborator_action_logs (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_id TEXT,
      timestamp TIMESTAMPTZ NOT NULL,
      metadata JSONB
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_collab_action_logs_movement_id ON collaborator_action_logs (movement_id, timestamp DESC)');
}

async function logCollaboratorAction({ movement_id, actor_user_id, action_type, target_id = null, metadata = null }) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const record = { id, movement_id, actor_user_id, action_type, target_id, timestamp, metadata };
  if (!hasDatabaseUrl) {
    memoryCollaboratorActionLogs.unshift(record);
    if (memoryCollaboratorActionLogs.length > 5000) memoryCollaboratorActionLogs.length = 5000;
    return record;
  }
  try {
    await ensureCollaboratorActionLogTable();
    await pool.query(
      `INSERT INTO collaborator_action_logs (id, movement_id, actor_user_id, action_type, target_id, timestamp, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, movement_id, actor_user_id, action_type, target_id, timestamp, metadata]
    );
  } catch (e) {
    fastify.log.error({ err: e, action_type }, 'Failed to write collaborator action log');
  }
  return record;
}
// GET /admin/migrations (admin-only)
fastify.get('/admin/migrations', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;

  const limit = Math.max(1, Math.min(50, Number(request.query?.limit) || 20));
  if (!hasDatabaseUrl) {
    return reply.send({
      logs: memoryMigrationLogs.slice(0, limit)
    });
  }
  try {
    await ensureMigrationLogTable();
    const res = await pool.query(
      `SELECT * FROM migration_logs ORDER BY started_at DESC LIMIT $1`,
      [limit]
    );
    return reply.send({ logs: res.rows });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to fetch migration logs');
    return reply.code(500).send({ error: 'Failed to fetch migration logs' });
  }
});
// Ensure backups directory exists
const backupsDir = path.join(__dirname, 'backups');
try {
  fs.mkdirSync(backupsDir, { recursive: true });
} catch {
  // ignore
}

// Utility: Export table to JSON
async function exportTableToJson(table) {
  if (!hasDatabaseUrl) return [];
  const res = await pool.query(`SELECT * FROM ${table}`);
  return res.rows;
}

// POST /admin/backup (admin-only)
fastify.post('/admin/backup', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;

  const started_at = nowIso();
  let finished_at = null;
  let status = 'started';
  let message = '';
  let details = {};
  let backupFile = null;
  try {
    const tables = [
      'movements',
      'movement_events',
      'movement_petitions',
      'movement_resources',
      'users',
      'profiles',
      'user_profiles'
    ];
    const data = {};
    const errors = {};
    for (const t of tables) {
      try {
        data[t] = await exportTableToJson(t);
      } catch (e) {
        errors[t] = String(e?.message || 'Export failed');
        data[t] = [];
      }
    }
    const fileName = `backup_${started_at.replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(backupsDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    finished_at = nowIso();
    status = Object.keys(errors).length ? 'failed' : 'success';
    message = Object.keys(errors).length ? `Backup completed with errors: ${fileName}` : `Backup completed: ${fileName}`;
    details = {
      tables,
      counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
      errors: Object.keys(errors).length ? errors : undefined
    };
    backupFile = fileName;
  } catch (e) {
    finished_at = nowIso();
    status = 'failed';
    message = 'Backup failed';
    details = { error: e.message };
    fastify.log.error({ err: e }, 'Backup failed');
  }
  await writeMigrationLog({
    type: 'backup',
    status,
    started_at,
    finished_at,
    message,
    details: { ...details, backupFile }
  });
  if (status === 'success') {
    return reply.send({ ok: true, message, backupFile, details });
  } else {
    return reply.code(500).send({ error: message });
  }
});
// Admin-only purge for movement data (use with extreme caution).
fastify.post('/admin/purge/movements', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const authedUser = await requireAdminUser(request, reply);
  if (!authedUser) return;

  const confirm = String(request.body?.confirm || request.query?.confirm || '').trim().toLowerCase();
  if (confirm !== 'true') {
    return reply.code(400).send({ error: 'Confirmation required. Pass confirm=true to purge movement data.' });
  }

  try {
    if (hasDatabaseUrl) {
      await pool.query('DELETE FROM movement_votes');
      await pool.query('DELETE FROM movement_comments');
      await pool.query('DELETE FROM movement_comment_settings');
      await pool.query('DELETE FROM movement_resources');
      await pool.query('DELETE FROM movement_event_rsvps');
      await pool.query('DELETE FROM movement_events');
      await pool.query('DELETE FROM movement_petition_signatures');
      await pool.query('DELETE FROM movement_petitions');
      await pool.query('DELETE FROM movement_impact_updates');
      await pool.query('DELETE FROM movement_tasks');
      await pool.query('DELETE FROM movement_discussions');
      await pool.query('DELETE FROM movement_evidence');
      await pool.query('DELETE FROM collaborators');
      await pool.query('DELETE FROM movement_follows');
      await pool.query('DELETE FROM movement_locks');
      await pool.query('DELETE FROM conversations WHERE movement_id IS NOT NULL');
      await pool.query('DELETE FROM messages WHERE conversation_id NOT IN (SELECT id FROM conversations)');
      await pool.query('DELETE FROM movements');
    }
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to purge movement data');
    return reply.code(500).send({ error: 'Failed to purge movement data' });
  }

  // Memory fallback cleanup
  memoryMovements.length = 0;
  memoryVotes.clear();
  memoryMovementFollows.clear();
  memoryCommentsByMovement.clear();
  memoryCommentSettingsByMovement.clear();
  memoryMovementResourcesByMovement.clear();
  memoryMovementEventsByMovement.clear();
  memoryMovementPetitionsByMovement.clear();
  memoryMovementImpactUpdatesByMovement.clear();
  memoryMovementEvidenceByMovement.clear();
  memoryMovementTasksByMovement.clear();
  memoryMovementDiscussionsByMovement.clear();
  memoryEventRsvpsByEvent.clear();
  memoryPetitionSignaturesByPetition.clear();
  memoryCollaboratorsByMovement.clear();
  if (memoryMovementLocks?.clear) memoryMovementLocks.clear();
  memoryConversations.length = 0;
  memoryMessagesByConversation.clear();

  return reply.send({ ok: true, purged: true });
});
// ...existing code...

const REQUEST_START = Symbol('peoplepower.requestStart');

function safePathFromRequest(request) {
  const rawUrl = request?.raw?.url ? String(request.raw.url) : String(request?.url || '');
  try {
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return rawUrl.split('?')[0] || '/';
  }
}

function serializeErrorForLog(err, { includeStack } = {}) {
  if (!err || typeof err !== 'object') return { message: String(err || '') };
  const message = err.message ? String(err.message) : '';
  const name = err.name ? String(err.name) : 'Error';
  const stack = includeStack && err.stack ? String(err.stack) : undefined;
  return { name, message, stack };
}

// Minimal observability: log method/path/status and include stack for 5xx.
fastify.addHook('onRequest', (request, _reply, done) => {
  request[REQUEST_START] = process.hrtime.bigint();
  done();
});

fastify.addHook('onResponse', (request, reply, done) => {
  const start = request[REQUEST_START];
  const ms = typeof start === 'bigint' ? Number((process.hrtime.bigint() - start) / 1000000n) : undefined;
  const statusCode = reply.statusCode;
  const payload = {
    reqId: request.id,
    method: String(request.method || 'GET'),
    path: safePathFromRequest(request),
    statusCode,
    responseTimeMs: ms,
  };

  if (statusCode >= 500) fastify.log.error(payload, 'request');
  else if (statusCode >= 400) fastify.log.warn(payload, 'request');
  else fastify.log.info(payload, 'request');

  done();
});

fastify.addHook('onError', (request, reply, error, done) => {
  const statusCode = reply.statusCode || 500;
  const base = {
    reqId: request.id,
    method: String(request.method || 'GET'),
    path: safePathFromRequest(request),
    statusCode,
  };

  if (statusCode >= 500) {
    fastify.log.error({ ...base, err: serializeErrorForLog(error, { includeStack: true }) }, 'request failed');
  } else {
    fastify.log.warn({ ...base, err: serializeErrorForLog(error, { includeStack: false }) }, 'request error');
  }

  done();
});

const profanityFilter = new BadWordsFilter();

// Server-side verification of Supabase JWTs.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Comma-separated list of admin emails.
// Example: ADMIN_EMAILS="admin@example.com,other@example.com"
const DEFAULT_ADMIN_EMAILS = ['calebscott1892@gmail.com'];
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .concat(DEFAULT_ADMIN_EMAILS.map((e) => String(e).trim().toLowerCase()))
);

// Comma-separated list of moderator emails.
// Example: MODERATOR_EMAILS="mod@example.com,othermod@example.com"
const MODERATOR_EMAILS = new Set(
  String(process.env.MODERATOR_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

// Report email notifications (optional; best-effort only).
const REPORT_EMAIL_FROM = String(process.env.REPORT_EMAIL_FROM || process.env.EMAIL_FROM || '').trim();
const REPORT_EMAIL_REPLY_TO = String(process.env.REPORT_EMAIL_REPLY_TO || process.env.EMAIL_REPLY_TO || '').trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true';
let smtpTransport = null;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function canSendReportEmail() {
  if (!REPORT_EMAIL_FROM) return false;
  if (RESEND_API_KEY) return true;
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

async function getSmtpTransport() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !REPORT_EMAIL_FROM) return null;
  if (smtpTransport) return smtpTransport;
  try {
    const nodemailer = require('nodemailer');
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number.isFinite(SMTP_PORT) ? SMTP_PORT : 587,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    return smtpTransport;
  } catch (e) {
    fastify.log.error({ err: e }, 'SMTP transport unavailable');
    return null;
  }
}

async function sendReportEmail({ to, subject, text, html }) {
  const recipient = normalizeEmail(to);
  if (!recipient || !canSendReportEmail()) return;

  if (RESEND_API_KEY) {
    const payload = {
      from: REPORT_EMAIL_FROM,
      to: [recipient],
      subject,
      text,
      html,
      reply_to: REPORT_EMAIL_REPLY_TO || undefined,
    };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        fastify.log.warn({ status: res.status, body }, 'Report email send failed (Resend)');
      }
      return;
    } catch (e) {
      fastify.log.error({ err: e }, 'Report email send failed (Resend)');
      return;
    }
  }

  const transport = await getSmtpTransport();
  if (!transport) return;
  try {
    await transport.sendMail({
      from: REPORT_EMAIL_FROM,
      to: recipient,
      subject,
      text,
      html,
      replyTo: REPORT_EMAIL_REPLY_TO || undefined,
    });
  } catch (e) {
    fastify.log.error({ err: e }, 'Report email send failed (SMTP)');
  }
}

function buildReportReceiptEmail(report) {
  const reportId = report?.id ? String(report.id) : 'unknown';
  const reportType = String(report?.report_type || 'abuse').toLowerCase();
  const typeLabel = reportType === 'bug' ? 'site issue' : 'behaviour report';
  const category = String(report?.report_category || '').trim();
  const title = String(report?.report_title || '').trim();
  const summary = title || category || 'report';
  const safeSummary = escapeHtml(summary.slice(0, 120));
  const subject = `We received your ${typeLabel}`;
  const text = `Thanks for your report. We’re reviewing it now.\nReport ID: ${reportId}\nSummary: ${summary}\n\nIf you have more details, you can reply to this email.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <p>Thanks for your report. We’re reviewing it now.</p>
      <p><strong>Report ID:</strong> ${escapeHtml(reportId)}</p>
      <p><strong>Summary:</strong> ${safeSummary}</p>
      <p>If you have more details, you can reply to this email.</p>
    </div>
  `;
  return { subject, text, html };
}

function buildReportResolvedEmail(report) {
  const reportId = report?.id ? String(report.id) : 'unknown';
  const reportType = String(report?.report_type || 'abuse').toLowerCase();
  const typeLabel = reportType === 'bug' ? 'site issue' : 'behaviour report';
  const subject = `Your ${typeLabel} has been marked resolved`;
  const text = `Thanks again for your report. It has been marked as resolved.\nReport ID: ${reportId}\n\nWe appreciate your help in keeping People Power safe and functional.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <p>Thanks again for your report. It has been marked as resolved.</p>
      <p><strong>Report ID:</strong> ${escapeHtml(reportId)}</p>
      <p>We appreciate your help in keeping People Power safe and functional.</p>
    </div>
  `;
  return { subject, text, html };
}

function buildMovementDeletedEmail({ movementTitle, movementId, deletedByEmail }) {
  const safeTitle = escapeHtml(String(movementTitle || 'a movement').slice(0, 140));
  const safeId = escapeHtml(String(movementId || '').slice(0, 80));
  const safeBy = escapeHtml(String(deletedByEmail || '').slice(0, 160));
  const subject = `Movement removed: ${safeTitle}`;
  const text = `A movement you were verified in has been removed by its organizer.\n` +
    `Movement: ${movementTitle || 'Unknown'}\n` +
    `Movement ID: ${safeId}\n` +
    (safeBy ? `Removed by: ${safeBy}\n` : '') +
    `\nIf you believe this was a mistake, you can reach out to the organizer.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <p>A movement you were verified in has been removed by its organizer.</p>
      <p><strong>Movement:</strong> ${safeTitle}</p>
      ${safeId ? `<p><strong>Movement ID:</strong> ${safeId}</p>` : ''}
      ${safeBy ? `<p><strong>Removed by:</strong> ${safeBy}</p>` : ''}
      <p>If you believe this was a mistake, you can reach out to the organizer.</p>
    </div>
  `;
  return { subject, text, html };
}

const ENCRYPTED_MESSAGE_PREFIX = 'pp_e2ee_v1:';

function isEncryptedMessageBody(body) {
  return String(body || '').startsWith(ENCRYPTED_MESSAGE_PREFIX);
}

async function listEmailNotificationRecipients(emails) {
  const list = Array.from(
    new Set((Array.isArray(emails) ? emails : []).map((e) => normalizeEmail(e)).filter(Boolean))
  );
  if (!list.length) return [];
  if (!hasDatabaseUrl) {
    return list.filter((email) => !!memoryUserProfiles.get(email)?.email_notifications_opt_in);
  }

  try {
    await ensureUserProfilesTable();
    const res = await pool.query(
      'SELECT user_email, email_notifications_opt_in FROM user_profiles WHERE user_email = ANY($1)',
      [list]
    );
    const opted = new Set(
      (Array.isArray(res.rows) ? res.rows : [])
        .filter((r) => r?.email_notifications_opt_in)
        .map((r) => normalizeEmail(r?.user_email))
        .filter(Boolean)
    );
    return list.filter((email) => opted.has(email));
  } catch {
    return [];
  }
}

function buildMessageNotificationEmail({ conversation, body, senderEmail }) {
  const groupName = conversation?.is_group ? String(conversation?.group_name || 'Group chat') : 'Direct message';
  const senderLabel = senderEmail ? ` from ${escapeHtml(senderEmail)}` : '';
  const subject = conversation?.is_group
    ? `New message in ${groupName}`
    : 'New direct message';
  const preview = isEncryptedMessageBody(body) ? 'Encrypted message' : String(body || '').slice(0, 140);
  const safePreview = preview ? escapeHtml(preview) : 'Open the app to view.';
  const text = `You have a new message${senderLabel} on People Power.\n\n${preview ? `Preview: ${preview}` : 'Open the app to view.'}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <p>You have a new message${senderLabel} on People Power.</p>
      <p><strong>${escapeHtml(groupName)}</strong></p>
      <p>${safePreview}</p>
      <p>Open the app to reply.</p>
    </div>
  `;
  return { subject, text, html };
}

async function notifyMessageRecipients({ conversation, body, senderEmail }) {
  if (!canSendReportEmail()) return;
  const participants = Array.isArray(conversation?.participant_emails)
    ? conversation.participant_emails.map((x) => normalizeEmail(x)).filter(Boolean)
    : [];
  if (!participants.length) return;
  const recipients = participants.filter((email) => email !== normalizeEmail(senderEmail));
  const optedIn = await listEmailNotificationRecipients(recipients);
  if (!optedIn.length) return;
  const message = buildMessageNotificationEmail({ conversation, body, senderEmail });
  await Promise.all(optedIn.map((email) => sendReportEmail({ to: email, ...message })));
}

function buildCollaborationInviteEmail({ movementTitle, inviterEmail, role }) {
  const safeTitle = escapeHtml(String(movementTitle || 'a movement').slice(0, 140));
  const safeInviter = escapeHtml(String(inviterEmail || '').slice(0, 160));
  const safeRole = escapeHtml(String(role || 'collaborator').slice(0, 40));
  const subject = `Collaboration invite: ${safeTitle}`;
  const text = `You have been invited to collaborate on "${movementTitle || 'a movement'}" as ${role || 'collaborator'}.\n` +
    (inviterEmail ? `Invited by: ${inviterEmail}\n` : '') +
    `\nOpen People Power to respond.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <p>You have been invited to collaborate on <strong>${safeTitle}</strong>.</p>
      <p>Role: <strong>${safeRole}</strong></p>
      ${safeInviter ? `<p>Invited by: ${safeInviter}</p>` : ''}
      <p>Open People Power to respond.</p>
    </div>
  `;
  return { subject, text, html };
}

async function notifyCollaborationInvite({ invitedEmail, inviterEmail, movementTitle, role }) {
  if (!canSendReportEmail()) return;
  const recipients = await listEmailNotificationRecipients([invitedEmail]);
  if (!recipients.length) return;
  const message = buildCollaborationInviteEmail({ movementTitle, inviterEmail, role });
  await Promise.all(recipients.map((email) => sendReportEmail({ to: email, ...message })));
}

async function notifyVerifiedParticipantsOnDeletion({ movementId, movementTitle, deletedByEmail }) {
  const recipients = await listVerifiedParticipantEmails(movementId);
  const filtered = recipients.filter((email) => normalizeEmail(email) !== normalizeEmail(deletedByEmail));
  if (!filtered.length) return { sent: 0, mode: 'none' };
  if (!canSendReportEmail()) {
    fastify.log.info(
      { event: 'movement_deleted_notice_skipped', movement_id: movementId, recipients: filtered.length },
      'Email notifications disabled'
    );
    return { sent: 0, mode: 'disabled' };
  }
  const message = buildMovementDeletedEmail({ movementTitle, movementId, deletedByEmail });
  const results = await Promise.allSettled(
    filtered.map((email) => sendReportEmail({ to: email, ...message }))
  );
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return { sent, mode: 'email' };
}

function getStaffRoleForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  if (ADMIN_EMAILS.has(normalized)) return 'admin';
  if (MODERATOR_EMAILS.has(normalized)) return 'moderator';
  return null;
}

function normalizeStaffRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'admin' || raw === 'moderator') return raw;
  return null;
}

function getStaffRoleForUser(user) {
  const claimed =
    normalizeStaffRole(user?.app_metadata?.role) ||
    normalizeStaffRole(user?.user_metadata?.role) ||
    normalizeStaffRole(user?.role);
  if (claimed) return claimed;
  return getStaffRoleForEmail(user?.email);
}

// NOTE: Debug routes are dev-only; keep disabled unless explicitly enabled.
const DEBUG_ROUTES_ENABLED = (() => {
  const raw = String(process.env.ENABLE_DEBUG_ROUTES || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
})();

const ALLOWED_TAGS = new Set([
  'environment',
  'social_justice',
  'education',
  'health',
  'community',
  'arts',
  'technology',
  'animals',
  // Requested movement-type categories
  'protest',
  'meetup',
  'boycott',
  'review_bomb',
  'community_support',
  'fundraising',
  'awareness_campaign',
  'advocacy',
  'other',
]);

const ALLOWED_CHALLENGE_CATEGORIES = new Set([
  'kindness',
  'civic_literacy',
  'community_care',
  'community',
  'environment',
  'wellbeing',
]);

const DATABASE_URL = process.env.DATABASE_URL;
let storageMode = 'memory';
let hasDatabaseUrl = !!DATABASE_URL;

function safeParseDatabaseUrl(raw) {
  try {
    const s = String(raw || '').trim();
    if (!s) return null;
    // Supports postgres:// and postgresql:// URIs.
    const url = new URL(s);
    const dbName = url.pathname ? url.pathname.replace(/^\//, '') : '';
    return {
      host: url.hostname || null,
      dbName: dbName || null,
      sslmode: url.searchParams ? url.searchParams.get('sslmode') : null,
    };
  } catch {
    return null;
  }
}

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
// Render Postgres generally requires SSL. Also honor sslmode=require in DATABASE_URL.
const parsedDbUrl = safeParseDatabaseUrl(DATABASE_URL);
const sslMode = parsedDbUrl?.sslmode ? String(parsedDbUrl.sslmode).toLowerCase() : '';
const dbHost = parsedDbUrl?.host ? String(parsedDbUrl.host).toLowerCase() : '';
const hostLooksRemote = !!dbHost && dbHost !== 'localhost' && dbHost !== '127.0.0.1';
const shouldUseSsl =
  isProd ||
  String(process.env.DATABASE_SSL || '').toLowerCase() === 'true' ||
  sslMode === 'require' ||
  sslMode === 'verify-ca' ||
  sslMode === 'verify-full' ||
  hostLooksRemote;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ...(shouldUseSsl ? { ssl: { rejectUnauthorized: false } } : null),
});

async function checkDatabaseConnection() {
  if (!hasDatabaseUrl) {
    if (isProd) {
      console.error('[storage] FATAL: DATABASE_URL is missing; aborting startup.');
      process.exit(1);
    }
    storageMode = 'memory';
    console.warn('[storage] DEV: DATABASE_URL missing; using memory storage fallback.');
    console.info('[storage] mode=memory');
    return;
  }
  try {
    await pool.query('SELECT 1');
    storageMode = 'postgres';
    hasDatabaseUrl = true;
    const parsed = safeParseDatabaseUrl(DATABASE_URL);
    const host = parsed?.host ? String(parsed.host) : 'unknown';
    const dbName = parsed?.dbName ? String(parsed.dbName) : 'unknown';
    console.info('[storage] Postgres connection ok');
    console.info(`[storage] mode=postgres host=${host} db=${dbName}`);
    console.info('[storage] mode=postgres');
  } catch (err) {
    const message = err?.message ? String(err.message) : 'unknown error';
    const code = err?.code ? String(err.code) : 'unknown';
    if (isProd) {
      console.error(`[storage] FATAL: Postgres connection failed; aborting startup: ${code} ${message}`);
      process.exit(1);
    }

    console.error(`[storage] DEV: Postgres connection failed, falling back to memory: ${code} ${message}`);
    storageMode = 'memory';
    hasDatabaseUrl = false;
    console.info('[storage] mode=memory');
  }
}

// Production safety net: never serve from memory when DB is unavailable.
// (In production we already fail-fast on startup, but this prevents any accidental
// runtime fallback paths from returning stale/local data.)
fastify.addHook('onRequest', async (request, reply) => {
  if (!isProd) return;
  if (hasDatabaseUrl) return;
  const url = String(request?.url || '');
  if (url.startsWith('/health')) return;
  fastify.log.error({ url }, '[storage] FATAL: memory fallback blocked in production');
  reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
});

const uploadsDir = path.join(__dirname, 'uploads');
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  // ignore
}

const memoryMovements = [
  {
    id: 'test-movement-1',
    title: 'Test Movement',
    description: 'This is a test movement served from migration-mode fallback storage.',
    tags: ['demo'],
    created_at: new Date().toISOString(),
    momentum_score: 0,
  },
];

// Votes for memory-backed movements (and for when DB is unavailable).
// Map<movementId, Map<userEmail, -1|1>>
const memoryVotes = new Map();

// Platform acknowledgment (neutral platform role) memory fallback.
// Map<email, { accepted_at: isoString }>
const memoryPlatformAcks = new Map();

// Conversations/messages in memory fallback mode.
// conversation: { id, participant_emails: [email], created_at, updated_at }
// message: { id, conversation_id, sender_email, body, created_at, read_by: [email] }
const memoryConversations = [];
const memoryMessagesByConversation = new Map();
// Public keys for E2EE (memory fallback)
// Map<email, publicKeyB64>
const memoryPublicKeys = new Map();

// User follows (memory fallback)
// Map<followerEmail, Set<followingEmail>>
const memoryUserFollows = new Map();

// User profiles (memory fallback)
// Map<email, profileRecord>
const memoryUserProfiles = new Map();

// User blocks (memory fallback)
// Map<blockerEmail, Set<blockedEmail>>
const memoryUserBlocks = new Map();

// Notifications (memory fallback)
// Map<recipientEmail, Array<notification>>
const memoryNotificationsByRecipient = new Map();

// Leadership roles (memory fallback)
// Array<{id,user_email,role_type,movement_id,is_active,reached_cap,created_at,updated_at}>
const memoryLeadershipRoles = [];

// Movement follows (memory fallback)
// Map<movementId, Set<followerEmail>>
const memoryMovementFollows = new Map();

// Movement comments (memory fallback)
// Map<movementId, Array<{id, movement_id, author_email, content, created_at}>>
const memoryCommentsByMovement = new Map();

// Comment settings (harassment protection) (memory fallback)
// Map<movementId, { locked: boolean, slow_mode_seconds: number }>
const memoryCommentSettingsByMovement = new Map();

// Movement detail extras (memory fallback)
// Each is Map<movementId, Array<row>>
const memoryMovementResourcesByMovement = new Map();
const memoryMovementEventsByMovement = new Map();
const memoryMovementPetitionsByMovement = new Map();
const memoryMovementImpactUpdatesByMovement = new Map();
const memoryMovementEvidenceByMovement = new Map();
const memoryMovementTasksByMovement = new Map();
const memoryMovementDiscussionsByMovement = new Map();

// Event RSVPs/attendance (memory fallback)
// Map<eventId, Map<userEmail, {id,event_id,movement_id,user_email,status,attended,created_at,updated_at}>>
const memoryEventRsvpsByEvent = new Map();

// Petition signatures (memory fallback)
// Map<petitionId, Map<userEmail, {id,petition_id,movement_id,user_email,comment,is_public,created_at,updated_at}>>
const memoryPetitionSignaturesByPetition = new Map();

// Movement collaborators/invites (memory fallback)
// Map<movementId, Array<{id,movement_id,user_email,role,status,invited_by,created_date,accepted_date}>>
const memoryCollaboratorsByMovement = new Map();

// Reports (memory fallback)
// Array<{id, reporter_email, reported_content_type, reported_content_id, report_category, report_details, report_type, report_title, evidence_urls, status, created_at, updated_at}>
const memoryReports = [];
let memoryReportSeq = 1;


// Migration/Backup logs (memory fallback)
// Array<{id,type,status,started_at,finished_at,message,details}>
const memoryMigrationLogs = [];

async function ensureMigrationLogTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_logs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ NULL,
      message TEXT NOT NULL,
      details JSONB NULL
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_migration_logs_started_at ON migration_logs (started_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_migration_logs_type ON migration_logs (type, started_at DESC)');
}


async function writeMigrationLog({
  type,
  status,
  started_at,
  finished_at,
  message,
  details
}) {
  const id = randomUUID();
  const record = {
    id,
    type: String(type || 'other'),
    status: String(status || 'started'),
    started_at: started_at || nowIso(),
    finished_at: finished_at || null,
    message: String(message || ''),
    details: details || null
  };
  if (!hasDatabaseUrl) {
    memoryMigrationLogs.unshift(record);
    if (memoryMigrationLogs.length > 5000) memoryMigrationLogs.length = 5000;
    return record;
  }
  try {
    await ensureMigrationLogTable();
    await pool.query(
      `INSERT INTO migration_logs (id, type, status, started_at, finished_at, message, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        record.id,
        record.type,
        record.status,
        record.started_at,
        record.finished_at,
        record.message,
        record.details
      ]
    );
  } catch (e) {
    fastify.log.error({ err: e, type: record.type }, 'Failed to write migration log');
  }
  return record;
}

let movementsColumnsCache = null;

async function getMovementsColumns() {
  if (movementsColumnsCache) return movementsColumnsCache;
  const result = await pool.query(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'movements'`
  );
  movementsColumnsCache = result.rows;
  return movementsColumnsCache;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function cleanText(value, maxLen = 4000) {
  const raw = String(value ?? '');
  if (!raw.trim()) return '';
  const trimmed = raw.slice(0, Math.max(0, maxLen));
  // Preserve E2EE payloads verbatim so ciphertext is not corrupted.
  if (trimmed.startsWith(E2EE_BODY_PREFIX)) return trimmed;
  const cleaned = trimmed.trim();
  try {
    return profanityFilter.clean(cleaned);
  } catch {
    return cleaned;
  }
}

async function ensureVotesTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_votes (
      movement_id TEXT NOT NULL,
      voter_email TEXT NOT NULL,
      value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (movement_id, voter_email)
    );
  `);
}

async function ensureReportsTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id BIGSERIAL PRIMARY KEY,
      reporter_email TEXT NOT NULL,
      reported_content_type TEXT NOT NULL,
      reported_content_id TEXT NOT NULL,
      report_category TEXT NOT NULL,
      report_details TEXT NULL,
      report_type TEXT NULL,
      report_title TEXT NULL,
      evidence_urls TEXT[] NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      moderator_email TEXT NULL,
      moderator_notes TEXT NULL,
      action_taken TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS evidence_urls TEXT[] NULL');
  await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_type TEXT NULL');
  await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_title TEXT NULL');

  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_reports_status_created_at ON reports (status, created_at DESC)'
  );
}

async function ensureIncidentLogsTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incident_logs (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type TEXT NOT NULL,
      actor_user_id TEXT NULL,
      actor_email TEXT NULL,
      target_user_ids TEXT[] NULL,
      target_emails TEXT[] NULL,
      movement_id TEXT NULL,
      trigger_system TEXT NOT NULL DEFAULT 'server',
      human_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
      related_entity_type TEXT NULL,
      related_entity_id TEXT NULL,
      context JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_incident_logs_created_at ON incident_logs (created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_incident_logs_event_type ON incident_logs (event_type, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_incident_logs_actor_email ON incident_logs (actor_email, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_incident_logs_movement_id ON incident_logs (movement_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_incident_logs_trigger_system ON incident_logs (trigger_system, created_at DESC)');
}

function safeString(value, { max = 200 } = {}) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function safeStringList(value, { maxItems = 20, maxItemLen = 200 } = {}) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const v of value) {
    const s = safeString(v, { max: maxItemLen });
    if (!s) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out.length ? out : null;
}

function sanitizeIncidentContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return {};

  // Hard allowlist to prevent accidental private text storage.
  const allowedKeys = new Set([
    'action',
    'context_id',
    'retry_after_ms',
    'window_ms',
    'max',
    'count',
    'trust_score',
    'reported_content_type',
    'reported_content_id',
    'report_category',
    'status',
    'action_taken',
    'locked',
    'slow_mode_seconds',
  ]);

  const out = {};
  for (const [k, v] of Object.entries(context)) {
    if (!allowedKeys.has(k)) continue;
    if (typeof v === 'string') {
      const s = safeString(v, { max: 300 });
      if (s != null) out[k] = s;
      continue;
    }
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = v;
      continue;
    }
    if (typeof v === 'boolean') {
      out[k] = v;
      continue;
    }
  }
  return out;
}

async function logIncident({
  event_type,
  actor_user_id,
  actor_email,
  target_user_ids,
  target_emails,
  movement_id,
  trigger_system,
  human_reviewed,
  related_entity_type,
  related_entity_id,
  context,
} = {}) {
  const id = randomUUID();
  const record = {
    id,
    created_at: nowIso(),
    event_type: safeString(event_type, { max: 80 }) || 'unknown',
    actor_user_id: safeString(actor_user_id, { max: 80 }),
    actor_email: safeString(actor_email, { max: 200 }),
    target_user_ids: safeStringList(target_user_ids, { maxItems: 25, maxItemLen: 80 }),
    target_emails: safeStringList(target_emails, { maxItems: 25, maxItemLen: 200 }),
    movement_id: safeString(movement_id, { max: 80 }),
    trigger_system: safeString(trigger_system, { max: 40 }) || 'server',
    human_reviewed: !!human_reviewed,
    related_entity_type: safeString(related_entity_type, { max: 40 }),
    related_entity_id: safeString(related_entity_id, { max: 120 }),
    context: sanitizeIncidentContext(context),
  };

  // Memory fallback
  if (!hasDatabaseUrl) {
    memoryIncidentLogs.unshift(record);
    if (memoryIncidentLogs.length > 5000) memoryIncidentLogs.length = 5000;
    return record;
  }

  try {
    await ensureIncidentLogsTable();
    await pool.query(
      `INSERT INTO incident_logs
        (id, event_type, actor_user_id, actor_email, target_user_ids, target_emails, movement_id, trigger_system, human_reviewed, related_entity_type, related_entity_id, context)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        record.id,
        record.event_type,
        record.actor_user_id,
        record.actor_email,
        record.target_user_ids,
        record.target_emails,
        record.movement_id,
        record.trigger_system,
        record.human_reviewed,
        record.related_entity_type,
        record.related_entity_id,
        record.context,
      ]
    );
  } catch (e) {
    // Never break primary flows if incident logging fails.
    fastify.log.error({ err: e, event_type: record.event_type }, 'Failed to write incident log');
  }

  return record;
}

async function ensurePlatformAcknowledgmentsTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_acknowledgments (
      email TEXT PRIMARY KEY,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function hasPlatformAcknowledgment(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  if (!hasDatabaseUrl) {
    return memoryPlatformAcks.has(normalized);
  }

  await ensurePlatformAcknowledgmentsTable();
  const res = await pool.query('SELECT accepted_at FROM platform_acknowledgments WHERE email = $1 LIMIT 1', [normalized]);
  return !!res.rows?.[0]?.accepted_at;
}

async function ensureMessagesTables() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      participant_emails TEXT[] NOT NULL,
      is_request BOOLEAN NOT NULL DEFAULT FALSE,
      requester_email TEXT NULL,
      request_status TEXT NOT NULL DEFAULT 'accepted',
      blocked_by_email TEXT NULL,
      is_group BOOLEAN NOT NULL DEFAULT FALSE,
      group_name TEXT NULL,
      group_avatar_url TEXT NULL,
      group_type TEXT NULL,
      movement_id TEXT NULL,
      created_by_email TEXT NULL,
      group_admin_emails TEXT[] NOT NULL DEFAULT '{}',
      group_post_mode TEXT NOT NULL DEFAULT 'owner_only',
      group_posters TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_email TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_by TEXT[] NOT NULL DEFAULT '{}',
      delivered_to TEXT[] NOT NULL DEFAULT '{}',
      reactions JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages (conversation_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_conversations_participants_gin ON conversations USING GIN (participant_emails)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_conversations_movement_id ON conversations (movement_id)');

  // Ensure new request-related columns exist even if the table predates them.
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_request BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS requester_email TEXT NULL");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS request_status TEXT NOT NULL DEFAULT 'accepted'");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS blocked_by_email TEXT NULL");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_name TEXT NULL");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_avatar_url TEXT NULL");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_type TEXT NULL");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS movement_id TEXT NULL");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_by_email TEXT NULL");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_admin_emails TEXT[] NOT NULL DEFAULT '{}'");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_post_mode TEXT NOT NULL DEFAULT 'owner_only'");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_posters TEXT[] NOT NULL DEFAULT '{}'");

  // Ensure new message-related columns exist even if the table predates them.
  await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_to TEXT[] NOT NULL DEFAULT '{}'");
}

async function ensureUserFollowsTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_follows (
      follower_email TEXT NOT NULL,
      following_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (follower_email, following_email)
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows (follower_email)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows (following_email)');
}

async function ensureUserProfilesTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NULL,
      user_email TEXT NOT NULL UNIQUE,
      display_name TEXT NULL,
      username TEXT NULL,
      bio TEXT NULL,
      profile_photo_url TEXT NULL,
      banner_url TEXT NULL,
      location JSONB NULL,
      catchment_radius_km INT NULL,
      skills TEXT[] NULL,
      ai_features_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      birthdate DATE NULL,
      age_verified BOOLEAN NOT NULL DEFAULT FALSE,
      onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
      onboarding_current_step INT NOT NULL DEFAULT 0,
      onboarding_interests TEXT[] NOT NULL DEFAULT '{}',
      onboarding_completed_tutorials TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS user_id TEXT NULL');
  await pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS banner_offset_y DOUBLE PRECISION NULL');
  await pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_seen_update_version TEXT NULL');
  await pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS has_seen_tutorial_v2 BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query(
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS movement_group_opt_out BOOLEAN NOT NULL DEFAULT FALSE'
  );
  await pool.query(
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_notifications_opt_in BOOLEAN NOT NULL DEFAULT FALSE'
  );
  await pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS birthdate DATE NULL');
  await pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS age_verified BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query(
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE'
  );
  await pool.query(
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_current_step INT NOT NULL DEFAULT 0'
  );
  await pool.query(
    "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_interests TEXT[] NOT NULL DEFAULT '{}'"
  );
  await pool.query(
    "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed_tutorials TEXT[] NOT NULL DEFAULT '{}'"
  );
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles (user_id)');
  try {
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_user_id_unique ON user_profiles (user_id) WHERE user_id IS NOT NULL'
    );
  } catch (e) {
    fastify.log.warn({ err: e }, 'Failed to ensure unique user_id index');
  }
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles (user_email)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles (username)');
  try {
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_username_lower ON user_profiles (LOWER(username)) WHERE username IS NOT NULL'
    );
  } catch (e) {
    fastify.log.warn({ err: e }, 'Failed to ensure unique username index');
  }
}

async function ensureNotificationsTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_email TEXT NOT NULL,
      type TEXT NOT NULL,
      actor_name TEXT NULL,
      actor_email TEXT NULL,
      content_id TEXT NULL,
      content_ref TEXT NULL,
      content_title TEXT NULL,
      metadata JSONB NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications (recipient_email, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications (recipient_email, is_read)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications (type)');
}

async function ensureLeadershipRolesTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leadership_roles (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      role_type TEXT NOT NULL,
      movement_id TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      reached_cap BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_email, role_type, movement_id)
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_leadership_roles_user ON leadership_roles (user_email)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_leadership_roles_type_active ON leadership_roles (role_type, is_active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_leadership_roles_movement ON leadership_roles (movement_id)');
}

async function ensureUserBlocksTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_email TEXT NOT NULL,
      blocked_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_email, blocked_email)
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks (blocker_email)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_email)');
}

async function getUserBlockSets(email) {
  const me = normalizeEmail(email);
  const empty = { blocked: new Set(), blockedBy: new Set() };
  if (!me) return empty;

  if (!hasDatabaseUrl) {
    const blocked = memoryUserBlocks.get(me) || new Set();
    const blockedBy = new Set();
    for (const [blocker, list] of memoryUserBlocks.entries()) {
      if (list && list.has(me)) blockedBy.add(blocker);
    }
    return { blocked: new Set(blocked), blockedBy };
  }

  await ensureUserBlocksTable();
  const blockedRes = await pool.query('SELECT blocked_email FROM user_blocks WHERE blocker_email = $1', [me]);
  const blockedByRes = await pool.query('SELECT blocker_email FROM user_blocks WHERE blocked_email = $1', [me]);

  const blocked = new Set(
    (Array.isArray(blockedRes.rows) ? blockedRes.rows : [])
      .map((r) => normalizeEmail(r?.blocked_email))
      .filter(Boolean)
  );
  const blockedBy = new Set(
    (Array.isArray(blockedByRes.rows) ? blockedByRes.rows : [])
      .map((r) => normalizeEmail(r?.blocker_email))
      .filter(Boolean)
  );

  return { blocked, blockedBy };
}

function isBlockedForViewer(targetEmail, viewerBlocks) {
  const target = normalizeEmail(targetEmail);
  if (!target || !viewerBlocks) return false;
  return viewerBlocks.blocked.has(target) || viewerBlocks.blockedBy.has(target);
}

function isBlockedByViewer(targetEmail, viewerBlocks) {
  const target = normalizeEmail(targetEmail);
  if (!target || !viewerBlocks) return false;
  return viewerBlocks.blocked.has(target);
}

function sendBlockedInteraction(reply) {
  return reply.code(403).send({
    error: "You can't interact with this account.",
    code: 'USER_BLOCKED',
  });
}

async function areUsersBlockedEitherDirection(emailA, emailB) {
  const a = normalizeEmail(emailA);
  const b = normalizeEmail(emailB);
  if (!a || !b) return false;
  if (a === b) return false;

  const aBlocks = await getUserBlockSets(a);
  return isBlockedForViewer(b, aBlocks);
}

async function doesUserFollow(followerEmail, followingEmail) {
  const follower = normalizeEmail(followerEmail);
  const following = normalizeEmail(followingEmail);
  if (!follower || !following) return false;
  if (follower === following) return true;

  if (!hasDatabaseUrl) {
    const set = memoryUserFollows.get(follower) || new Set();
    return set.has(following);
  }

  await ensureUserFollowsTable();
  const res = await pool.query(
    'SELECT 1 FROM user_follows WHERE follower_email = $1 AND following_email = $2 LIMIT 1',
    [follower, following]
  );
  return (res.rows?.length || 0) > 0;
}

async function ensurePublicKeysTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_public_keys (
      email TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function ensureMovementFollowsTable() {
  if (!hasDatabaseUrl) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_follows (
      movement_id TEXT NOT NULL,
      follower_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (movement_id, follower_email)
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_follows_movement ON movement_follows (movement_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_follows_follower ON movement_follows (follower_email)');
}

async function ensureMovementCommentsTables() {
  if (!hasDatabaseUrl) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_comments (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      author_email TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_comments_movement_created_at ON movement_comments (movement_id, created_at DESC)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_comment_settings (
      movement_id TEXT PRIMARY KEY,
      locked BOOLEAN NOT NULL DEFAULT FALSE,
      slow_mode_seconds INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function ensureMovementExtrasTables() {
  if (!hasDatabaseUrl) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_resources (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NULL,
      file_url TEXT NULL,
      file_name TEXT NULL,
      mime_type TEXT NULL,
      file_size INT NULL,
      category TEXT NULL,
      download_count INT NOT NULL DEFAULT 0,
      description TEXT NULL,
      created_by_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_resources_movement_created_at ON movement_resources (movement_id, created_at DESC)');

  // Backfill columns for older schemas.
  await pool.query('ALTER TABLE movement_resources ADD COLUMN IF NOT EXISTS file_url TEXT NULL');
  await pool.query('ALTER TABLE movement_resources ADD COLUMN IF NOT EXISTS file_name TEXT NULL');
  await pool.query('ALTER TABLE movement_resources ADD COLUMN IF NOT EXISTS mime_type TEXT NULL');
  await pool.query('ALTER TABLE movement_resources ADD COLUMN IF NOT EXISTS file_size INT NULL');
  await pool.query('ALTER TABLE movement_resources ADD COLUMN IF NOT EXISTS category TEXT NULL');
  await pool.query('ALTER TABLE movement_resources ADD COLUMN IF NOT EXISTS download_count INT NOT NULL DEFAULT 0');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_events (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      title TEXT NOT NULL,
      starts_at TIMESTAMPTZ NULL,
      location TEXT NULL,
      url TEXT NULL,
      virtual_link TEXT NULL,
      max_attendees INT NULL,
      description TEXT NULL,
      created_by_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_events_movement_created_at ON movement_events (movement_id, created_at DESC)');

  // Backfill columns for older schemas.
  await pool.query('ALTER TABLE movement_events ADD COLUMN IF NOT EXISTS virtual_link TEXT NULL');
  await pool.query('ALTER TABLE movement_events ADD COLUMN IF NOT EXISTS max_attendees INT NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_event_rsvps (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'going',
      attended BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_event_rsvps_event_user ON movement_event_rsvps (event_id, user_email)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON movement_event_rsvps (event_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_event_rsvps_movement ON movement_event_rsvps (movement_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_petitions (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      goal_signatures INT NULL,
      created_by_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_petitions_movement_created_at ON movement_petitions (movement_id, created_at DESC)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_petition_signatures (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      petition_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      comment TEXT NULL,
      is_public BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_petition_sigs_petition_user ON movement_petition_signatures (petition_id, user_email)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_petition_sigs_petition ON movement_petition_signatures (petition_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_petition_sigs_movement ON movement_petition_signatures (movement_id, created_at DESC)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_impact_updates (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      title TEXT NULL,
      content TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_impact_movement_created_at ON movement_impact_updates (movement_id, created_at DESC)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_tasks (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      assigned_to_email TEXT NULL,
      created_by_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_tasks_movement_updated_at ON movement_tasks (movement_id, updated_at DESC)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_discussions (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      author_email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_discussions_movement_created_at ON movement_discussions (movement_id, created_at DESC)');
}

async function ensureMovementEvidenceTable() {
  if (!hasDatabaseUrl) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movement_evidence (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      submitter_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      media_type TEXT NOT NULL,
      url TEXT NOT NULL,
      text TEXT NULL,
      caption TEXT NULL,
      file_name TEXT NULL,
      mime_type TEXT NULL,
      file_size INT NULL,
      verified_by_email TEXT NULL,
      verified_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('ALTER TABLE movement_evidence ADD COLUMN IF NOT EXISTS text TEXT NULL');
  await pool.query('ALTER TABLE movement_evidence ALTER COLUMN url DROP NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_evidence_movement_created_at ON movement_evidence (movement_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_evidence_status ON movement_evidence (status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_movement_evidence_submitter ON movement_evidence (submitter_email)');
}

async function ensureCollaboratorsTable() {
  if (!hasDatabaseUrl) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS collaborators (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NULL,
      created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_date TIMESTAMPTZ NULL
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_collaborators_movement ON collaborators (movement_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_collaborators_user ON collaborators (user_email)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_collaborators_movement_user ON collaborators (movement_id, user_email)');
}

function memoryListCollaborators(movementId) {
  const id = String(movementId || '').trim();
  if (!id) return [];
  return memoryCollaboratorsByMovement.get(id) || [];
}

function memoryFindCollaboratorById(collabId) {
  const id = String(collabId || '').trim();
  if (!id) return null;
  for (const list of memoryCollaboratorsByMovement.values()) {
    if (!Array.isArray(list)) continue;
    const found = list.find((c) => String(c?.id) === id);
    if (found) return found;
  }
  return null;
}

function memoryUpsertCollaborator(movementId, record) {
  const id = String(movementId || '').trim();
  if (!id) return null;
  const list = memoryCollaboratorsByMovement.get(id) || [];
  const next = Array.isArray(list) ? [...list] : [];
  const idx = next.findIndex((c) => String(c?.id) === String(record?.id));
  if (idx === -1) next.unshift(record);
  else next[idx] = { ...next[idx], ...(record || {}) };
  memoryCollaboratorsByMovement.set(id, next);
  return record;
}

function memoryDeleteCollaborator(collabId) {
  const id = String(collabId || '').trim();
  if (!id) return false;
  for (const [movementId, list] of memoryCollaboratorsByMovement.entries()) {
    if (!Array.isArray(list)) continue;
    const next = list.filter((c) => String(c?.id) !== id);
    if (next.length === list.length) continue;
    memoryCollaboratorsByMovement.set(String(movementId), next);
    return true;
  }
  return false;
}

function memoryListExtras(map, movementId) {
  return map.get(String(movementId)) || [];
}

function findMemoryEventById(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return null;
  for (const list of memoryMovementEventsByMovement.values()) {
    if (!Array.isArray(list)) continue;
    const found = list.find((e) => String(e?.id) === id);
    if (found) return found;
  }
  return null;
}

function memoryGetEventRsvpMap(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return new Map();
  const existing = memoryEventRsvpsByEvent.get(id);
  if (existing) return existing;
  const created = new Map();
  memoryEventRsvpsByEvent.set(id, created);
  return created;
}

function findMemoryPetitionById(petitionId) {
  const id = String(petitionId || '').trim();
  if (!id) return null;
  for (const list of memoryMovementPetitionsByMovement.values()) {
    if (!Array.isArray(list)) continue;
    const found = list.find((p) => String(p?.id) === id);
    if (found) return found;
  }
  return null;
}

function memoryGetPetitionSignatureMap(petitionId) {
  const id = String(petitionId || '').trim();
  if (!id) return new Map();
  const existing = memoryPetitionSignaturesByPetition.get(id);
  if (existing) return existing;
  const created = new Map();
  memoryPetitionSignaturesByPetition.set(id, created);
  return created;
}

function memoryGetPetitionSignature(petitionId, userEmail) {
  const id = String(petitionId || '').trim();
  const email = normalizeEmail(userEmail);
  if (!id || !email) return null;
  const byUser = memoryGetPetitionSignatureMap(id);
  return byUser.get(email) || null;
}

function memoryUpsertPetitionSignature(petitionId, userEmail, patch) {
  const id = String(petitionId || '').trim();
  const email = normalizeEmail(userEmail);
  if (!id || !email) return null;

  const byUser = memoryGetPetitionSignatureMap(id);
  const existing = byUser.get(email);
  const now = nowIso();
  const next = {
    id: existing?.id || randomUUID(),
    ...(existing || {}),
    ...(patch || {}),
    petition_id: id,
    user_email: email,
    updated_at: now,
    created_at: existing?.created_at || now,
  };
  byUser.set(email, next);
  return next;
}

function memoryDeletePetitionSignature(petitionId, userEmail) {
  const id = String(petitionId || '').trim();
  const email = normalizeEmail(userEmail);
  if (!id || !email) return false;
  const byUser = memoryGetPetitionSignatureMap(id);
  return byUser.delete(email);
}

function memoryGetPetitionSignatureSummary(petitionId) {
  const id = String(petitionId || '').trim();
  const byUser = memoryGetPetitionSignatureMap(id);

  let count = 0;
  let velocity_7d = 0;
  let velocity_24h = 0;

  const now = Date.now();
  const ms7d = 7 * 24 * 60 * 60 * 1000;
  const ms24h = 24 * 60 * 60 * 1000;

  for (const sig of byUser.values()) {
    if (!sig) continue;
    count += 1;
    const ts = (() => {
      try {
        return new Date(sig.created_at || 0).getTime();
      } catch {
        return 0;
      }
    })();
    if (ts && now - ts <= ms7d) velocity_7d += 1;
    if (ts && now - ts <= ms24h) velocity_24h += 1;
  }

  return { count, velocity_7d, velocity_24h };
}

function findMemoryResourceById(resourceId) {
  const id = String(resourceId || '').trim();
  if (!id) return null;
  for (const list of memoryMovementResourcesByMovement.values()) {
    if (!Array.isArray(list)) continue;
    const found = list.find((r) => String(r?.id) === id);
    if (found) return found;
  }
  return null;
}

function findMemoryEvidenceById(evidenceId) {
  const id = String(evidenceId || '').trim();
  if (!id) return null;
  for (const list of memoryMovementEvidenceByMovement.values()) {
    if (!Array.isArray(list)) continue;
    const found = list.find((e) => String(e?.id) === id);
    if (found) return found;
  }
  return null;
}

function memoryUpdateResourceById(resourceId, patch) {
  const id = String(resourceId || '').trim();
  if (!id) return null;
  for (const [movementId, list] of memoryMovementResourcesByMovement.entries()) {
    if (!Array.isArray(list)) continue;
    const idx = list.findIndex((r) => String(r?.id) === id);
    if (idx === -1) continue;
    const cur = list[idx];
    const next = { ...cur, ...(patch || {}) };
    list[idx] = next;
    memoryMovementResourcesByMovement.set(String(movementId), list);
    return next;
  }
  return null;
}

function memoryUpdateEvidenceById(evidenceId, patch) {
  const id = String(evidenceId || '').trim();
  if (!id) return null;
  for (const [movementId, list] of memoryMovementEvidenceByMovement.entries()) {
    if (!Array.isArray(list)) continue;
    const idx = list.findIndex((e) => String(e?.id) === id);
    if (idx === -1) continue;
    const cur = list[idx];
    const next = { ...cur, ...(patch || {}) };
    list[idx] = next;
    memoryMovementEvidenceByMovement.set(String(movementId), list);
    return next;
  }
  return null;
}

function memoryCountApprovedEvidenceParticipants(movementId) {
  const id = String(movementId || '').trim();
  if (!id) return 0;
  const list = memoryListExtras(memoryMovementEvidenceByMovement, id);
  const unique = new Set();
  for (const ev of list) {
    if (String(ev?.status || '').toLowerCase() !== 'approved') continue;
    const email = normalizeEmail(ev?.submitter_email);
    if (email) unique.add(email);
  }
  return unique.size;
}

function updateMemoryMovementVerifiedParticipants(movementId) {
  const id = String(movementId || '').trim();
  if (!id) return 0;
  const count = memoryCountApprovedEvidenceParticipants(id);
  const idx = memoryMovements.findIndex((m) => String(m?.id) === id);
  if (idx !== -1) {
    memoryMovements[idx] = { ...memoryMovements[idx], verified_participants: count };
  }
  return count;
}

async function updateMovementVerifiedParticipants(movementId) {
  const id = String(movementId || '').trim();
  if (!id) return 0;
  if (!hasDatabaseUrl) {
    return updateMemoryMovementVerifiedParticipants(id);
  }

  try {
    await ensureMovementEvidenceTable();
    await ensureMovementExtrasColumns();
    const res = await pool.query(
      `SELECT COUNT(DISTINCT submitter_email)::int AS count
       FROM movement_evidence
       WHERE movement_id = $1 AND status = 'approved'`,
      [id]
    );
    const count = res.rows?.[0]?.count ?? 0;
    await pool.query('UPDATE movements SET verified_participants = $1 WHERE id = $2', [count, id]);
    return count;
  } catch (e) {
    fastify.log.warn({ err: e, movement_id: id }, 'Failed to update verified participant count');
    return 0;
  }
}

function memoryDeleteResourceById(resourceId) {
  const id = String(resourceId || '').trim();
  if (!id) return false;
  for (const [movementId, list] of memoryMovementResourcesByMovement.entries()) {
    if (!Array.isArray(list)) continue;
    const next = list.filter((r) => String(r?.id) !== id);
    if (next.length === list.length) continue;
    memoryMovementResourcesByMovement.set(String(movementId), next);
    return true;
  }
  return false;
}

function memoryUpsertEventRsvp(eventId, userEmail, patch) {
  const id = String(eventId || '').trim();
  const email = normalizeEmail(userEmail);
  if (!id || !email) return null;

  const byUser = memoryGetEventRsvpMap(id);
  const existing = byUser.get(email);
  const now = nowIso();
  const next = {
    id: existing?.id || randomUUID(),
    ...(existing || {}),
    ...(patch || {}),
    event_id: id,
    user_email: email,
    updated_at: now,
    created_at: existing?.created_at || now,
  };
  byUser.set(email, next);
  return next;
}

function memoryDeleteEventRsvp(eventId, userEmail) {
  const id = String(eventId || '').trim();
  const email = normalizeEmail(userEmail);
  if (!id || !email) return false;
  const byUser = memoryGetEventRsvpMap(id);
  return byUser.delete(email);
}

function memoryGetEventRsvp(eventId, userEmail) {
  const id = String(eventId || '').trim();
  const email = normalizeEmail(userEmail);
  if (!id || !email) return null;
  const byUser = memoryGetEventRsvpMap(id);
  return byUser.get(email) || null;
}

function memoryGetEventRsvpSummary(eventId) {
  const id = String(eventId || '').trim();
  const byUser = memoryGetEventRsvpMap(id);
  let going_count = 0;
  let interested_count = 0;
  let attended_count = 0;
  for (const r of byUser.values()) {
    if (!r) continue;
    if (r.status === 'going') going_count += 1;
    if (r.status === 'interested') interested_count += 1;
    if (r.attended) attended_count += 1;
  }
  return { going_count, interested_count, attended_count };
}

async function tryGetUserEmailFromRequest(request) {
  const authHeader = request.headers?.authorization ? String(request.headers.authorization) : '';
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.email) return null;
    return normalizeEmail(data.user.email);
  } catch {
    return null;
  }
}

function memoryAppendExtra(map, movementId, row) {
  const id = String(movementId);
  const list = map.get(id) || [];
  list.unshift(row);
  map.set(id, list);
  return row;
}

function memoryUpdateTask(movementId, taskId, patch) {
  const id = String(movementId);
  const list = memoryMovementTasksByMovement.get(id) || [];
  const idx = list.findIndex((t) => String(t?.id) === String(taskId));
  if (idx === -1) return null;
  const cur = list[idx];
  const next = { ...cur, ...patch, updated_at: nowIso() };
  list[idx] = next;
  memoryMovementTasksByMovement.set(id, list);
  return next;
}

function getMemoryCommentSettings(movementId) {
  const id = String(movementId || '').trim();
  if (!id) return { locked: false, slow_mode_seconds: 0 };
  return memoryCommentSettingsByMovement.get(id) || { locked: false, slow_mode_seconds: 0 };
}

function setMemoryCommentSettings(movementId, patch) {
  const id = String(movementId || '').trim();
  if (!id) return { locked: false, slow_mode_seconds: 0 };
  const current = getMemoryCommentSettings(id);
  const next = {
    locked: typeof patch?.locked === 'boolean' ? patch.locked : current.locked,
    slow_mode_seconds:
      typeof patch?.slow_mode_seconds === 'number' && Number.isFinite(patch.slow_mode_seconds)
        ? Math.max(0, Math.floor(patch.slow_mode_seconds))
        : current.slow_mode_seconds,
  };
  memoryCommentSettingsByMovement.set(id, next);
  return next;
}

async function getMovementOwnerEmail(movementId) {
  const id = String(movementId || '').trim();
  if (!id) return null;

  const fromMemory = memoryMovements.find((m) => String(m?.id) === id) || null;
  if (fromMemory?.author_email) return normalizeEmail(fromMemory.author_email);

  if (!hasDatabaseUrl) return null;
  try {
    const res = await pool.query('SELECT author_email FROM movements WHERE id = $1 LIMIT 1', [id]);
    return normalizeEmail(res.rows?.[0]?.author_email);
  } catch {
    return null;
  }
}

async function getMovementTitle(movementId) {
  const id = String(movementId || '').trim();
  if (!id) return null;

  const fromMemory = memoryMovements.find((m) => String(m?.id) === id) || null;
  if (fromMemory?.title) return String(fromMemory.title);

  if (!hasDatabaseUrl) return null;
  try {
    const res = await pool.query('SELECT title FROM movements WHERE id = $1 LIMIT 1', [id]);
    return res.rows?.[0]?.title ? String(res.rows[0].title) : null;
  } catch {
    return null;
  }
}

async function listVerifiedParticipantEmails(movementId) {
  const id = String(movementId || '').trim();
  if (!id) return [];

  if (!hasDatabaseUrl) {
    const list = memoryListExtras(memoryMovementEvidenceByMovement, id)
      .filter((e) => String(e?.status || '') === 'approved')
      .map((e) => normalizeEmail(e?.submitter_email))
      .filter(Boolean);
    return Array.from(new Set(list));
  }

  try {
    await ensureMovementEvidenceTable();
    const res = await pool.query(
      `SELECT DISTINCT submitter_email
       FROM movement_evidence
       WHERE movement_id = $1 AND status = $2 AND submitter_email IS NOT NULL`,
      [id, 'approved']
    );
    const list = (res.rows || [])
      .map((r) => normalizeEmail(r?.submitter_email))
      .filter(Boolean);
    return Array.from(new Set(list));
  } catch {
    return [];
  }
}

async function filterMovementGroupOptOut(emails) {
  const list = Array.from(new Set((Array.isArray(emails) ? emails : []).map(normalizeEmail).filter(Boolean)));
  if (!list.length) return [];

  if (!hasDatabaseUrl) {
    return list.filter((email) => !memoryUserProfiles.get(email)?.movement_group_opt_out);
  }

  try {
    await ensureUserProfilesTable();
    const res = await pool.query(
      'SELECT user_email, movement_group_opt_out FROM user_profiles WHERE user_email = ANY($1)',
      [list]
    );
    const optedOut = new Set(
      (Array.isArray(res.rows) ? res.rows : [])
        .filter((r) => r?.movement_group_opt_out)
        .map((r) => normalizeEmail(r?.user_email))
        .filter(Boolean)
    );
    return list.filter((email) => !optedOut.has(email));
  } catch {
    return list;
  }
}

async function getMovementCollaboratorRole(movementId, userEmail) {
  const id = String(movementId || '').trim();
  const email = normalizeEmail(userEmail);
  if (!id || !email) return null;

  if (!hasDatabaseUrl) {
    const list = memoryListCollaborators(id);
    const record = Array.isArray(list)
      ? list.find((c) => normalizeEmail(c?.user_email) === email && String(c?.status || '') === 'accepted')
      : null;
    return record?.role ? String(record.role) : null;
  }

  try {
    await ensureCollaboratorsTable();
    const res = await pool.query(
      'SELECT role FROM collaborators WHERE movement_id = $1 AND user_email = $2 AND status = $3 LIMIT 1',
      [id, email, 'accepted']
    );
    return res.rows?.[0]?.role ? String(res.rows[0].role) : null;
  } catch {
    return null;
  }
}

function normalizeEmail(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s || null;
}

function normalizeUsername(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s || null;
}

function isValidUsername(value) {
  if (!value) return false;
  return /^[a-z0-9_]{3,32}$/.test(String(value));
}

function sanitizeProfileLocation(location) {
  if (!location || typeof location !== 'object') return location;
  const out = Array.isArray(location) ? [...location] : { ...location };
  if (out && typeof out === 'object') {
    if ('coordinates' in out) delete out.coordinates;
    if ('lat' in out) delete out.lat;
    if ('lng' in out) delete out.lng;
    if ('lon' in out) delete out.lon;
    if ('latitude' in out) delete out.latitude;
    if ('longitude' in out) delete out.longitude;
  }
  return out;
}

function sanitizeUserProfileRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const out = { ...record };

  // Never export raw coordinates fields (legacy).
  delete out.location_lat;
  delete out.location_lon;
  delete out.location_lng;
  delete out.private_coordinates;
  delete out.private_coords;
  delete out.precise_location;

  if (out.location) out.location = sanitizeProfileLocation(out.location);

  // Never export sensitive scoring / internal flags even if they exist.
  for (const key of Object.keys(out)) {
    const k = String(key).toLowerCase();
    if (
      k.includes('trust_score') ||
      k.includes('trustscore') ||
      k.includes('risk_flag') ||
      k.includes('riskflag') ||
      k.includes('internal_flag') ||
      k.includes('internalflag') ||
      k.includes('moderation') ||
      k.includes('admin_log') ||
      k.includes('adminlog')
    ) {
      delete out[key];
    }
  }

  return out;
}

function sanitizePublicUserProfileRecord(record) {
  const out = sanitizeUserProfileRecord(record);
  if (!out || typeof out !== 'object') return out;
  // Keep user_email so authenticated clients can follow/message by email.
  delete out.birthdate;
  delete out.age_verified;
  delete out.email_notifications_opt_in;
  delete out.movement_group_opt_out;
  delete out.ai_features_enabled;
  delete out.last_seen_update_version;
  delete out.has_seen_tutorial_v2;
  delete out.onboarding_completed;
  delete out.onboarding_current_step;
  delete out.onboarding_interests;
  delete out.onboarding_completed_tutorials;
  return out;
}

async function getPublicProfilesByEmail(emails) {
  const list = Array.from(
    new Set(
      (Array.isArray(emails) ? emails : [])
        .map((e) => normalizeEmail(e))
        .filter(Boolean)
    )
  );
  const lookup = new Map();
  if (!list.length) return lookup;

  if (!hasDatabaseUrl) {
    for (const email of list) {
      const profile = memoryUserProfiles.get(email);
      if (profile) {
        lookup.set(email, {
          user_id: profile?.user_id ?? null,
          display_name: profile?.display_name ?? null,
          username: profile?.username ?? null,
          profile_photo_url: profile?.profile_photo_url ?? null,
        });
      }
    }
    return lookup;
  }

  try {
    await ensureUserProfilesTable();
    const res = await pool.query(
      `SELECT user_id, user_email, display_name, username, profile_photo_url
       FROM user_profiles
       WHERE user_email = ANY($1)`,
      [list]
    );
    for (const row of Array.isArray(res.rows) ? res.rows : []) {
      const email = normalizeEmail(row?.user_email);
      if (!email) continue;
      lookup.set(email, {
        user_id: row?.user_id ?? null,
        display_name: row?.display_name ?? null,
        username: row?.username ?? null,
        profile_photo_url: row?.profile_photo_url ?? null,
      });
    }
  } catch (e) {
    fastify.log.warn({ err: e }, 'Failed to load public profiles for movement authors');
  }

  return lookup;
}

async function attachCreatorProfilesToMovements(movements) {
  const list = Array.isArray(movements) ? movements : [];
  const emails = list
    .map((m) => m?.author_email || m?.creator_email || null)
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  const lookup = await getPublicProfilesByEmail(emails);

  return list.map((movement) => {
    const email = normalizeEmail(movement?.author_email || movement?.creator_email || '');
    const profile = email ? lookup.get(email) : null;
    const displayName = profile?.display_name ?? null;
    const username = profile?.username ?? null;
    const photo = profile?.profile_photo_url ?? null;
    const creatorUserId = profile?.user_id ?? null;
    return {
      ...movement,
      creator_user_id: creatorUserId,
      creator_display_name: displayName,
      creator_username: username,
      creator_profile_photo_url: photo,
      author_display_name: displayName,
      author_username: username,
    };
  });
}

function sanitizeAuthUser(user) {
  if (!user || typeof user !== 'object') return user;
  return {
    id: user.id ?? null,
    email: user.email ?? null,
    created_at: user.created_at ?? null,
    email_confirmed_at: user.email_confirmed_at ?? user.confirmed_at ?? null,
    user_metadata: (() => {
      const meta = user.user_metadata && typeof user.user_metadata === 'object' ? { ...user.user_metadata } : null;
      if (!meta) return null;
      for (const key of Object.keys(meta)) {
        const k = String(key).toLowerCase();
        if (k.includes('lat') || k.includes('lng') || k.includes('lon') || k.includes('coord') || k.includes('trust') || k.includes('risk')) {
          delete meta[key];
        }
      }
      return meta;
    })(),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function getMemoryConversationById(id) {
  return memoryConversations.find((c) => String(c?.id) === String(id)) || null;
}

function memoryEnsureConversationBetween(a, b) {
  const emailA = normalizeEmail(a);
  const emailB = normalizeEmail(b);
  if (!emailA || !emailB) return null;
  const participants = [emailA, emailB].sort();
  const existing =
    memoryConversations.find((c) => {
      const pe = Array.isArray(c?.participant_emails) ? c.participant_emails.map((x) => String(x).toLowerCase()).sort() : [];
      return pe.length === 2 && pe[0] === participants[0] && pe[1] === participants[1];
    }) || null;
  if (existing) return existing;

  const created = {
    id: randomUUID(),
    participant_emails: participants,
    is_request: false,
    requester_email: null,
    request_status: 'accepted',
    blocked_by_email: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  memoryConversations.unshift(created);
  memoryMessagesByConversation.set(created.id, []);
  return created;
}

function memoryEnsureConversationBetweenWithRequest(a, b, requestMeta) {
  const convo = memoryEnsureConversationBetween(a, b);
  if (!convo) return null;
  const next = {
    ...convo,
    is_request: !!requestMeta?.is_request,
    requester_email: requestMeta?.requester_email ? normalizeEmail(requestMeta.requester_email) : null,
    request_status: requestMeta?.request_status ? String(requestMeta.request_status) : (requestMeta?.is_request ? 'pending' : 'accepted'),
    blocked_by_email: requestMeta?.blocked_by_email ? normalizeEmail(requestMeta.blocked_by_email) : null,
  };
  const idx = memoryConversations.findIndex((c) => String(c?.id) === String(convo.id));
  if (idx !== -1) memoryConversations[idx] = next;
  return next;
}

function memoryFindGroupConversation(movementId, groupType) {
  const id = String(movementId || '').trim();
  const type = String(groupType || '').trim();
  if (!id || !type) return null;
  return (
    memoryConversations.find(
      (c) =>
        c?.is_group &&
        String(c?.movement_id || '') === id &&
        String(c?.group_type || '') === type
    ) || null
  );
}

function memoryCreateGroupConversation({
  participant_emails,
  group_name,
  group_type,
  movement_id,
  created_by_email,
  group_avatar_url,
  group_admin_emails,
  group_post_mode,
  group_posters,
}) {
  const list = Array.isArray(participant_emails)
    ? participant_emails.map((e) => normalizeEmail(e)).filter(Boolean)
    : [];
  const unique = Array.from(new Set(list));
  if (unique.length < 2) return null;

  const owner = created_by_email ? normalizeEmail(created_by_email) : null;
  const admins = normalizeEmailList(group_admin_emails);
  if (owner && !admins.includes(owner)) admins.unshift(owner);

  const created = {
    id: randomUUID(),
    participant_emails: unique,
    is_request: false,
    requester_email: null,
    request_status: 'accepted',
    blocked_by_email: null,
    is_group: true,
    group_name: group_name ? String(group_name) : null,
    group_avatar_url: group_avatar_url ? String(group_avatar_url) : null,
    group_type: group_type ? String(group_type) : null,
    movement_id: movement_id ? String(movement_id) : null,
    created_by_email: owner,
    group_admin_emails: admins,
    group_post_mode: GROUP_POST_MODES.has(String(group_post_mode || '')) ? String(group_post_mode) : 'owner_only',
    group_posters: normalizeEmailList(group_posters),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  memoryConversations.unshift(created);
  memoryMessagesByConversation.set(created.id, []);
  return created;
}

function normalizeEmailList(list, { max = 50 } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const value of list) {
    const email = normalizeEmail(value);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= max) break;
  }
  return out;
}

function getGroupAdmins(convo) {
  const admins = normalizeEmailList(convo?.group_admin_emails);
  const owner = normalizeEmail(convo?.created_by_email);
  if (owner && !admins.includes(owner)) admins.push(owner);
  return admins;
}

function getGroupPostMode(convo) {
  const mode = String(convo?.group_post_mode || '').trim();
  return GROUP_POST_MODES.has(mode) ? mode : 'owner_only';
}

function canManageGroup(convo, email) {
  const me = normalizeEmail(email);
  if (!me || !convo?.is_group) return false;
  return getGroupAdmins(convo).includes(me);
}

function canPostToGroup(convo, email) {
  const me = normalizeEmail(email);
  if (!me || !convo?.is_group) return false;
  const mode = getGroupPostMode(convo);
  const admins = getGroupAdmins(convo);
  const owner = normalizeEmail(convo?.created_by_email);
  if (mode === 'all') return true;
  if (mode === 'admins') return admins.includes(me);
  if (mode === 'owner_only') return owner ? owner === me : admins.includes(me);
  const posters = normalizeEmailList(convo?.group_posters);
  return admins.includes(me) || posters.includes(me);
}

function normalizeGroupAvatarUrl(value) {
  const raw = safeString(value, { max: MAX_TEXT_LENGTHS.profilePhotoUrl });
  if (!raw) return null;
  if (raw.startsWith('/uploads/')) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function getOtherParticipantEmail(convo, myEmail) {
  const me = normalizeEmail(myEmail);
  const list = Array.isArray(convo?.participant_emails) ? convo.participant_emails : [];
  const other = list.find((x) => normalizeEmail(x) !== me) || list[0] || null;
  return normalizeEmail(other);
}

function memoryListConversationsForUser(email) {
  const me = normalizeEmail(email);
  if (!me) return [];
  const convos = memoryConversations
    .filter((c) => Array.isArray(c?.participant_emails) && c.participant_emails.map((x) => String(x).toLowerCase()).includes(me))
    .map((c) => {
      const messages = memoryMessagesByConversation.get(c.id) || [];
      const last = messages.length ? messages[messages.length - 1] : null;
      const unreadCount = messages.filter((m) => {
        if (normalizeEmail(m?.sender_email) === me) return false;
        const readBy = Array.isArray(m?.read_by) ? m.read_by.map((x) => String(x).toLowerCase()) : [];
        return !readBy.includes(me);
      }).length;
      return {
        ...c,
        last_message_body: last?.body ?? null,
        last_message_at: last?.created_at ?? null,
        unread_count: unreadCount,
      };
    })
    .sort((a, b) => String(b.last_message_at || b.updated_at).localeCompare(String(a.last_message_at || a.updated_at)));
  return convos;
}

function memoryListMessages(conversationId) {
  return memoryMessagesByConversation.get(String(conversationId)) || [];
}

function memoryAppendMessage(conversationId, senderEmail, body) {
  const convo = getMemoryConversationById(conversationId);
  if (!convo) return null;
  const cleanBody = cleanText(body, MAX_TEXT_LENGTHS.messageCiphertext);
  if (!cleanBody) return null;

  const message = {
    id: randomUUID(),
    conversation_id: String(conversationId),
    sender_email: String(senderEmail),
    body: cleanBody,
    created_at: nowIso(),
    read_by: [String(senderEmail).toLowerCase()],
    delivered_to: [],
    reactions: {},
  };
  const list = memoryMessagesByConversation.get(String(conversationId)) || [];
  list.push(message);
  memoryMessagesByConversation.set(String(conversationId), list);
  convo.updated_at = nowIso();
  return message;
}

function memoryMarkMessageDelivered(messageId, recipientEmail) {
  const id = String(messageId || '');
  const me = normalizeEmail(recipientEmail);
  if (!id || !me) return null;

  for (const [conversationId, list] of memoryMessagesByConversation.entries()) {
    const idx = Array.isArray(list) ? list.findIndex((m) => String(m?.id) === id) : -1;
    if (idx === -1) continue;
    const msg = list[idx];

    const convo = getMemoryConversationById(conversationId);
    if (!convo) return null;
    const participants = Array.isArray(convo.participant_emails)
      ? convo.participant_emails.map((x) => String(x).toLowerCase())
      : [];
    if (!participants.includes(me)) return null;

    const status = String(convo?.request_status || 'accepted');
    const blockedBy = normalizeEmail(convo?.blocked_by_email);
    if (status === 'blocked' && blockedBy && blockedBy !== me) return null;
    if (normalizeEmail(msg?.sender_email) === me) return msg;

    const prev = Array.isArray(msg.delivered_to) ? msg.delivered_to.map((x) => normalizeEmail(x)).filter(Boolean) : [];
    if (!prev.includes(me)) msg.delivered_to = [...prev, me];
    list[idx] = msg;
    memoryMessagesByConversation.set(String(conversationId), list);
    return msg;
  }
  return null;
}

function memoryFindMessageById(messageId) {
  const id = String(messageId || '');
  if (!id) return null;
  for (const list of memoryMessagesByConversation.values()) {
    if (!Array.isArray(list)) continue;
    const found = list.find((m) => String(m?.id) === id);
    if (found) return found;
  }
  return null;
}

function memoryToggleMessageReaction(messageId, actorEmail, emoji) {
  const id = String(messageId || '');
  const me = normalizeEmail(actorEmail);
  const key = String(emoji || '').trim();
  if (!id || !me || !key) return null;

  for (const [conversationId, list] of memoryMessagesByConversation.entries()) {
    const idx = Array.isArray(list) ? list.findIndex((m) => String(m?.id) === id) : -1;
    if (idx === -1) continue;
    const msg = list[idx];

    const convo = getMemoryConversationById(conversationId);
    if (!convo) return null;
    const participants = Array.isArray(convo.participant_emails)
      ? convo.participant_emails.map((x) => String(x).toLowerCase())
      : [];
    if (!participants.includes(me)) return null;

    const status = String(convo?.request_status || 'accepted');
    const blockedBy = normalizeEmail(convo?.blocked_by_email);
    if (status === 'blocked' && blockedBy && blockedBy !== me) return null;

    const reactions = msg && typeof msg.reactions === 'object' && msg.reactions ? msg.reactions : {};
    const prev = Array.isArray(reactions[key]) ? reactions[key].map((x) => normalizeEmail(x)).filter(Boolean) : [];
    const has = prev.includes(me);
    const nextList = has ? prev.filter((x) => x !== me) : [...prev, me];
    const next = { ...reactions };
    if (nextList.length) next[key] = nextList;
    else delete next[key];
    msg.reactions = next;
    list[idx] = msg;
    memoryMessagesByConversation.set(String(conversationId), list);
    return msg;
  }

  return null;
}

function memoryMarkConversationRead(conversationId, readerEmail) {
  const me = normalizeEmail(readerEmail);
  if (!me) return 0;
  const list = memoryMessagesByConversation.get(String(conversationId)) || [];
  let updated = 0;
  for (const m of list) {
    if (normalizeEmail(m?.sender_email) === me) continue;
    const readBy = Array.isArray(m.read_by) ? m.read_by : [];
    if (!readBy.map((x) => String(x).toLowerCase()).includes(me)) {
      m.read_by = [...readBy, me];
      updated += 1;
    }
  }
  memoryMessagesByConversation.set(String(conversationId), list);
  return updated;
}

function getMemoryVoteSummary(movementId, voterEmail) {
  const byUser = memoryVotes.get(String(movementId)) || new Map();
  let upvotes = 0;
  let downvotes = 0;
  for (const v of byUser.values()) {
    if (v === 1) upvotes += 1;
    if (v === -1) downvotes += 1;
  }
  const myVote = voterEmail ? (byUser.get(String(voterEmail)) ?? 0) : 0;
  return { upvotes, downvotes, score: upvotes - downvotes, myVote };
}

async function getDbVoteSummary(movementId, voterEmail) {
  const id = String(movementId);
  const countsRes = await pool.query(
    `SELECT
      COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
      COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
     FROM movement_votes
     WHERE movement_id = $1`,
    [id]
  );

  const upvotes = countsRes.rows?.[0]?.upvotes ?? 0;
  const downvotes = countsRes.rows?.[0]?.downvotes ?? 0;

  let myVote = 0;
  if (voterEmail) {
    const myRes = await pool.query(
      'SELECT value FROM movement_votes WHERE movement_id = $1 AND voter_email = $2 LIMIT 1',
      [id, String(voterEmail)]
    );
    const v = myRes.rows?.[0]?.value;
    myVote = typeof v === 'number' ? v : 0;
  }

  return { upvotes, downvotes, score: upvotes - downvotes, myVote };
}

async function requireVerifiedUser(request, reply) {
  const authHeader = request.headers?.authorization ? String(request.headers.authorization) : '';
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    reply.code(401).send({ error: 'Authentication required' });
    return null;
  }

  let data;
  let error;
  try {
    // Avoid hanging requests (which can surface as upstream 503s without CORS).
    const timeoutMs = Number(process.env.SUPABASE_AUTH_TIMEOUT_MS || 7000);
    ({ data, error } = await Promise.race([
      supabase.auth.getUser(token),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase auth timeout')), timeoutMs)),
    ]));
  } catch (e) {
    fastify.log.error({ err: e }, 'Supabase auth lookup failed');
    reply.code(500).send({ error: 'Authentication service unavailable' });
    return null;
  }

  if (error || !data?.user) {
    reply.code(401).send({ error: 'Invalid session' });
    return null;
  }

  const user = data.user;
  const emailVerified = !!(user.email_confirmed_at || user.confirmed_at);
  if (!emailVerified) {
    reply.code(403).send({ error: 'Email verification required' });
    return null;
  }

  return user;
}

function withTimeout(promise, ms, label) {
  const timeoutMs = Number(ms);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        const err = new Error(`${label || 'operation'} timeout`);
        err.code = 'PP_TIMEOUT';
        err.timeoutMs = timeoutMs;
        err.label = label || 'operation';
        reject(err);
      }, timeoutMs)
    ),
  ]);
}

async function getOptionalAuthedEmail(request) {
  const authHeader = request.headers?.authorization ? String(request.headers.authorization) : '';
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  try {
    const timeoutMs = Number(process.env.SUPABASE_AUTH_TIMEOUT_MS || 7000);
    const { data, error } = await Promise.race([
      supabase.auth.getUser(token),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase auth timeout')), timeoutMs)),
    ]);
    if (error || !data?.user?.email) return null;
    return normalizeEmail(data.user.email);
  } catch {
    return null;
  }
}

async function requireStaffUser(request, reply) {
  const user = await requireVerifiedUser(request, reply);
  if (!user) return null;

  const role = getStaffRoleForUser(user);
  if (!role) {
    fastify.log.info(
      { event: 'staff_access_denied', user_email: String(user?.email || ''), path: safePathFromRequest(request) },
      'Staff access denied'
    );
    reply.code(403).send({ error: 'Staff access required' });
    return null;
  }

  return user;
}

async function requireAdminUser(request, reply) {
  const user = await requireStaffUser(request, reply);
  if (!user) return null;

  const role = getStaffRoleForUser(user);
  if (role !== 'admin') {
    fastify.log.info(
      {
        event: 'admin_access_denied',
        user_email: String(user?.email || ''),
        role: role || 'user',
        path: safePathFromRequest(request),
      },
      'Admin access denied'
    );
    reply.code(403).send({ error: 'Admin access required' });
    return null;
  }

  return user;
}

function buildInsertForMovements(columns, payload) {
  const byName = new Map(columns.map((c) => [c.column_name, c]));

  const title = String(payload.title || '').trim();
  const description = String(payload.description || payload.summary || '').trim();
  const descriptionHtml = payload.description_html != null ? String(payload.description_html) : null;
  const authorEmail = payload.author_email ? String(payload.author_email).trim() : null;
  const tagsArray = normalizeTags(payload.tags);
  const createdAt = new Date().toISOString();

  const locationCity = payload.location_city != null ? String(payload.location_city).trim() : null;
  const locationCountry = payload.location_country != null ? String(payload.location_country).trim() : null;

  const locationLat = typeof payload.location_lat === 'number' ? payload.location_lat : null;
  const locationLon = typeof payload.location_lon === 'number' ? payload.location_lon : null;

  const mediaUrls = Array.isArray(payload.media_urls)
    ? payload.media_urls.map((u) => String(u).trim()).filter(Boolean)
    : null;

  const claims = payload.claims != null ? payload.claims : null;
  const visibility = normalizeMovementVisibility(payload.visibility);

  const candidates = {
    title,
    description,
    summary: description,
    description_html: descriptionHtml,
    visibility,
    author_email: authorEmail,
    created_at: createdAt,
    tags: tagsArray,
    location_city: locationCity,
    location_country: locationCountry,
    location_lat: locationLat,
    location_lon: locationLon,
    media_urls: mediaUrls,
    claims,
    momentum_score: 0,
  };

  const insertCols = [];
  const insertVals = [];
  const valueExprs = [];

  for (const [key, value] of Object.entries(candidates)) {
    const col = byName.get(key);
    if (!col) continue;
    if (value == null) continue;

    insertCols.push(key);

    // For tags, adapt to column type.
    if (key === 'tags') {
      if (col.data_type === 'ARRAY' || col.udt_name === '_text') {
        insertVals.push(tagsArray);
        valueExprs.push(`$${insertVals.length}`);
      } else if (col.data_type === 'json' || col.data_type === 'jsonb') {
        insertVals.push(tagsArray);
        valueExprs.push(`$${insertVals.length}::jsonb`);
      } else {
        insertVals.push(tagsArray.join(','));
        valueExprs.push(`$${insertVals.length}`);
      }
      continue;
    }

    // For json fields, cast when the DB column expects json/jsonb.
    if (key === 'media_urls' || key === 'claims') {
      if (col.data_type === 'json' || col.data_type === 'jsonb') {
        insertVals.push(value);
        valueExprs.push(`$${insertVals.length}::jsonb`);
      } else {
        insertVals.push(JSON.stringify(value));
        valueExprs.push(`$${insertVals.length}`);
      }
      continue;
    }

    insertVals.push(value);
    valueExprs.push(`$${insertVals.length}`);
  }

  // Minimal required columns: title + description/summary (whatever exists)
  if (!insertCols.includes('title')) {
    throw new Error('Database schema missing required column: title');
  }
  if (!insertCols.includes('description') && !insertCols.includes('summary')) {
    throw new Error('Database schema missing required column: description/summary');
  }

  return {
    text: `INSERT INTO movements (${insertCols.join(', ')}) VALUES (${valueExprs.join(', ')}) RETURNING *`,
    values: insertVals,
  };
}

// File uploads for movement evidence/media.
// - Stored on disk in Server/uploads
// - Served via GET /uploads/<filename>
fastify.register(require('@fastify/multipart'), {
  limits: {
    // NOTE: Safety: enforce upload limit to prevent oversized payloads.
    fileSize: MAX_UPLOAD_BYTES,
  },
});

fastify.register(require('@fastify/static'), {
  root: uploadsDir,
  prefix: '/uploads/',
  decorateReply: false,
});

function readMultipartField(fields, name) {
  if (!fields || !name) return null;
  const entry = fields[name];
  if (!entry) return null;
  if (Array.isArray(entry)) {
    const value = entry[0]?.value;
    return value != null ? String(value) : null;
  }
  if (typeof entry === 'object' && 'value' in entry) {
    return entry.value != null ? String(entry.value) : null;
  }
  return null;
}

async function ensureMovementExtrasColumns() {
  if (!hasDatabaseUrl) return;
  try {
    await pool.query("ALTER TABLE movements ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'");
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS description_html TEXT');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS location_city TEXT');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS location_country TEXT');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS location_lon DOUBLE PRECISION');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS verified_participants INT NOT NULL DEFAULT 0');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS media_urls JSONB');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS claims JSONB');
    movementsColumnsCache = null;
  } catch (e) {
    fastify.log.warn({ err: e }, 'Failed to ensure movement extra columns');
  }
}

function normalizeMovementVisibility(value) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (raw === 'community' || raw === 'private' || raw === 'public') return raw;
  return 'public';
}

function getMovementOwnerEmailFromRecord(movement) {
  return normalizeEmail(movement?.author_email || movement?.creator_email || movement?.created_by_email || '');
}

function canViewerSeeMovementByVisibility({ movement, viewerEmail, viewerFollowedMovementIds }) {
  const visibility = normalizeMovementVisibility(movement?.visibility);
  if (visibility === 'public') return true;

  const viewer = viewerEmail ? normalizeEmail(viewerEmail) : null;
  if (!viewer) return false;

  const owner = getMovementOwnerEmailFromRecord(movement);
  if (owner && viewer && owner === viewer) return true;

  if (visibility === 'private') return false;

  const mid = String(movement?.id || '').trim();
  return !!(mid && viewerFollowedMovementIds && viewerFollowedMovementIds.has(mid));
}

async function getViewerFollowedMovementIds(viewerEmail) {
  const email = normalizeEmail(viewerEmail);
  if (!email) return new Set();

  if (!hasDatabaseUrl) {
    const set = new Set();
    for (const [movementId, followers] of memoryMovementFollows.entries()) {
      if (followers && typeof followers.has === 'function' && followers.has(email)) {
        set.add(String(movementId));
      }
    }
    return set;
  }

  try {
    await ensureMovementFollowsTable();
    const res = await pool.query('SELECT movement_id FROM movement_follows WHERE follower_email = $1', [String(email)]);
    const ids = new Set();
    for (const r of res.rows || []) {
      if (r?.movement_id) ids.add(String(r.movement_id));
    }
    return ids;
  } catch {
    return new Set();
  }
}

fastify.post('/uploads', { config: { rateLimit: RATE_LIMITS.upload } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const contentLengthHeader = request.headers?.['content-length'];
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_UPLOAD_BYTES) {
    return reply.code(413).send({ error: 'File too large' });
  }

  let file;
  try {
    file = await request.file();
  } catch (e) {
    fastify.log.warn({ err: e }, 'Upload parse failed');
    return reply.code(400).send({ error: 'Invalid upload payload' });
  }

  if (!file) return reply.code(400).send({ error: 'file is required' });

  // Enforce size limit
  if (typeof file.file.truncated === 'boolean' && file.file.truncated) {
    return reply.code(413).send({ error: 'File too large' });
  }
  if (file.file.bytesRead && file.file.bytesRead > MAX_UPLOAD_BYTES) {
    return reply.code(413).send({ error: 'File too large' });
  }

  // Enforce MIME type
  const mime = file.mimetype ? String(file.mimetype).toLowerCase() : '';
  if (!mime) {
    return reply.code(415).send({ error: 'Unsupported file type' });
  }
  const kind = readMultipartField(file.fields, 'kind');
  const normalizedKind = kind ? String(kind).trim().toLowerCase() : null;
  const imageOnlyKind = normalizedKind === 'avatar' || normalizedKind === 'banner' || normalizedKind === 'group_avatar';
  if (imageOnlyKind) {
    if (!IMAGE_ONLY_UPLOAD_MIME_TYPES.includes(mime)) {
      return reply.code(415).send({ error: 'Unsupported image type' });
    }
  } else if (!ALLOWED_UPLOAD_MIME_TYPES.includes(mime)) {
    return reply.code(415).send({ error: 'Unsupported file type' });
  }

  const originalName = String(file.filename || 'upload');
  const ext = path.extname(originalName).slice(0, 12);
  const storedName = `${randomUUID()}${ext}`;
  const targetPath = path.join(uploadsDir, storedName);

  try {
    await pipeline(file.file, fs.createWriteStream(targetPath));
  } catch (e) {
    fastify.log.error({ err: e }, 'Upload write failed');
    return reply.code(500).send({ error: 'Failed to store upload' });
  }

  return reply.send({
    ok: true,
    kind: normalizedKind || null,
    url: `/uploads/${storedName}`,
    filename: originalName,
    mime: file.mimetype,
  });
});

// Platform role declaration acknowledgment
fastify.get('/platform-acknowledgment/me', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  if (!hasDatabaseUrl) {
    const record = memoryPlatformAcks.get(email) || null;
    return reply.send({ accepted: !!record, accepted_at: record?.accepted_at ?? null });
  }

  try {
    await ensurePlatformAcknowledgmentsTable();
    const res = await pool.query('SELECT accepted_at FROM platform_acknowledgments WHERE email = $1 LIMIT 1', [email]);
    const acceptedAt = res.rows?.[0]?.accepted_at ?? null;
    return reply.send({ accepted: !!acceptedAt, accepted_at: acceptedAt });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load platform acknowledgment');
    return reply.code(500).send({ error: 'Failed to load acknowledgment' });
  }
});

fastify.post('/platform-acknowledgment/me', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({ accepted: z.literal(true) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload' });
  }

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  if (!hasDatabaseUrl) {
    memoryPlatformAcks.set(email, { accepted_at: nowIso() });
    return reply.send({ ok: true });
  }

  try {
    await ensurePlatformAcknowledgmentsTable();
    await pool.query(
      `INSERT INTO platform_acknowledgments (email)
       VALUES ($1)
       ON CONFLICT (email) DO NOTHING`,
      [email]
    );
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to record platform acknowledgment');
    return reply.code(500).send({ error: 'Failed to record acknowledgment' });
  }
});

// Public key directory for end-to-end encryption (E2EE).
// The server never sees plaintext messages; it only stores ciphertext.
fastify.post('/me/public-key', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({ public_key: z.string().min(20).max(5000) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload' });
  }

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const publicKey = String(parsed.data.public_key).trim();
  if (!publicKey) return reply.code(400).send({ error: 'public_key is required' });

  if (!hasDatabaseUrl) {
    memoryPublicKeys.set(email, publicKey);
    return reply.send({ ok: true });
  }

  try {
    await ensurePublicKeysTable();
    await pool.query(
      `INSERT INTO user_public_keys (email, public_key)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET public_key = EXCLUDED.public_key, updated_at = NOW()`,
      [email, publicKey]
    );
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to upsert public key');
    return reply.code(500).send({ error: 'Failed to publish public key' });
  }
});

fastify.get('/public-keys/:email', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const email = normalizeEmail(request.params?.email);
  if (!email) return reply.code(400).send({ error: 'Valid email is required' });

  if (!hasDatabaseUrl) {
    const key = memoryPublicKeys.get(email) || null;
    if (!key) return reply.code(404).send({ error: 'Public key not found' });
    return reply.send({ email, public_key: key });
  }

  try {
    await ensurePublicKeysTable();
    const result = await pool.query('SELECT public_key FROM user_public_keys WHERE email = $1 LIMIT 1', [email]);
    const key = result.rows?.[0]?.public_key || null;
    if (!key) return reply.code(404).send({ error: 'Public key not found' });
    return reply.send({ email, public_key: key });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to fetch public key');
    return reply.code(500).send({ error: 'Failed to fetch public key' });
  }
});

// NOTE: /movements is hardened to never 500 due to query params; on error it falls back to a safe test movement.
fastify.get('/movements', async (request, reply) => {
  try {
    function parseIntParam(value, fallback, { min = 0, max = 500 } = {}) {
      const n = Number.parseInt(String(value ?? ''), 10);
      if (!Number.isFinite(n)) return fallback;
      const clamped = Math.max(min, Math.min(max, n));
      return clamped;
    }

    function normalizeFields(value) {
      if (!value) return null;
      const list = String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return list.length ? Array.from(new Set(list)) : null;
    }

    function stripHtml(text) {
      return String(text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function buildSummaryFromDescription(description) {
      const plain = stripHtml(description);
      if (!plain) return null;
      return plain.length > 200 ? `${plain.slice(0, 200)}…` : plain;
    }

    function projectRecord(record, fields) {
      if (!fields) return record;
      const out = {};
      const want = new Set(['id', ...fields]);

      for (const key of want) {
        if (key === 'summary') {
          const summary =
            record?.summary != null
              ? String(record.summary)
              : buildSummaryFromDescription(record?.description);
          if (summary != null) out.summary = summary;
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(record, key)) {
          out[key] = record[key];
          continue;
        }

        // Back-compat aliases
        if (key === 'created_date' && record?.created_at && out.created_date == null) {
          out.created_date = record.created_at;
        }
      }

      return out;
    }

    const limit = parseIntParam(request.query?.limit, 20, { min: 1, max: 100 });
    const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
    const fields = normalizeFields(request.query?.fields);

    const mineRaw = request.query?.mine;
    const mine = mineRaw === '1' || mineRaw === 1 || mineRaw === true || String(mineRaw || '').toLowerCase() === 'true';

    let mineEmail = null;
    if (mine) {
      const authedUser = await requireVerifiedUser(request, reply);
      if (!authedUser) return;
      mineEmail = normalizeEmail(authedUser.email);
      if (!mineEmail) return reply.code(400).send({ error: 'User email is required' });
    }
    const viewerEmail = await getOptionalAuthedEmail(request);
    const viewerFollowedMovementIds = mineEmail ? new Set() : await getViewerFollowedMovementIds(viewerEmail);
    const viewerBlocks = viewerEmail ? await getUserBlockSets(viewerEmail) : null;

    const canViewMovement = (movement) => {
      // Visibility
      if (!mineEmail) {
        if (!canViewerSeeMovementByVisibility({ movement, viewerEmail, viewerFollowedMovementIds })) return false;
      }

      // Blocks
      if (!viewerBlocks) return true;
      const authorEmail = normalizeEmail(movement?.author_email || movement?.creator_email || '');
      return !isBlockedForViewer(authorEmail, viewerBlocks);
    };

    function sortByCreatedDesc(a, b) {
      const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    }

    if (!hasDatabaseUrl) {
      const merged = memoryMovements
        .map((m) => {
          const summary = getMemoryVoteSummary(m?.id, null);
          return {
            ...m,
            upvotes: summary.upvotes,
            boosts_count: summary.upvotes,
            downvotes: summary.downvotes,
            score: summary.score,
            verified_participants: memoryCountApprovedEvidenceParticipants(m?.id),
          };
        })
        .filter((m) => {
          if (!mineEmail) return true;
          const authorEmail = normalizeEmail(m?.author_email || m?.creator_email || m?.created_by_email || '');
          return authorEmail === mineEmail;
        })
        .filter(canViewMovement)
        .sort(sortByCreatedDesc);

      const page = merged.slice(offset, offset + limit);
      const enriched = await attachCreatorProfilesToMovements(page);
      return reply.send(enriched.map((m) => projectRecord(m, fields)));
    }

    try {
      await ensureVotesTable();
      const values = [];
      let whereClause = '';
      if (mineEmail) {
        values.push(mineEmail);
        whereClause = `WHERE LOWER(COALESCE(m.author_email, m.creator_email, m.created_by_email, '')) = LOWER($${values.length})`;
      }

      const result = await pool.query(
        {
          text: `SELECT
           m.*,
           COALESCE(v.upvotes, 0)::int AS upvotes,
           COALESCE(v.upvotes, 0)::int AS boosts_count,
           COALESCE(v.downvotes, 0)::int AS downvotes,
           (COALESCE(v.upvotes, 0) - COALESCE(v.downvotes, 0))::int AS score
         FROM movements m
         LEFT JOIN (
           SELECT
             movement_id,
             COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
             COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
           FROM movement_votes
           GROUP BY movement_id
         ) v ON v.movement_id = m.id
         ${whereClause}
         ORDER BY m.created_at DESC
         LIMIT 500`,
          values,
        }
      );

      const rows = Array.isArray(result.rows) ? result.rows : [];
      const seen = new Set(rows.map((r) => String(r?.id)));
      const mergedMemory = memoryMovements
        .filter((m) => !seen.has(String(m?.id)))
        .map((m) => {
          const summary = getMemoryVoteSummary(m?.id, null);
          return {
            ...m,
            upvotes: summary.upvotes,
            boosts_count: summary.upvotes,
            downvotes: summary.downvotes,
            score: summary.score,
            verified_participants: memoryCountApprovedEvidenceParticipants(m?.id),
          };
        });

      const merged = [...rows, ...mergedMemory].filter(canViewMovement).sort(sortByCreatedDesc);
      const page = merged.slice(offset, offset + limit);
      const enriched = await attachCreatorProfilesToMovements(page);
      return reply.send(enriched.map((m) => projectRecord(m, fields)));
    } catch (e) {
      fastify.log.warn({ err: e }, 'DB query failed for GET /movements; using memory fallback');
      const merged = memoryMovements
        .map((m) => {
          const summary = getMemoryVoteSummary(m?.id, null);
          return {
            ...m,
            upvotes: summary.upvotes,
            boosts_count: summary.upvotes,
            downvotes: summary.downvotes,
            score: summary.score,
            verified_participants: memoryCountApprovedEvidenceParticipants(m?.id),
          };
        })
        .filter((m) => {
          if (!mineEmail) return true;
          const authorEmail = normalizeEmail(m?.author_email || m?.creator_email || m?.created_by_email || '');
          return authorEmail === mineEmail;
        })
        .filter(canViewMovement)
        .sort(sortByCreatedDesc);
      const page = merged.slice(offset, offset + limit);
      const enriched = await attachCreatorProfilesToMovements(page);
      return reply.send(enriched.map((m) => projectRecord(m, fields)));
    }
  } catch (err) {
    fastify.log.error({ err }, 'GET /movements failed; returning fallback');
    return reply.send({
      ok: true,
      movements: [
        {
          id: 'test-movement-1',
          title: 'Test Movement',
          description: 'This is a test movement served from migration-mode fallback storage.',
          tags: ['demo'],
          created_at: new Date().toISOString(),
          momentum_score: 0,
          upvotes: 0,
            boosts_count: 0,
          downvotes: 0,
          score: 0,
        },
      ],
    });
  }
});

fastify.get('/movements/:id', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const viewerEmail = await getOptionalAuthedEmail(request);
  const viewerFollowedMovementIds = await getViewerFollowedMovementIds(viewerEmail);
  const viewerBlocks = viewerEmail ? await getUserBlockSets(viewerEmail) : null;
  const isHiddenForViewer = (movement) => {
    if (!viewerBlocks) return false;
    const authorEmail = normalizeEmail(movement?.author_email || movement?.creator_email || '');
    return isBlockedForViewer(authorEmail, viewerBlocks);
  };

  const isNotVisibleForViewer = (movement) => {
    return !canViewerSeeMovementByVisibility({ movement, viewerEmail, viewerFollowedMovementIds });
  };

  if (!hasDatabaseUrl) {
    const found = memoryMovements.find((m) => String(m.id) === id) || null;
    if (!found) return reply.code(404).send({ error: 'Movement not found' });
    if (isNotVisibleForViewer(found)) return reply.code(404).send({ error: 'Movement not found' });
    if (isHiddenForViewer(found)) return reply.code(404).send({ error: 'Movement not found' });
    const summary = getMemoryVoteSummary(found?.id, null);
    const enriched = (await attachCreatorProfilesToMovements([{
      ...found,
      upvotes: summary.upvotes,
      boosts_count: summary.upvotes,
      downvotes: summary.downvotes,
      score: summary.score,
      verified_participants: memoryCountApprovedEvidenceParticipants(found?.id),
    }]))[0];
    return enriched;
  }

  try {
    await ensureVotesTable();
    const result = await pool.query(
      {
        text: `SELECT
          m.*,
          COALESCE(v.upvotes, 0)::int AS upvotes,
          COALESCE(v.upvotes, 0)::int AS boosts_count,
          COALESCE(v.downvotes, 0)::int AS downvotes,
          (COALESCE(v.upvotes, 0) - COALESCE(v.downvotes, 0))::int AS score
        FROM movements m
        LEFT JOIN (
          SELECT
            movement_id,
            COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
            COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
          FROM movement_votes
          GROUP BY movement_id
        ) v ON v.movement_id = m.id
        WHERE m.id = $1
        LIMIT 1`,
        values: [id],
      }
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      // DB is reachable but the movement might have been created via the
      // in-memory fallback path.
      const fromMemory = memoryMovements.find((m) => String(m.id) === id) || null;
      if (fromMemory) {
        if (isNotVisibleForViewer(fromMemory)) return reply.code(404).send({ error: 'Movement not found' });
        if (isHiddenForViewer(fromMemory)) return reply.code(404).send({ error: 'Movement not found' });
        const summary = getMemoryVoteSummary(fromMemory?.id, null);
        const enriched = (await attachCreatorProfilesToMovements([{
          ...fromMemory,
          upvotes: summary.upvotes,
          boosts_count: summary.upvotes,
          downvotes: summary.downvotes,
          score: summary.score,
          verified_participants: memoryCountApprovedEvidenceParticipants(fromMemory?.id),
        }]))[0];
        return enriched;
      }
      return reply.code(404).send({ error: 'Movement not found' });
    }
    if (isNotVisibleForViewer(row)) return reply.code(404).send({ error: 'Movement not found' });
    if (isHiddenForViewer(row)) return reply.code(404).send({ error: 'Movement not found' });
    const enriched = (await attachCreatorProfilesToMovements([row]))[0];
    return enriched;
  } catch (e) {
    fastify.log.warn({ err: e }, 'DB query failed for GET /movements/:id; using list fallback');
    try {
      await ensureVotesTable();
      const all = await pool.query(
        `SELECT
          m.*,
          COALESCE(v.upvotes, 0)::int AS upvotes,
          COALESCE(v.upvotes, 0)::int AS boosts_count,
          COALESCE(v.downvotes, 0)::int AS downvotes,
          (COALESCE(v.upvotes, 0) - COALESCE(v.downvotes, 0))::int AS score
        FROM movements m
        LEFT JOIN (
          SELECT
            movement_id,
            COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
            COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
          FROM movement_votes
          GROUP BY movement_id
        ) v ON v.movement_id = m.id
        ORDER BY m.created_at DESC
        LIMIT 50`
      );
      const found = all.rows.find((m) => String(m.id) === id) || null;
      if (!found) {
        const fromMemory = memoryMovements.find((m) => String(m.id) === id) || null;
        if (fromMemory) {
        if (isNotVisibleForViewer(fromMemory)) return reply.code(404).send({ error: 'Movement not found' });
        if (isHiddenForViewer(fromMemory)) return reply.code(404).send({ error: 'Movement not found' });
        const summary = getMemoryVoteSummary(fromMemory?.id, null);
        const enriched = (await attachCreatorProfilesToMovements([{
          ...fromMemory,
          upvotes: summary.upvotes,
          boosts_count: summary.upvotes,
          downvotes: summary.downvotes,
          score: summary.score,
          verified_participants: memoryCountApprovedEvidenceParticipants(fromMemory?.id),
        }]))[0];
        return enriched;
        }
        return reply.code(404).send({ error: 'Movement not found' });
      }
      if (isNotVisibleForViewer(found)) return reply.code(404).send({ error: 'Movement not found' });
      if (isHiddenForViewer(found)) return reply.code(404).send({ error: 'Movement not found' });
      const enriched = (await attachCreatorProfilesToMovements([found]))[0];
      return enriched;
    } catch (e2) {
      fastify.log.error({ err: e2 }, 'DB fallback failed for GET /movements/:id');
      return reply.code(500).send({ error: 'Failed to load movement' });
    }
  }
});

fastify.get('/movements/:id/votes', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  if (!hasDatabaseUrl) {
    return reply.send(getMemoryVoteSummary(id, authedUser.email));
  }

  try {
    await ensureVotesTable();
    const summary = await getDbVoteSummary(id, authedUser.email);
    return reply.send(summary);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load votes');
    return reply.code(500).send({ error: 'Failed to load votes' });
  }
});

fastify.get('/movements/:id/follow', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  if (!hasDatabaseUrl) {
    const set = memoryMovementFollows.get(String(id)) || new Set();
    const following = set.has(email);
    return reply.send({ following, followers_count: set.size });
  }

  try {
    await ensureMovementFollowsTable();
    const res = await pool.query(
      'SELECT 1 FROM movement_follows WHERE movement_id = $1 AND follower_email = $2 LIMIT 1',
      [String(id), String(email)]
    );
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM movement_follows WHERE movement_id = $1', [
      String(id),
    ]);
    const following = (res.rows?.length || 0) > 0;
    const followers_count = countRes.rows?.[0]?.count ?? 0;
    return reply.send({ following, followers_count });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load follow state');
    return reply.code(500).send({ error: 'Failed to load follow state' });
  }
});

fastify.get('/movements/:id/follow/count', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  if (!hasDatabaseUrl) {
    const set = memoryMovementFollows.get(String(id)) || new Set();
    return reply.send({ count: set.size });
  }

  try {
    await ensureMovementFollowsTable();
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM movement_follows WHERE movement_id = $1', [
      String(id),
    ]);
    const count = countRes.rows?.[0]?.count ?? 0;
    return reply.send({ count });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to count movement followers');
    return reply.code(500).send({ error: 'Failed to count movement followers' });
  }
});

fastify.post('/movements/:id/follow', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({ following: z.boolean() });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid follow payload' });
  }

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const ownerEmail = await getMovementOwnerEmail(id);
  if (ownerEmail && (await areUsersBlockedEitherDirection(email, ownerEmail))) {
    return sendBlockedInteraction(reply);
  }

  const following = !!parsed.data.following;

  if (!hasDatabaseUrl) {
    const key = String(id);
    const set = memoryMovementFollows.get(key) || new Set();
    if (following) set.add(email);
    else set.delete(email);
    memoryMovementFollows.set(key, set);
    return reply.send({ following: set.has(email), followers_count: set.size });
  }

  try {
    await ensureMovementFollowsTable();
    if (following) {
      await pool.query(
        'INSERT INTO movement_follows (movement_id, follower_email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [String(id), String(email)]
      );
    } else {
      await pool.query('DELETE FROM movement_follows WHERE movement_id = $1 AND follower_email = $2', [
        String(id),
        String(email),
      ]);
    }
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM movement_follows WHERE movement_id = $1', [
      String(id),
    ]);
    const followers_count = countRes.rows?.[0]?.count ?? 0;
    return reply.send({ following, followers_count });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update follow state');
    return reply.code(500).send({ error: 'Failed to update follow state' });
  }
});

fastify.get('/me/followed-movements', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const myEmail = normalizeEmail(authedUser.email);
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });
  const viewerBlocks = await getUserBlockSets(myEmail);

  if (!hasDatabaseUrl) {
    const followedIds = new Set();
    for (const [movementId, set] of memoryMovementFollows.entries()) {
      if (set && set.has(myEmail)) followedIds.add(String(movementId));
    }
    const movements = memoryMovements.filter((m) => {
      if (!followedIds.has(String(m?.id))) return false;
      const authorEmail = normalizeEmail(m?.author_email || m?.creator_email || '');
      return !isBlockedForViewer(authorEmail, viewerBlocks);
    });
    return reply.send({ movements });
  }

  try {
    await ensureMovementFollowsTable();
    await ensureVotesTable();

    const result = await pool.query(
      `WITH followed AS (
         SELECT movement_id, created_at
         FROM movement_follows
         WHERE follower_email = $1
         ORDER BY created_at DESC
         LIMIT 100
       )
       SELECT
         m.*,
         COALESCE(v.upvotes, 0)::int AS upvotes,
         COALESCE(v.downvotes, 0)::int AS downvotes,
         (COALESCE(v.upvotes, 0) - COALESCE(v.downvotes, 0))::int AS score
       FROM followed f
       JOIN movements m ON m.id = f.movement_id
       LEFT JOIN (
         SELECT
           movement_id,
           COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
           COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
         FROM movement_votes
         GROUP BY movement_id
       ) v ON v.movement_id = m.id
       ORDER BY f.created_at DESC`,
      [myEmail]
    );

    const rows = Array.isArray(result.rows) ? result.rows : [];
    const filtered = rows.filter((m) => {
      const authorEmail = normalizeEmail(m?.author_email || m?.creator_email || '');
      return !isBlockedForViewer(authorEmail, viewerBlocks);
    });
    return reply.send({ movements: filtered });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load followed movements');
    return reply.code(500).send({ error: 'Failed to load followed movements' });
  }
});

fastify.get('/movements/:id/comment-settings', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  if (!hasDatabaseUrl) {
    const s = getMemoryCommentSettings(id);
    return reply.send({ locked: !!s.locked, slow_mode_seconds: s.slow_mode_seconds || 0 });
  }

  try {
    await ensureMovementCommentsTables();
    const res = await pool.query(
      'SELECT locked, slow_mode_seconds FROM movement_comment_settings WHERE movement_id = $1 LIMIT 1',
      [String(id)]
    );
    const row = res.rows?.[0] || null;
    return reply.send({
      locked: !!row?.locked,
      slow_mode_seconds: typeof row?.slow_mode_seconds === 'number' ? row.slow_mode_seconds : 0,
    });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load comment settings');
    return reply.code(500).send({ error: 'Failed to load comment settings' });
  }
});

fastify.patch('/movements/:id/comment-settings', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const ownerEmail = await getMovementOwnerEmail(id);
  const me = normalizeEmail(authedUser.email);
  const isOwner = !!(me && ownerEmail && me === ownerEmail);
  const isAdmin = !!(me && ADMIN_EMAILS.has(me));
  if (!isOwner && !isAdmin) {
    return reply.code(403).send({ error: 'Only the movement owner or an admin can update comment settings' });
  }

  const schema = z.object({
    locked: z.boolean().optional(),
    slow_mode_seconds: z.number().int().min(0).max(3600).optional(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid settings payload' });
  }

  const patch = parsed.data;

  if (!hasDatabaseUrl) {
    const next = setMemoryCommentSettings(id, patch);

    await logIncident({
      event_type: 'comment_settings_updated',
      actor_user_id: String(authedUser.id || ''),
      actor_email: String(authedUser.email || ''),
      movement_id: String(id),
      trigger_system: 'comment_settings',
      human_reviewed: true,
      related_entity_type: 'movement',
      related_entity_id: String(id),
      context: {
        locked: !!next.locked,
        slow_mode_seconds: next.slow_mode_seconds || 0,
      },
    });

    return reply.send({ locked: !!next.locked, slow_mode_seconds: next.slow_mode_seconds || 0 });
  }

  try {
    await ensureMovementCommentsTables();
    await pool.query(
      `INSERT INTO movement_comment_settings (movement_id, locked, slow_mode_seconds)
       VALUES ($1, $2, $3)
       ON CONFLICT (movement_id)
       DO UPDATE SET locked = EXCLUDED.locked, slow_mode_seconds = EXCLUDED.slow_mode_seconds, updated_at = NOW()`,
      [
        String(id),
        typeof patch.locked === 'boolean' ? patch.locked : false,
        typeof patch.slow_mode_seconds === 'number' ? patch.slow_mode_seconds : 0,
      ]
    );
    const res = await pool.query(
      'SELECT locked, slow_mode_seconds FROM movement_comment_settings WHERE movement_id = $1 LIMIT 1',
      [String(id)]
    );
    const row = res.rows?.[0] || null;

    await logIncident({
      event_type: 'comment_settings_updated',
      actor_user_id: String(authedUser.id || ''),
      actor_email: String(authedUser.email || ''),
      movement_id: String(id),
      trigger_system: 'comment_settings',
      human_reviewed: true,
      related_entity_type: 'movement',
      related_entity_id: String(id),
      context: {
        locked: !!row?.locked,
        slow_mode_seconds: row?.slow_mode_seconds ?? 0,
      },
    });

    return reply.send({ locked: !!row?.locked, slow_mode_seconds: row?.slow_mode_seconds ?? 0 });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update comment settings');
    return reply.code(500).send({ error: 'Failed to update comment settings' });
  }
});

fastify.get('/movements/:id/comments', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const viewerEmail = await getOptionalAuthedEmail(request);
  const viewerBlocks = viewerEmail ? await getUserBlockSets(viewerEmail) : null;
  const isVisibleComment = (comment) => {
    if (!viewerBlocks) return true;
    const authorEmail = normalizeEmail(comment?.author_email || '');
    return !isBlockedForViewer(authorEmail, viewerBlocks);
  };

  function parseIntParam(value, fallback, { min = 0, max = 200 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    return out;
  }

  const limit = parseIntParam(request.query?.limit, 100, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  function sortByCreatedDesc(a, b) {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  }

  if (!hasDatabaseUrl) {
    const list = memoryCommentsByMovement.get(String(id)) || [];
    const sorted = [...list].sort(sortByCreatedDesc);
    const page = sorted.filter(isVisibleComment).slice(offset, offset + limit);
    const emails = Array.from(new Set(page.map((c) => normalizeEmail(c?.author_email)).filter(Boolean)));
    const lookup = await getPublicProfilesByEmail(emails);
    const enriched = page.map((c) => {
      const email = normalizeEmail(c?.author_email || '');
      const profile = email ? lookup.get(email) : null;
      return { ...c, author_user_id: profile?.user_id ?? null };
    });
    return reply.send({ comments: enriched.map((c) => projectRecord(c, fields)) });
  }

  try {
    await ensureMovementCommentsTables();
    const res = await pool.query(
      'SELECT id, movement_id, author_email, content, created_at FROM movement_comments WHERE movement_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const filtered = rows.filter(isVisibleComment);
    const emails = Array.from(new Set(filtered.map((c) => normalizeEmail(c?.author_email)).filter(Boolean)));
    const lookup = await getPublicProfilesByEmail(emails);
    const enriched = filtered.map((c) => {
      const email = normalizeEmail(c?.author_email || '');
      const profile = email ? lookup.get(email) : null;
      return { ...c, author_user_id: profile?.user_id ?? null };
    });
    return reply.send({ comments: enriched.map((c) => projectRecord(c, fields)) });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load comments');
    return reply.code(500).send({ error: 'Failed to load comments' });
  }
});

fastify.get('/movements/:id/comments/count', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  if (!hasDatabaseUrl) {
    const list = memoryCommentsByMovement.get(String(id)) || [];
    return reply.send({ count: Array.isArray(list) ? list.length : 0 });
  }

  try {
    await ensureMovementCommentsTables();
    const res = await pool.query('SELECT COUNT(*)::int AS count FROM movement_comments WHERE movement_id = $1', [String(id)]);
    const count = res.rows?.[0]?.count ?? 0;
    return reply.send({ count });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to count comments');
    return reply.code(500).send({ error: 'Failed to count comments' });
  }
});

fastify.post('/movements/:id/comments', { config: { rateLimit: RATE_LIMITS.commentCreate } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({ content: z.string().min(1).max(2000) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid comment payload' });
  }

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });
  const blockSets = await getUserBlockSets(email);
  const ownerEmail = await getMovementOwnerEmail(id);
  if (ownerEmail && isBlockedForViewer(ownerEmail, blockSets)) {
    return sendBlockedInteraction(reply);
  }

  const content = cleanText(parsed.data.content);
  const authorUserId = authedUser?.id ? String(authedUser.id) : null;

  if (!hasDatabaseUrl) {
    const settings = getMemoryCommentSettings(id);
    if (settings.locked) {
      await logIncident({
        event_type: 'comment_rejected_locked',
        actor_user_id: String(authedUser.id || ''),
        actor_email: String(authedUser.email || ''),
        movement_id: String(id),
        trigger_system: 'comment_protection',
        human_reviewed: false,
        related_entity_type: 'movement',
        related_entity_id: String(id),
        context: { locked: true },
      });
      return reply.code(403).send({ error: 'Comments are locked for this movement' });
    }

    const list = memoryCommentsByMovement.get(String(id)) || [];
    if (settings.slow_mode_seconds > 0) {
      const last = list.find((c) => normalizeEmail(c?.author_email) === email) || null;
      if (last?.created_at) {
        const lastMs = new Date(last.created_at).getTime();
        const nowMs = Date.now();
        const minDelta = settings.slow_mode_seconds * 1000;
        if (Number.isFinite(lastMs) && nowMs - lastMs < minDelta) {
          await logIncident({
            event_type: 'comment_rejected_slow_mode',
            actor_user_id: String(authedUser.id || ''),
            actor_email: String(authedUser.email || ''),
            movement_id: String(id),
            trigger_system: 'comment_protection',
            human_reviewed: false,
            related_entity_type: 'movement',
            related_entity_id: String(id),
            context: { slow_mode_seconds: settings.slow_mode_seconds },
          });
          return reply.code(429).send({ error: `Slow mode is enabled. Please wait ${settings.slow_mode_seconds}s between comments.` });
        }
      }
    }

    const comment = {
      id: randomUUID(),
      movement_id: String(id),
      author_email: email,
      author_user_id: authorUserId,
      content,
      created_at: nowIso(),
    };
    list.unshift(comment);
    memoryCommentsByMovement.set(String(id), list);
    return reply.code(201).send({ comment });
  }

  try {
    await ensureMovementCommentsTables();
    const settingsRes = await pool.query(
      'SELECT locked, slow_mode_seconds FROM movement_comment_settings WHERE movement_id = $1 LIMIT 1',
      [String(id)]
    );
    const settingsRow = settingsRes.rows?.[0] || null;
    const locked = !!settingsRow?.locked;
    const slowMode = typeof settingsRow?.slow_mode_seconds === 'number' ? settingsRow.slow_mode_seconds : 0;

    if (locked) {
      await logIncident({
        event_type: 'comment_rejected_locked',
        actor_user_id: String(authedUser.id || ''),
        actor_email: String(authedUser.email || ''),
        movement_id: String(id),
        trigger_system: 'comment_protection',
        human_reviewed: false,
        related_entity_type: 'movement',
        related_entity_id: String(id),
        context: { locked: true },
      });
      return reply.code(403).send({ error: 'Comments are locked for this movement' });
    }

    if (slowMode > 0) {
      const lastRes = await pool.query(
        'SELECT created_at FROM movement_comments WHERE movement_id = $1 AND author_email = $2 ORDER BY created_at DESC LIMIT 1',
        [String(id), String(email)]
      );
      const lastAt = lastRes.rows?.[0]?.created_at || null;
      if (lastAt) {
        const lastMs = new Date(lastAt).getTime();
        const nowMs = Date.now();
        const minDelta = slowMode * 1000;
        if (Number.isFinite(lastMs) && nowMs - lastMs < minDelta) {
          await logIncident({
            event_type: 'comment_rejected_slow_mode',
            actor_user_id: String(authedUser.id || ''),
            actor_email: String(authedUser.email || ''),
            movement_id: String(id),
            trigger_system: 'comment_protection',
            human_reviewed: false,
            related_entity_type: 'movement',
            related_entity_id: String(id),
            context: { slow_mode_seconds: slowMode },
          });
          return reply.code(429).send({ error: `Slow mode is enabled. Please wait ${slowMode}s between comments.` });
        }
      }
    }

    const comment = {
      id: randomUUID(),
      movement_id: String(id),
      author_email: String(email),
      content,
    };
    const insertRes = await pool.query(
      'INSERT INTO movement_comments (id, movement_id, author_email, content) VALUES ($1, $2, $3, $4) RETURNING id, movement_id, author_email, content, created_at',
      [comment.id, comment.movement_id, comment.author_email, comment.content]
    );
    const created = insertRes.rows?.[0] || comment;
    return reply.code(201).send({ comment: { ...created, author_user_id: authorUserId } });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to post comment');
    return reply.code(500).send({ error: 'Failed to post comment' });
  }
});

fastify.get('/movements/:id/resources', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  function parseIntParam(value, fallback, { min = 0, max = 200 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        out[key] = record[key];
        continue;
      }
      if (key === 'created_date' && record?.created_at && out.created_date == null) {
        out.created_date = record.created_at;
      }
    }
    return out;
  }

  const limit = parseIntParam(request.query?.limit, 200, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  function sortByCreatedDesc(a, b) {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  }

  if (!hasDatabaseUrl) {
    const list = memoryListExtras(memoryMovementResourcesByMovement, id).sort(sortByCreatedDesc);
    const page = list.slice(offset, offset + limit);
    return reply.send({ resources: page.map((r) => projectRecord(r, fields)) });
  }

  try {
    await ensureMovementExtrasTables();
    const res = await pool.query(
      'SELECT * FROM movement_resources WHERE movement_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    return reply.send({ resources: rows.map((r) => projectRecord(r, fields)) });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load movement resources');
    return reply.code(500).send({ error: 'Failed to load resources' });
  }
});

fastify.post('/movements/:id/resources', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z
    .object({
      title: z.string().min(1).max(120),
      url: z.string().url().max(700).optional(),
      // file_url can be an absolute URL or a server-relative /uploads/... path
      file_url: z.string().max(800).optional(),
      file_name: z.string().max(260).optional(),
      mime_type: z.string().max(120).optional(),
      file_size: z.number().int().min(1).max(50 * 1024 * 1024).optional(),
      category: z.string().max(48).optional(),
      description: z.string().max(1000).optional(),
    })
    .refine((v) => {
      const hasUrl = !!v.url;
      const hasDesc = !!v.description;
      const hasFile = !!v.file_url;
      return hasUrl || hasDesc || hasFile;
    }, { message: 'Provide a URL, an upload, or a description' })
    .refine((v) => {
      if (!v.file_url) return true;
      const s = String(v.file_url).trim();
      if (!s) return true;
      if (s.startsWith('/uploads/')) return true;
      return /^https?:\/\//i.test(s);
    }, { message: 'file_url must be a valid URL or /uploads/ path' });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const row = {
    id: randomUUID(),
    movement_id: String(id),
    title: cleanText(parsed.data.title),
    url: parsed.data.url ? String(parsed.data.url).trim() : null,
    file_url: parsed.data.file_url ? String(parsed.data.file_url).trim() : null,
    file_name: parsed.data.file_name ? cleanText(parsed.data.file_name) : null,
    mime_type: parsed.data.mime_type ? cleanText(parsed.data.mime_type) : null,
    file_size: typeof parsed.data.file_size === 'number' ? parsed.data.file_size : null,
    category: parsed.data.category ? cleanText(parsed.data.category) : null,
    download_count: 0,
    description: parsed.data.description ? cleanText(parsed.data.description) : null,
    created_by_email: email,
    created_at: nowIso(),
  };

  if (!hasDatabaseUrl) {
    return reply.code(201).send({ resource: memoryAppendExtra(memoryMovementResourcesByMovement, id, row) });
  }

  try {
    await ensureMovementExtrasTables();
    const inserted = await pool.query(
      `INSERT INTO movement_resources (id, movement_id, title, url, file_url, file_name, mime_type, file_size, category, download_count, description, created_by_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        row.id,
        row.movement_id,
        row.title,
        row.url,
        row.file_url,
        row.file_name,
        row.mime_type,
        row.file_size,
        row.category,
        row.download_count,
        row.description,
        row.created_by_email,
      ]
    );
    return reply.code(201).send({ resource: inserted.rows?.[0] || row });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create movement resource');
    return reply.code(500).send({ error: 'Failed to add resource' });
  }
});

fastify.post('/resources/:id/download', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const resourceId = request.params?.id ? String(request.params.id) : null;
  if (!resourceId) return reply.code(400).send({ error: 'Resource id is required' });

  if (!hasDatabaseUrl) {
    const existing = findMemoryResourceById(resourceId);
    if (!existing) return reply.code(404).send({ error: 'Resource not found' });
    const nextCount = Math.max(0, Number(existing.download_count || 0)) + 1;
    const updated = memoryUpdateResourceById(resourceId, { download_count: nextCount });
    return reply.send({ resource: updated || { ...existing, download_count: nextCount } });
  }

  try {
    await ensureMovementExtrasTables();
    const updated = await pool.query(
      `UPDATE movement_resources
       SET download_count = COALESCE(download_count, 0) + 1
       WHERE id = $1
       RETURNING *`,
      [String(resourceId)]
    );
    const row = updated.rows?.[0] || null;
    if (!row) return reply.code(404).send({ error: 'Resource not found' });
    return reply.send({ resource: row });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to increment resource download');
    return reply.code(500).send({ error: 'Failed to record download' });
  }
});

fastify.delete('/resources/:id', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const resourceId = request.params?.id ? String(request.params.id) : null;
  if (!resourceId) return reply.code(400).send({ error: 'Resource id is required' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const isAdmin = ADMIN_EMAILS.has(String(email).toLowerCase());

  if (!hasDatabaseUrl) {
    const existing = findMemoryResourceById(resourceId);
    if (!existing) return reply.code(404).send({ error: 'Resource not found' });
    const owner = normalizeEmail(existing.created_by_email);
    const movementId = existing.movement_id ? String(existing.movement_id) : null;
    const movementOwner = movementId ? await getMovementOwnerEmail(movementId) : null;
    const isOwner = movementOwner && movementOwner === email;
    const trustScore = await getUserTrustScore(email);
    if (!isOwner && !isAdmin && trustScore < TRUST_SCORE_THRESHOLD) {
      await logCollaboratorAction({
        movement_id: movementId || 'unknown',
        actor_user_id: authedUser.id || authedUser.email,
        action_type: 'blocked_action',
        target_id: resourceId,
        metadata: { reason: 'low_trust_delete_resource', trustScore }
      });
      return reply.code(403).send({ error: 'This action requires a higher trust level or owner approval.' });
    }
    if (!isAdmin && owner !== email && !isOwner) return reply.code(403).send({ error: 'Not allowed' });
    memoryDeleteResourceById(resourceId);
    await logCollaboratorAction({
      movement_id: movementId || 'unknown',
      actor_user_id: authedUser.id || authedUser.email,
      action_type: 'delete_resource',
      target_id: resourceId,
      metadata: null
    });
    return reply.send({ ok: true });
  }

  try {
    await ensureMovementExtrasTables();
    const existingRes = await pool.query('SELECT id, movement_id, created_by_email FROM movement_resources WHERE id = $1 LIMIT 1', [String(resourceId)]);
    const existing = existingRes.rows?.[0] || null;
    if (!existing) return reply.code(404).send({ error: 'Resource not found' });

    const owner = normalizeEmail(existing.created_by_email);
    const movementId = existing.movement_id ? String(existing.movement_id) : null;
    const movementOwner = movementId ? await getMovementOwnerEmail(movementId) : null;
    const isOwner = movementOwner && movementOwner === email;
    const trustScore = await getUserTrustScore(email);
    if (!isOwner && !isAdmin && trustScore < TRUST_SCORE_THRESHOLD) {
      await logCollaboratorAction({
        movement_id: movementId || 'unknown',
        actor_user_id: authedUser.id || authedUser.email,
        action_type: 'blocked_action',
        target_id: resourceId,
        metadata: { reason: 'low_trust_delete_resource', trustScore }
      });
      return reply.code(403).send({ error: 'This action requires a higher trust level or owner approval.' });
    }
    if (!isAdmin && owner !== email && !isOwner) return reply.code(403).send({ error: 'Not allowed' });

    await pool.query('DELETE FROM movement_resources WHERE id = $1', [String(resourceId)]);
    await logCollaboratorAction({
      movement_id: movementId || 'unknown',
      actor_user_id: authedUser.id || authedUser.email,
      action_type: 'delete_resource',
      target_id: resourceId,
      metadata: null
    });
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to delete resource');
    return reply.code(500).send({ error: 'Failed to delete resource' });
  }
});

fastify.get('/movements/:id/evidence', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  function parseIntParam(value, fallback, { min = 0, max = 200 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    return out;
  }

  const allowedStatuses = new Set(['approved', 'pending', 'rejected', 'all']);
  const requestedStatus = request.query?.status ? String(request.query.status).toLowerCase() : 'approved';
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : 'approved';

  const limit = parseIntParam(request.query?.limit, 20, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  let requesterEmail = null;
  let isReviewer = false;
  if (status !== 'approved') {
    const authedUser = await requireVerifiedUser(request, reply);
    if (!authedUser) return;
    requesterEmail = normalizeEmail(authedUser.email);
  } else {
    requesterEmail = await tryGetUserEmailFromRequest(request);
  }

  if (requesterEmail) {
    const ownerEmail = await getMovementOwnerEmail(id);
    const isAdmin = !!(requesterEmail && ADMIN_EMAILS.has(requesterEmail));
    const collaboratorRole = await getMovementCollaboratorRole(id, requesterEmail);
    const canReviewRole = collaboratorRole === 'admin' || collaboratorRole === 'editor';
    isReviewer = !!(ownerEmail && requesterEmail === ownerEmail) || isAdmin || canReviewRole;
  }

  if (status !== 'approved' && !isReviewer) {
    return reply.code(403).send({ error: 'Not allowed' });
  }

  function sortByCreatedDesc(a, b) {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  }

  function stripSensitive(record) {
    if (!record || typeof record !== 'object') return record;
    const { submitter_email, verified_by_email, ...rest } = record;
    return rest;
  }

  if (!hasDatabaseUrl) {
    const list = memoryListExtras(memoryMovementEvidenceByMovement, id).sort(sortByCreatedDesc);
    const filtered = status === 'all' ? list : list.filter((e) => String(e?.status || 'pending') === status);
    const page = filtered.slice(offset, offset + limit).map((e) => projectRecord(e, fields));
    const emails = Array.from(new Set(page.map((e) => normalizeEmail(e?.submitter_email)).filter(Boolean)));
    const lookup = await getPublicProfilesByEmail(emails);
    const withIds = page.map((e) => {
      const email = normalizeEmail(e?.submitter_email || '');
      const profile = email ? lookup.get(email) : null;
      return { ...e, submitter_user_id: profile?.user_id ?? null };
    });
    const safe = status === 'approved' && !isReviewer ? withIds.map(stripSensitive) : withIds;
    return reply.send({ evidence: safe });
  }

  try {
    await ensureMovementEvidenceTable();
    const values = [String(id)];
    let where = 'movement_id = $1';
    if (status !== 'all') {
      values.push(status);
      where += ` AND status = $${values.length}`;
    }
    values.push(limit, offset);
    const limitIdx = values.length - 1;
    const offsetIdx = values.length;
    const res = await pool.query(
      `SELECT *
       FROM movement_evidence
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const projected = rows.map((e) => projectRecord(e, fields));
    const emails = Array.from(new Set(projected.map((e) => normalizeEmail(e?.submitter_email)).filter(Boolean)));
    const lookup = await getPublicProfilesByEmail(emails);
    const withIds = projected.map((e) => {
      const email = normalizeEmail(e?.submitter_email || '');
      const profile = email ? lookup.get(email) : null;
      return { ...e, submitter_user_id: profile?.user_id ?? null };
    });
    const safe = status === 'approved' && !isReviewer ? withIds.map(stripSensitive) : withIds;
    return reply.send({ evidence: safe });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load movement evidence');
    return reply.code(500).send({ error: 'Failed to load evidence' });
  }
});

fastify.post('/movements/:id/evidence', { config: { rateLimit: RATE_LIMITS.evidenceSubmit } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z
    .object({
      media_type: z.enum(['image', 'link', 'video', 'text']),
      url: z.string().max(800).optional().nullable(),
      text: z.string().max(1200).optional().nullable(),
      caption: z.string().max(500).optional().nullable(),
      file_name: z.string().max(260).optional().nullable(),
      mime_type: z.string().max(120).optional().nullable(),
      file_size: z.number().int().min(1).max(MAX_UPLOAD_BYTES).optional().nullable(),
    })
    .refine((v) => {
      if (v.media_type === 'text') return !!(v.text && String(v.text).trim());
      return !!(v.url && String(v.url).trim());
    }, { message: 'Evidence content is required' });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const submitterUserId = authedUser?.id ? String(authedUser.id) : null;

  const mediaType = String(parsed.data.media_type);
  const rawUrl = parsed.data.url ? String(parsed.data.url).trim() : '';
  const rawText = parsed.data.text ? String(parsed.data.text).trim() : '';

  function normalizeEvidenceUrl(value) {
    const v = String(value || '').trim();
    if (!v) return null;
    if (v.startsWith('/uploads/')) return v;
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.toString();
    } catch {
      return null;
    }
  }

  const url = rawUrl ? normalizeEvidenceUrl(rawUrl) : null;
  if (mediaType !== 'text' && !url) {
    return reply.code(400).send({ error: 'Evidence URL must be http(s) or /uploads/ path' });
  }
  if (mediaType === 'text' && !rawText) {
    return reply.code(400).send({ error: 'Evidence text is required' });
  }

  const mime = parsed.data.mime_type ? String(parsed.data.mime_type).trim().toLowerCase() : null;
  const allowedImageMimes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif']);

  if (mediaType === 'image') {
    if (mime && !allowedImageMimes.has(mime)) {
      return reply.code(415).send({ error: 'Unsupported image type' });
    }
  } else if (mediaType !== 'text') {
    if (url.startsWith('/uploads/')) {
      return reply.code(400).send({ error: 'Uploads are only allowed for image evidence' });
    }
  }

  const ownerEmail = await getMovementOwnerEmail(id);
  const isOwner = !!(ownerEmail && email === ownerEmail);
  if (ownerEmail && (await areUsersBlockedEitherDirection(email, ownerEmail))) {
    return sendBlockedInteraction(reply);
  }
  const now = nowIso();

  const row = {
    id: randomUUID(),
    movement_id: String(id),
    submitter_email: email,
    status: isOwner ? 'approved' : 'pending',
    media_type: mediaType,
    url: mediaType === 'text' ? null : url,
    text: mediaType === 'text' ? cleanText(rawText, 1200) : null,
    caption: parsed.data.caption ? cleanText(parsed.data.caption, 500) : null,
    file_name: parsed.data.file_name ? cleanText(parsed.data.file_name, 260) : null,
    mime_type: mime || null,
    file_size: typeof parsed.data.file_size === 'number' ? parsed.data.file_size : null,
    verified_by_email: isOwner ? email : null,
    verified_at: isOwner ? now : null,
    created_at: now,
    updated_at: now,
  };

  if (!hasDatabaseUrl) {
    const saved = memoryAppendExtra(memoryMovementEvidenceByMovement, id, row);
    if (String(saved?.status || '') === 'approved') {
      updateMemoryMovementVerifiedParticipants(id);
    }
    return reply.code(201).send({ evidence: { ...saved, submitter_user_id: submitterUserId } });
  }

  try {
    await ensureMovementEvidenceTable();
    const inserted = await pool.query(
      `INSERT INTO movement_evidence (id, movement_id, submitter_email, status, media_type, url, text, caption, file_name, mime_type, file_size, verified_by_email, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        row.id,
        row.movement_id,
        row.submitter_email,
        row.status,
        row.media_type,
        row.url,
        row.text,
        row.caption,
        row.file_name,
        row.mime_type,
        row.file_size,
        row.verified_by_email,
        row.verified_at,
      ]
    );
    const evidence = inserted.rows?.[0] || row;
    if (String(evidence?.status || '') === 'approved') {
      await updateMovementVerifiedParticipants(id);
    }
    return reply.code(201).send({ evidence: { ...evidence, submitter_user_id: submitterUserId } });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to submit movement evidence');
    return reply.code(500).send({ error: 'Failed to submit evidence' });
  }
});

fastify.post('/movements/:id/evidence/:evidenceId/verify', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const movementId = request.params?.id ? String(request.params.id) : null;
  const evidenceId = request.params?.evidenceId ? String(request.params.evidenceId) : null;
  if (!movementId) return reply.code(400).send({ error: 'Movement id is required' });
  if (!evidenceId) return reply.code(400).send({ error: 'Evidence id is required' });

  const schema = z.object({ status: z.enum(['approved', 'rejected']) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const verifierUserId = authedUser?.id ? String(authedUser.id) : null;

  const ownerEmail = await getMovementOwnerEmail(movementId);
  const isAdmin = !!(email && ADMIN_EMAILS.has(email));
  const collaboratorRole = await getMovementCollaboratorRole(movementId, email);
  const canReviewRole = collaboratorRole === 'admin' || collaboratorRole === 'editor';
  if (!ownerEmail || (!isAdmin && ownerEmail !== email && !canReviewRole)) {
    return reply.code(403).send({ error: 'Only the movement owner or team can verify evidence' });
  }

  const status = parsed.data.status;
  const now = nowIso();

  if (!hasDatabaseUrl) {
    const existing = findMemoryEvidenceById(evidenceId);
    if (!existing) return reply.code(404).send({ error: 'Evidence not found' });
    if (String(existing.movement_id) !== String(movementId)) {
      return reply.code(404).send({ error: 'Evidence not found' });
    }
    if (!isAdmin && (await areUsersBlockedEitherDirection(email, existing?.submitter_email))) {
      return sendBlockedInteraction(reply);
    }
    const updated = memoryUpdateEvidenceById(evidenceId, {
      status,
      verified_by_email: email,
      verified_at: now,
      updated_at: now,
    });
    updateMemoryMovementVerifiedParticipants(movementId);
    const row = updated || { id: evidenceId };
    return reply.send({ evidence: { ...row, verified_by_user_id: verifierUserId } });
  }

  try {
    await ensureMovementEvidenceTable();

    const existingRes = await pool.query(
      'SELECT submitter_email FROM movement_evidence WHERE id = $1 AND movement_id = $2 LIMIT 1',
      [String(evidenceId), String(movementId)]
    );
    const submitterEmail = existingRes.rows?.[0]?.submitter_email ? normalizeEmail(existingRes.rows[0].submitter_email) : null;
    if (!submitterEmail) return reply.code(404).send({ error: 'Evidence not found' });
    if (!isAdmin && (await areUsersBlockedEitherDirection(email, submitterEmail))) {
      return sendBlockedInteraction(reply);
    }

    const updated = await pool.query(
      `UPDATE movement_evidence
       SET status = $2,
           verified_by_email = $3,
           verified_at = $4,
           updated_at = NOW()
       WHERE id = $1 AND movement_id = $5
       RETURNING *`,
      [String(evidenceId), status, email, now, String(movementId)]
    );
    const row = updated.rows?.[0] || null;
    if (!row) return reply.code(404).send({ error: 'Evidence not found' });
    await updateMovementVerifiedParticipants(movementId);
    return reply.send({ evidence: { ...row, verified_by_user_id: verifierUserId } });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to verify movement evidence');
    return reply.code(500).send({ error: 'Failed to verify evidence' });
  }
});

// Create a movement author group chat with verified participants only.
fastify.post('/movements/:id/group-chat', { config: { rateLimit: RATE_LIMITS.conversationCreate } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const movementId = request.params?.id ? String(request.params.id) : null;
  if (!movementId) return reply.code(400).send({ error: 'Movement id is required' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const schema = z.object({
    participant_emails: z.array(z.string().email()).max(20).optional().nullable(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const ownerEmail = await getMovementOwnerEmail(movementId);
  if (!ownerEmail) return reply.code(404).send({ error: 'Movement not found' });

  const owner = normalizeEmail(ownerEmail);
  if (email !== owner) {
    return reply.code(403).send({ error: 'Only the movement owner can create this group chat' });
  }

  const verifiedEmails = await listVerifiedParticipantEmails(movementId);
  const verifiedSet = new Set(verifiedEmails);
  if (!verifiedSet.size) {
    return reply.code(400).send({ error: 'No verified participants yet' });
  }

  const eligibleEmails = await filterMovementGroupOptOut(verifiedEmails);
  const eligibleSet = new Set(eligibleEmails);
  if (!eligibleSet.size) {
    return reply.code(400).send({ error: 'All verified participants opted out of movement group chats' });
  }

  const requested = Array.isArray(parsed.data.participant_emails)
    ? parsed.data.participant_emails.map((e) => normalizeEmail(e)).filter(Boolean)
    : eligibleEmails;

  const invalid = requested.filter((e) => !verifiedSet.has(e));
  const optedOut = requested.filter((e) => verifiedSet.has(e) && !eligibleSet.has(e));
  if (invalid.length || optedOut.length) {
    return reply.code(400).send({
      error: 'Some participants cannot be added',
      invalid,
      opted_out: optedOut,
    });
  }

  const participantSet = new Set([owner, ...requested]);
  const participants = Array.from(participantSet).sort();

  if (participants.length > MAX_GROUP_PARTICIPANTS) {
    return reply.code(400).send({ error: `Group chat is limited to ${MAX_GROUP_PARTICIPANTS} participants` });
  }
  if (participants.length < 2) {
    return reply.code(400).send({ error: 'At least one verified participant is required' });
  }

  const groupType = 'movement_verified';
  const movementTitle = await getMovementTitle(movementId);
  const groupName = movementTitle
    ? `Movement: ${cleanText(movementTitle, MAX_TEXT_LENGTHS.movementTitle)}`
    : 'Verified participants group';

  if (!hasDatabaseUrl) {
    const existing = memoryFindGroupConversation(movementId, groupType);
    if (existing) return reply.send(existing);

    const missing = participants.filter((p) => !memoryPublicKeys.get(p));
    if (missing.length) {
      return reply.code(409).send({ error: 'Missing public keys', missing });
    }

    const created = memoryCreateGroupConversation({
      participant_emails: participants,
      group_name: groupName,
      group_type: groupType,
      movement_id: movementId,
      created_by_email: email,
      group_admin_emails: [email],
      group_post_mode: 'owner_only',
      group_posters: [],
    });
    if (!created) return reply.code(500).send({ error: 'Failed to create group chat' });
    return reply.code(201).send(created);
  }

  try {
    await ensureMessagesTables();
    const existing = await pool.query(
      `SELECT *
       FROM conversations
       WHERE is_group = TRUE AND movement_id = $1 AND group_type = $2
       LIMIT 1`,
      [String(movementId), groupType]
    );
    if (existing.rows?.[0]) return reply.send(existing.rows[0]);

    await ensurePublicKeysTable();
    const keyRes = await pool.query(
      'SELECT email FROM user_public_keys WHERE email = ANY($1::text[])',
      [participants]
    );
    const found = new Set((keyRes.rows || []).map((r) => normalizeEmail(r?.email)));
    const missing = participants.filter((p) => !found.has(p));
    if (missing.length) {
      return reply.code(409).send({ error: 'Missing public keys', missing });
    }

    const id = randomUUID();
    const created = await pool.query(
      `INSERT INTO conversations
       (id, participant_emails, is_request, requester_email, request_status, is_group, group_name, group_type, movement_id, created_by_email, group_admin_emails, group_post_mode, group_posters)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        id,
        participants,
        false,
        null,
        'accepted',
        true,
        groupName,
        groupType,
        String(movementId),
        email,
        [email],
        'owner_only',
        [],
      ]
    );
    return reply.code(201).send(created.rows?.[0] ?? { id });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create group chat');
    return reply.code(500).send({ error: 'Failed to create group chat' });
  }
});

fastify.get('/movements/:id/events', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  function parseIntParam(value, fallback, { min = 0, max = 500 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    return out;
  }

  const limit = parseIntParam(request.query?.limit, 200, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  if (!hasDatabaseUrl) {
    const all = memoryListExtras(memoryMovementEventsByMovement, id).slice(0, 10000);
    const page = all.slice(offset, offset + limit);
    return reply.send({ events: page.map((e) => projectRecord(e, fields)) });
  }

  try {
    await ensureMovementExtrasTables();
    const res = await pool.query(
      'SELECT * FROM movement_events WHERE movement_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    return reply.send({ events: rows.map((e) => projectRecord(e, fields)) });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load movement events');
    return reply.code(500).send({ error: 'Failed to load events' });
  }
});

fastify.post('/movements/:id/events', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({
    title: z.string().min(1).max(120),
    starts_at: z.string().datetime().optional(),
    location: z.string().max(160).optional(),
    url: z.string().url().max(500).optional(),
    virtual_link: z.string().url().max(500).optional(),
    max_attendees: z.number().int().min(1).max(1000000).optional(),
    description: z.string().max(1000).optional(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const row = {
    id: randomUUID(),
    movement_id: String(id),
    title: cleanText(parsed.data.title),
    starts_at: parsed.data.starts_at ? String(parsed.data.starts_at) : null,
    location: parsed.data.location ? cleanText(parsed.data.location) : null,
    url: parsed.data.url ? String(parsed.data.url).trim() : null,
    virtual_link: parsed.data.virtual_link ? String(parsed.data.virtual_link).trim() : null,
    max_attendees: typeof parsed.data.max_attendees === 'number' ? parsed.data.max_attendees : null,
    description: parsed.data.description ? cleanText(parsed.data.description) : null,
    created_by_email: email,
    created_at: nowIso(),
  };

  if (!hasDatabaseUrl) {
    return reply.code(201).send({ event: memoryAppendExtra(memoryMovementEventsByMovement, id, row) });
  }

  try {
    await ensureMovementExtrasTables();
    const inserted = await pool.query(
      `INSERT INTO movement_events (id, movement_id, title, starts_at, location, url, virtual_link, max_attendees, description, created_by_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        row.id,
        row.movement_id,
        row.title,
        row.starts_at,
        row.location,
        row.url,
        row.virtual_link,
        row.max_attendees,
        row.description,
        row.created_by_email,
      ]
    );
    return reply.code(201).send({ event: inserted.rows?.[0] || row });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create movement event');
    return reply.code(500).send({ error: 'Failed to create event' });
  }
});

fastify.get('/events/:id/rsvps', async (request, reply) => {
  const eventId = request.params?.id ? String(request.params.id) : null;
  if (!eventId) return reply.code(400).send({ error: 'Event id is required' });

  const myEmail = await tryGetUserEmailFromRequest(request);

  if (!hasDatabaseUrl) {
    const summary = memoryGetEventRsvpSummary(eventId);
    const my_rsvp = myEmail ? memoryGetEventRsvp(eventId, myEmail) : null;
    return reply.send({ summary, my_rsvp });
  }

  try {
    await ensureMovementExtrasTables();
    const summaryRes = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'going' THEN 1 ELSE 0 END), 0)::int AS going_count,
        COALESCE(SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END), 0)::int AS interested_count,
        COALESCE(SUM(CASE WHEN attended THEN 1 ELSE 0 END), 0)::int AS attended_count
       FROM movement_event_rsvps
       WHERE event_id = $1`,
      [String(eventId)]
    );

    let my_rsvp = null;
    if (myEmail) {
      const myRes = await pool.query(
        'SELECT * FROM movement_event_rsvps WHERE event_id = $1 AND user_email = $2 LIMIT 1',
        [String(eventId), String(myEmail)]
      );
      my_rsvp = myRes.rows?.[0] || null;
    }

    const summary = summaryRes.rows?.[0] || { going_count: 0, interested_count: 0, attended_count: 0 };
    return reply.send({ summary, my_rsvp });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load event RSVPs');
    return reply.code(500).send({ error: 'Failed to load RSVPs' });
  }
});

fastify.post('/events/:id/rsvp', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const eventId = request.params?.id ? String(request.params.id) : null;
  if (!eventId) return reply.code(400).send({ error: 'Event id is required' });

  const schema = z.object({
    status: z.enum(['going', 'interested', 'cancel']),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  if (!hasDatabaseUrl) {
    const ev = findMemoryEventById(eventId);
    if (!ev) return reply.code(404).send({ error: 'Event not found' });

    if (parsed.data.status === 'cancel') {
      memoryDeleteEventRsvp(eventId, email);
      return reply.send({ rsvp: null });
    }

    const rsvp = memoryUpsertEventRsvp(eventId, email, {
      movement_id: String(ev.movement_id),
      status: parsed.data.status,
      attended: false,
    });
    return reply.send({ rsvp });
  }

  try {
    await ensureMovementExtrasTables();
    const evRes = await pool.query('SELECT id, movement_id FROM movement_events WHERE id = $1 LIMIT 1', [String(eventId)]);
    const ev = evRes.rows?.[0];
    if (!ev) return reply.code(404).send({ error: 'Event not found' });

    if (parsed.data.status === 'cancel') {
      await pool.query('DELETE FROM movement_event_rsvps WHERE event_id = $1 AND user_email = $2', [String(eventId), email]);
      return reply.send({ rsvp: null });
    }

    const id = randomUUID();
    const upsert = await pool.query(
      `INSERT INTO movement_event_rsvps (id, movement_id, event_id, user_email, status, attended)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       ON CONFLICT (event_id, user_email)
       DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
       RETURNING *`,
      [id, String(ev.movement_id), String(eventId), email, parsed.data.status]
    );
    return reply.send({ rsvp: upsert.rows?.[0] || null });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to set event RSVP');
    return reply.code(500).send({ error: 'Failed to set RSVP' });
  }
});

fastify.post('/events/:id/attendance', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const eventId = request.params?.id ? String(request.params.id) : null;
  if (!eventId) return reply.code(400).send({ error: 'Event id is required' });

  const schema = z.object({
    attended: z.boolean(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  if (!hasDatabaseUrl) {
    const existing = memoryGetEventRsvp(eventId, email);
    if (!existing) return reply.code(400).send({ error: 'RSVP required to mark attendance' });
    const rsvp = memoryUpsertEventRsvp(eventId, email, { attended: parsed.data.attended });
    return reply.send({ rsvp });
  }

  try {
    await ensureMovementExtrasTables();
    const exists = await pool.query(
      'SELECT id FROM movement_event_rsvps WHERE event_id = $1 AND user_email = $2 LIMIT 1',
      [String(eventId), email]
    );
    if (!exists.rows?.[0]?.id) return reply.code(400).send({ error: 'RSVP required to mark attendance' });

    const updated = await pool.query(
      `UPDATE movement_event_rsvps
       SET attended = $3, updated_at = NOW()
       WHERE event_id = $1 AND user_email = $2
       RETURNING *`,
      [String(eventId), email, parsed.data.attended]
    );
    return reply.send({ rsvp: updated.rows?.[0] || null });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update event attendance');
    return reply.code(500).send({ error: 'Failed to update attendance' });
  }
});

fastify.get('/movements/:id/petitions', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  function parseIntParam(value, fallback, { min = 0, max = 500 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    return out;
  }

  const limit = parseIntParam(request.query?.limit, 200, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  if (!hasDatabaseUrl) {
    const all = memoryListExtras(memoryMovementPetitionsByMovement, id).slice(0, 10000);
    const page = all.slice(offset, offset + limit);
    return reply.send({ petitions: page.map((p) => projectRecord(p, fields)) });
  }

  try {
    await ensureMovementExtrasTables();
    const res = await pool.query(
      'SELECT * FROM movement_petitions WHERE movement_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    return reply.send({ petitions: rows.map((p) => projectRecord(p, fields)) });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load movement petitions');
    return reply.code(500).send({ error: 'Failed to load petitions' });
  }
});

fastify.post('/movements/:id/petitions', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({
    title: z.string().min(1).max(120),
    url: z.string().url().max(500),
    goal_signatures: z.number().int().min(1).max(100000000).optional(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const row = {
    id: randomUUID(),
    movement_id: String(id),
    title: cleanText(parsed.data.title),
    url: String(parsed.data.url).trim(),
    goal_signatures: typeof parsed.data.goal_signatures === 'number' ? parsed.data.goal_signatures : null,
    created_by_email: email,
    created_at: nowIso(),
  };

  if (!hasDatabaseUrl) {
    const created = memoryAppendExtra(memoryMovementPetitionsByMovement, id, row);
    fastify.log.info(
      {
        event: 'petition_created',
        petition_id: String(created?.id || row.id),
        movement_id: String(id),
        actor_id: String(authedUser.id || ''),
        storage: 'memory',
      },
      'Petition created'
    );
    return reply.code(201).send({ petition: created });
  }

  try {
    await ensureMovementExtrasTables();
    const inserted = await pool.query(
      `INSERT INTO movement_petitions (id, movement_id, title, url, goal_signatures, created_by_email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [row.id, row.movement_id, row.title, row.url, row.goal_signatures, row.created_by_email]
    );
    const created = inserted.rows?.[0] || row;
    fastify.log.info(
      {
        event: 'petition_created',
        petition_id: String(created?.id || row.id),
        movement_id: String(id),
        actor_id: String(authedUser.id || ''),
        storage: 'db',
      },
      'Petition created'
    );
    return reply.code(201).send({ petition: created });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create petition');
    return reply.code(500).send({ error: 'Failed to create petition' });
  }
});

fastify.get('/petitions/:id/signatures', async (request, reply) => {
  const petitionId = request.params?.id ? String(request.params.id) : null;
  if (!petitionId) return reply.code(400).send({ error: 'Petition id is required' });

  const myEmail = await tryGetUserEmailFromRequest(request);

  if (!hasDatabaseUrl) {
    const summary = memoryGetPetitionSignatureSummary(petitionId);
    const my_signature = myEmail ? memoryGetPetitionSignature(petitionId, myEmail) : null;
    return reply.send({ summary, my_signature });
  }

  try {
    await ensureMovementExtrasTables();

    const summaryRes = await pool.query(
      `SELECT
        COALESCE(COUNT(*), 0)::int AS count,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END), 0)::int AS velocity_7d,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0)::int AS velocity_24h
       FROM movement_petition_signatures
       WHERE petition_id = $1`,
      [String(petitionId)]
    );

    let my_signature = null;
    if (myEmail) {
      const myRes = await pool.query(
        'SELECT * FROM movement_petition_signatures WHERE petition_id = $1 AND user_email = $2 LIMIT 1',
        [String(petitionId), String(myEmail)]
      );
      my_signature = myRes.rows?.[0] || null;
    }

    const summary = summaryRes.rows?.[0] || { count: 0, velocity_7d: 0, velocity_24h: 0 };
    return reply.send({ summary, my_signature });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load petition signatures');
    return reply.code(500).send({ error: 'Failed to load signatures' });
  }
});

fastify.post('/petitions/:id/sign', { config: { rateLimit: RATE_LIMITS.petitionSign } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const petitionId = request.params?.id ? String(request.params.id) : null;
  if (!petitionId) return reply.code(400).send({ error: 'Petition id is required' });

  const schema = z.object({
    action: z.enum(['sign', 'withdraw']),
    comment: z.string().max(500).optional(),
    is_public: z.boolean().optional(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const safeComment = parsed.data.comment ? cleanText(parsed.data.comment) : null;
  const isPublic = typeof parsed.data.is_public === 'boolean' ? parsed.data.is_public : true;

  if (!hasDatabaseUrl) {
    const petition = findMemoryPetitionById(petitionId);
    if (!petition) return reply.code(404).send({ error: 'Petition not found' });

    if (parsed.data.action === 'withdraw') {
      memoryDeletePetitionSignature(petitionId, email);
      fastify.log.info(
        {
          event: 'petition_signature_withdrawn',
          petition_id: String(petitionId),
          movement_id: String(petition.movement_id),
          actor_id: String(authedUser.id || ''),
          storage: 'memory',
        },
        'Petition signature withdrawn'
      );
      return reply.send({ signature: null });
    }

    const signature = memoryUpsertPetitionSignature(petitionId, email, {
      movement_id: String(petition.movement_id),
      comment: safeComment,
      is_public: isPublic,
    });
    fastify.log.info(
      {
        event: 'petition_signed',
        petition_id: String(petitionId),
        movement_id: String(petition.movement_id),
        signature_id: signature?.id ? String(signature.id) : null,
        actor_id: String(authedUser.id || ''),
        storage: 'memory',
      },
      'Petition signed'
    );
    return reply.send({ signature });
  }

  try {
    await ensureMovementExtrasTables();
    const pRes = await pool.query('SELECT id, movement_id FROM movement_petitions WHERE id = $1 LIMIT 1', [String(petitionId)]);
    const petition = pRes.rows?.[0];
    if (!petition) return reply.code(404).send({ error: 'Petition not found' });

    if (parsed.data.action === 'withdraw') {
      await pool.query('DELETE FROM movement_petition_signatures WHERE petition_id = $1 AND user_email = $2', [String(petitionId), email]);
      fastify.log.info(
        {
          event: 'petition_signature_withdrawn',
          petition_id: String(petitionId),
          movement_id: String(petition.movement_id),
          actor_id: String(authedUser.id || ''),
          storage: 'db',
        },
        'Petition signature withdrawn'
      );
      return reply.send({ signature: null });
    }

    const id = randomUUID();
    const upsert = await pool.query(
      `INSERT INTO movement_petition_signatures (id, movement_id, petition_id, user_email, comment, is_public)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (petition_id, user_email)
       DO UPDATE SET comment = EXCLUDED.comment, is_public = EXCLUDED.is_public, updated_at = NOW()
       RETURNING *`,
      [id, String(petition.movement_id), String(petitionId), email, safeComment, isPublic]
    );
    const signature = upsert.rows?.[0] || null;
    fastify.log.info(
      {
        event: 'petition_signed',
        petition_id: String(petitionId),
        movement_id: String(petition.movement_id),
        signature_id: signature?.id ? String(signature.id) : null,
        actor_id: String(authedUser.id || ''),
        storage: 'db',
      },
      'Petition signed'
    );
    return reply.send({ signature });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to sign petition');
    return reply.code(500).send({ error: 'Failed to sign petition' });
  }
});

fastify.get('/movements/:id/impact', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  function parseIntParam(value, fallback, { min = 0, max = 200 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    return out;
  }

  const limit = parseIntParam(request.query?.limit, 200, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  function sortByCreatedDesc(a, b) {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  }

  if (!hasDatabaseUrl) {
    const list = memoryListExtras(memoryMovementImpactUpdatesByMovement, id).sort(sortByCreatedDesc);
    const page = list.slice(offset, offset + limit);
    return reply.send({ updates: page.map((u) => projectRecord(u, fields)) });
  }

  try {
    await ensureMovementExtrasTables();
    const res = await pool.query(
      'SELECT * FROM movement_impact_updates WHERE movement_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    return reply.send({ updates: rows.map((u) => projectRecord(u, fields)) });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load impact updates');
    return reply.code(500).send({ error: 'Failed to load impact updates' });
  }
});

fastify.post('/movements/:id/impact', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({ title: z.string().max(120).optional(), content: z.string().min(1).max(2000) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const row = {
    id: randomUUID(),
    movement_id: String(id),
    title: parsed.data.title ? cleanText(parsed.data.title) : null,
    content: cleanText(parsed.data.content),
    created_by_email: email,
    created_at: nowIso(),
  };

  if (!hasDatabaseUrl) {
    return reply.code(201).send({ update: memoryAppendExtra(memoryMovementImpactUpdatesByMovement, id, row) });
  }

  try {
    await ensureMovementExtrasTables();
    const inserted = await pool.query(
      `INSERT INTO movement_impact_updates (id, movement_id, title, content, created_by_email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [row.id, row.movement_id, row.title, row.content, row.created_by_email]
    );
    return reply.code(201).send({ update: inserted.rows?.[0] || row });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create impact update');
    return reply.code(500).send({ error: 'Failed to create impact update' });
  }
});

fastify.get('/movements/:id/tasks', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  function parseIntParam(value, fallback, { min = 0, max = 200 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    return out;
  }

  const limit = parseIntParam(request.query?.limit, 200, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  function sortByUpdatedDesc(a, b) {
    const ta = a?.updated_at ? new Date(a.updated_at).getTime() : 0;
    const tb = b?.updated_at ? new Date(b.updated_at).getTime() : 0;
    return tb - ta;
  }

  if (!hasDatabaseUrl) {
    const list = memoryListExtras(memoryMovementTasksByMovement, id).sort(sortByUpdatedDesc);
    const page = list.slice(offset, offset + limit);
    const emails = Array.from(
      new Set(
        page
          .flatMap((t) => [normalizeEmail(t?.assigned_to_email), normalizeEmail(t?.created_by_email)])
          .filter(Boolean)
      )
    );
    const lookup = await getPublicProfilesByEmail(emails);
    const enriched = page.map((t) => {
      const assignedEmail = normalizeEmail(t?.assigned_to_email || '');
      const createdEmail = normalizeEmail(t?.created_by_email || '');
      const assigned = assignedEmail ? lookup.get(assignedEmail) : null;
      const created = createdEmail ? lookup.get(createdEmail) : null;
      return {
        ...t,
        assigned_to_user_id: assigned?.user_id ?? null,
        created_by_user_id: created?.user_id ?? null,
      };
    });
    return reply.send({ tasks: enriched.map((t) => projectRecord(t, fields)) });
  }

  try {
    await ensureMovementExtrasTables();
    const res = await pool.query(
      'SELECT * FROM movement_tasks WHERE movement_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const emails = Array.from(
      new Set(
        rows
          .flatMap((t) => [normalizeEmail(t?.assigned_to_email), normalizeEmail(t?.created_by_email)])
          .filter(Boolean)
      )
    );
    const lookup = await getPublicProfilesByEmail(emails);
    const enriched = rows.map((t) => {
      const assignedEmail = normalizeEmail(t?.assigned_to_email || '');
      const createdEmail = normalizeEmail(t?.created_by_email || '');
      const assigned = assignedEmail ? lookup.get(assignedEmail) : null;
      const created = createdEmail ? lookup.get(createdEmail) : null;
      return {
        ...t,
        assigned_to_user_id: assigned?.user_id ?? null,
        created_by_user_id: created?.user_id ?? null,
      };
    });
    return reply.send({ tasks: enriched.map((t) => projectRecord(t, fields)) });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load movement tasks');
    return reply.code(500).send({ error: 'Failed to load tasks' });
  }
});

fastify.post('/movements/:id/tasks', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({
    title: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    assigned_to_email: z.string().email().optional(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const row = {
    id: randomUUID(),
    movement_id: String(id),
    title: cleanText(parsed.data.title),
    description: parsed.data.description ? cleanText(parsed.data.description) : null,
    status: 'todo',
    assigned_to_email: parsed.data.assigned_to_email ? normalizeEmail(parsed.data.assigned_to_email) : null,
    created_by_email: email,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  if (!hasDatabaseUrl) {
    let assignedUserId = null;
    if (row.assigned_to_email) {
      const lookup = await getPublicProfilesByEmail([row.assigned_to_email]);
      assignedUserId = lookup.get(row.assigned_to_email)?.user_id ?? null;
    }
    const saved = memoryAppendExtra(memoryMovementTasksByMovement, id, row);
    return reply.code(201).send({
      task: { ...saved, created_by_user_id: creatorUserId, assigned_to_user_id: assignedUserId },
    });
  }

  try {
    await ensureMovementExtrasTables();
    const inserted = await pool.query(
      `INSERT INTO movement_tasks (id, movement_id, title, description, status, assigned_to_email, created_by_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [row.id, row.movement_id, row.title, row.description, row.status, row.assigned_to_email, row.created_by_email]
    );
    const created = inserted.rows?.[0] || row;
    let assignedUserId = null;
    if (created?.assigned_to_email) {
      const assignedEmail = normalizeEmail(created.assigned_to_email);
      if (assignedEmail) {
        const lookup = await getPublicProfilesByEmail([assignedEmail]);
        assignedUserId = lookup.get(assignedEmail)?.user_id ?? null;
      }
    }
    return reply.code(201).send({
      task: { ...created, created_by_user_id: creatorUserId, assigned_to_user_id: assignedUserId },
    });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create task');
    return reply.code(500).send({ error: 'Failed to create task' });
  }
});

fastify.patch('/tasks/:id', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const taskId = request.params?.id ? String(request.params.id) : null;
  if (!taskId) return reply.code(400).send({ error: 'Task id is required' });

  const schema = z.object({
    status: z.enum(['todo', 'in_progress', 'completed']).optional(),
    assigned_to_email: z.string().email().optional().nullable(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const myEmail = normalizeEmail(authedUser.email);
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });

  if (!hasDatabaseUrl) {
    // Find the task and ensure membership via movement ID lookup.
    for (const [movementId, list] of memoryMovementTasksByMovement.entries()) {
      const t = Array.isArray(list) ? list.find((x) => String(x?.id) === taskId) : null;
      if (!t) continue;
      const next = memoryUpdateTask(movementId, taskId, {
        status: parsed.data.status ?? t.status,
        assigned_to_email:
          parsed.data.assigned_to_email === null
            ? null
            : parsed.data.assigned_to_email
              ? normalizeEmail(parsed.data.assigned_to_email)
              : t.assigned_to_email,
      });
      return reply.send({ task: next });
    }
    return reply.code(404).send({ error: 'Task not found' });
  }

  try {
    await ensureMovementExtrasTables();
    const existing = await pool.query('SELECT * FROM movement_tasks WHERE id = $1 LIMIT 1', [taskId]);
    const row = existing.rows?.[0] || null;
    if (!row) return reply.code(404).send({ error: 'Task not found' });

    const nextStatus = parsed.data.status ?? row.status;
    const nextAssigned =
      parsed.data.assigned_to_email === null
        ? null
        : parsed.data.assigned_to_email
          ? normalizeEmail(parsed.data.assigned_to_email)
          : row.assigned_to_email;

    const updated = await pool.query(
      'UPDATE movement_tasks SET status = $2, assigned_to_email = $3, updated_at = NOW() WHERE id = $1 RETURNING *',
      [taskId, nextStatus, nextAssigned]
    );
    return reply.send({ task: updated.rows?.[0] || { id: taskId } });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update task');
    return reply.code(500).send({ error: 'Failed to update task' });
  }
});

fastify.get('/movements/:id/discussions', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  function parseIntParam(value, fallback, { min = 0, max = 200 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    return out;
  }

  const limit = parseIntParam(request.query?.limit, 200, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  function sortByCreatedDesc(a, b) {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  }

  if (!hasDatabaseUrl) {
    const list = memoryListExtras(memoryMovementDiscussionsByMovement, id).sort(sortByCreatedDesc);
    const page = list.slice(offset, offset + limit);
    const emails = Array.from(new Set(page.map((m) => normalizeEmail(m?.author_email)).filter(Boolean)));
    const lookup = await getPublicProfilesByEmail(emails);
    const enriched = page.map((m) => {
      const email = normalizeEmail(m?.author_email || '');
      const profile = email ? lookup.get(email) : null;
      return { ...m, author_user_id: profile?.user_id ?? null };
    });
    return reply.send({ messages: enriched.map((m) => projectRecord(m, fields)) });
  }

  try {
    await ensureMovementExtrasTables();
    const res = await pool.query(
      'SELECT * FROM movement_discussions WHERE movement_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const emails = Array.from(new Set(rows.map((m) => normalizeEmail(m?.author_email)).filter(Boolean)));
    const lookup = await getPublicProfilesByEmail(emails);
    const enriched = rows.map((m) => {
      const email = normalizeEmail(m?.author_email || '');
      const profile = email ? lookup.get(email) : null;
      return { ...m, author_user_id: profile?.user_id ?? null };
    });
    return reply.send({ messages: enriched.map((m) => projectRecord(m, fields)) });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load movement discussions');
    return reply.code(500).send({ error: 'Failed to load discussions' });
  }
});

fastify.post('/movements/:id/discussions', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({ message: z.string().min(1).max(2000) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const ownerEmail = await getMovementOwnerEmail(id);
  if (ownerEmail && (await areUsersBlockedEitherDirection(email, ownerEmail))) {
    return sendBlockedInteraction(reply);
  }

  const row = {
    id: randomUUID(),
    movement_id: String(id),
    author_email: email,
    author_user_id: authorUserId,
    message: cleanText(parsed.data.message),
    created_at: nowIso(),
  };

  if (!hasDatabaseUrl) {
    const saved = memoryAppendExtra(memoryMovementDiscussionsByMovement, id, row);
    return reply.code(201).send({ message: { ...saved, author_user_id: authorUserId } });
  }

  try {
    await ensureMovementExtrasTables();
    const inserted = await pool.query(
      `INSERT INTO movement_discussions (id, movement_id, author_email, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [row.id, row.movement_id, row.author_email, row.message]
    );
    const created = inserted.rows?.[0] || row;
    return reply.code(201).send({ message: { ...created, author_user_id: authorUserId } });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create discussion message');
    return reply.code(500).send({ error: 'Failed to post discussion message' });
  }
});

fastify.post('/movements/:id/vote', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({
    value: z.number().int().min(-1).max(1),
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid vote payload' });
  }

  const value = parsed.data.value;
  const voterEmail = authedUser.email ?? null;
  if (!voterEmail) return reply.code(400).send({ error: 'User email is required' });

  const ownerEmail = await getMovementOwnerEmail(id);
  if (ownerEmail && (await areUsersBlockedEitherDirection(voterEmail, ownerEmail))) {
    return sendBlockedInteraction(reply);
  }

  if (!hasDatabaseUrl) {
    const movementId = String(id);
    const byUser = memoryVotes.get(movementId) || new Map();
    if (value === 0) {
      byUser.delete(String(voterEmail));
    } else {
      byUser.set(String(voterEmail), value);
    }
    memoryVotes.set(movementId, byUser);
    return reply.send(getMemoryVoteSummary(movementId, voterEmail));
  }

  try {
    await ensureVotesTable();

    if (value === 0) {
      await pool.query('DELETE FROM movement_votes WHERE movement_id = $1 AND voter_email = $2', [
        String(id),
        String(voterEmail),
      ]);
    } else {
      await pool.query(
        `INSERT INTO movement_votes (movement_id, voter_email, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (movement_id, voter_email)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(id), String(voterEmail), value]
      );
    }

    const summary = await getDbVoteSummary(id, voterEmail);
    return reply.send(summary);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to apply vote');
    return reply.code(500).send({ error: 'Failed to apply vote' });
  }
});

fastify.post('/movements', { config: { rateLimit: RATE_LIMITS.movementCreate } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  // Enforce platform role declaration acknowledgment
  try {
    const ok = await hasPlatformAcknowledgment(authedUser.email);
    if (!ok) {
      return reply.code(403).send({
        error:
          'Platform acknowledgment required: People Power is a neutral facilitation platform, not an organiser or endorser. Please acknowledge before creating a movement.',
      });
    }
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to check platform acknowledgment');
    return reply.code(500).send({ error: 'Failed to validate acknowledgment' });
  }

  const schema = z
    .object({
      title: z.string().min(1).max(MAX_TEXT_LENGTHS.movementTitle),
      description: z.string().min(1).max(MAX_TEXT_LENGTHS.movementDescription).optional(),
      description_html: z.string().min(1).max(MAX_TEXT_LENGTHS.movementDescriptionHtml).optional(),
      summary: z.string().min(1).max(MAX_TEXT_LENGTHS.movementSummary).optional(),
      visibility: z.enum(['public', 'community', 'private']).optional(),
      tags: z
        .union([
          z.array(z.string().max(MAX_TEXT_LENGTHS.movementTag)),
          z.string().max(500),
        ])
        .optional(),
      author_email: z.string().email().optional().nullable(),
      location_city: z.string().max(MAX_TEXT_LENGTHS.locationLabel).optional(),
      location_country: z.string().max(MAX_TEXT_LENGTHS.locationLabel).optional(),
      location_lat: z.number().optional(),
      location_lon: z.number().optional(),
      media_urls: z.array(z.string().max(MAX_TEXT_LENGTHS.movementMediaUrl)).optional(),
      claims: z
        .array(
          z.object({
            id: z.string().optional(),
            text: z.string().min(1).max(MAX_TEXT_LENGTHS.movementClaim),
            classification: z.enum(['opinion', 'experience', 'call_to_action', 'factual']).optional(),
            evidence: z
              .array(
                z.object({
                  url: z.string().min(1).max(MAX_TEXT_LENGTHS.movementClaimEvidenceUrl),
                  filename: z.string().max(MAX_TEXT_LENGTHS.movementClaimEvidenceFilename).optional(),
                  mime: z.string().max(MAX_TEXT_LENGTHS.movementClaimEvidenceMime).optional(),
                  size: z.number().optional(),
                })
              )
              .optional(),
          })
        )
        .optional(),
    })
    .refine((v) => !!(v.description || v.summary || v.description_html), {
      message: 'description is required',
      path: ['description'],
    });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    fastify.log.warn({ issues: parsed.error?.issues }, 'Invalid movement payload');
    return reply.code(400).send({
      error: 'Invalid movement payload',
    });
  }

  const raw = parsed.data;

  const roundCoord = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    return Number(v.toFixed(2));
  };

  const payload = {
    ...raw,
    title: cleanText(raw.title, MAX_TEXT_LENGTHS.movementTitle),
    description: raw.description ? cleanText(raw.description, MAX_TEXT_LENGTHS.movementDescription) : undefined,
    summary: raw.summary ? cleanText(raw.summary, MAX_TEXT_LENGTHS.movementSummary) : undefined,
    description_html: raw.description_html ? String(raw.description_html).slice(0, MAX_TEXT_LENGTHS.movementDescriptionHtml) : undefined,
    visibility: normalizeMovementVisibility(raw.visibility),
    tags: normalizeTags(raw.tags).filter((t) => ALLOWED_TAGS.has(t)),
    author_email: authedUser.email ?? null,
    location_city: raw.location_city ? cleanText(raw.location_city, MAX_TEXT_LENGTHS.locationLabel) : undefined,
    location_country: raw.location_country ? cleanText(raw.location_country, MAX_TEXT_LENGTHS.locationLabel) : undefined,
    location_lat: roundCoord(raw.location_lat),
    location_lon: roundCoord(raw.location_lon),
    media_urls: Array.isArray(raw.media_urls)
      ? raw.media_urls.map((u) => String(u).slice(0, MAX_TEXT_LENGTHS.movementMediaUrl))
      : undefined,
    claims: Array.isArray(raw.claims)
      ? raw.claims.map((c) => ({
          id: c.id ? String(c.id) : undefined,
          text: cleanText(c.text, MAX_TEXT_LENGTHS.movementClaim),
          classification: c.classification ? String(c.classification) : undefined,
          evidence: Array.isArray(c.evidence)
            ? c.evidence
                .filter((e) => e && typeof e === 'object')
                .map((e) => ({
                  url: String(e.url || '').slice(0, MAX_TEXT_LENGTHS.movementClaimEvidenceUrl),
                  filename: e.filename
                    ? String(e.filename).slice(0, MAX_TEXT_LENGTHS.movementClaimEvidenceFilename)
                    : undefined,
                  mime: e.mime ? String(e.mime).slice(0, MAX_TEXT_LENGTHS.movementClaimEvidenceMime) : undefined,
                  size: typeof e.size === 'number' ? e.size : undefined,
                }))
                .filter((e) => e.url)
            : undefined,
        }))
      : undefined,
  };

  if (!hasDatabaseUrl) {
    const created = {
      id: `mem-${Date.now()}`,
      title: payload.title,
      description: payload.description || payload.summary,
      description_html: payload.description_html,
      visibility: payload.visibility || 'public',
      tags: normalizeTags(payload.tags).filter((t) => ALLOWED_TAGS.has(t)),
      author_email: payload.author_email ?? null,
      location_city: payload.location_city,
      location_country: payload.location_country,
      location_lat: payload.location_lat,
      location_lon: payload.location_lon,
      media_urls: payload.media_urls,
      claims: payload.claims,
      created_at: new Date().toISOString(),
      momentum_score: 0,
      verified_participants: 0,
    };
    memoryMovements.unshift(created);
    fastify.log.info(
      {
        event: 'movement_created',
        movement_id: String(created.id),
        actor_id: String(authedUser.id || ''),
        storage: 'memory',
      },
      'Movement created'
    );
    const enriched = (await attachCreatorProfilesToMovements([created]))[0] || created;
    return reply.code(201).send(enriched);
  }

  try {
    await ensureMovementExtrasColumns();
    const columns = await getMovementsColumns();
    const insert = buildInsertForMovements(columns, payload);
    const result = await pool.query(insert.text, insert.values);
    const row = result.rows?.[0] || null;
    if (!row) {
      return reply.code(500).send({ error: 'Failed to create movement' });
    }
    fastify.log.info(
      {
        event: 'movement_created',
        movement_id: String(row.id),
        actor_id: String(authedUser.id || ''),
        storage: 'db',
      },
      'Movement created'
    );
    const enriched = (await attachCreatorProfilesToMovements([row]))[0] || row;
    return reply.code(201).send(enriched);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create movement');

    // Crash-proof fallback: if DB insert fails (bad connection/schema/etc),
    // still allow creation in memory so the app remains usable.
    const created = {
      id: `mem-${Date.now()}`,
      title: payload.title,
      description: payload.description || payload.summary,
      description_html: payload.description_html,
      visibility: payload.visibility || 'public',
      tags: normalizeTags(payload.tags).filter((t) => ALLOWED_TAGS.has(t)),
      author_email: payload.author_email ?? null,
      location_city: payload.location_city,
      location_country: payload.location_country,
      location_lat: payload.location_lat,
      location_lon: payload.location_lon,
      media_urls: payload.media_urls,
      claims: payload.claims,
      created_at: new Date().toISOString(),
      momentum_score: 0,
      verified_participants: 0,
    };
    memoryMovements.unshift(created);
    fastify.log.info(
      {
        event: 'movement_created',
        movement_id: String(created.id),
        actor_id: String(authedUser.id || ''),
        storage: 'memory_fallback',
      },
      'Movement created'
    );
    const enriched = (await attachCreatorProfilesToMovements([created]))[0] || created;
    return reply.code(201).send(enriched);
  }
});

// Update a movement (owner/admin only).
fastify.patch('/movements/:id', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const schema = z.object({
    title: z.string().min(1).max(MAX_TEXT_LENGTHS.movementTitle).optional(),
    description: z.string().max(MAX_TEXT_LENGTHS.movementDescription).optional(),
    description_html: z.string().max(MAX_TEXT_LENGTHS.movementDescriptionHtml).optional(),
    summary: z.string().max(MAX_TEXT_LENGTHS.movementSummary).optional(),
    tags: z.union([
      z.array(z.string().max(MAX_TEXT_LENGTHS.movementTag)),
      z.string().max(500),
    ]).optional(),
    location_city: z.string().max(MAX_TEXT_LENGTHS.locationLabel).optional().nullable(),
    location_country: z.string().max(MAX_TEXT_LENGTHS.locationLabel).optional().nullable(),
    location_lat: z.number().optional().nullable(),
    location_lon: z.number().optional().nullable(),
    media_urls: z.array(z.string().max(MAX_TEXT_LENGTHS.movementMediaUrl)).optional().nullable(),
    claims: z.array(
      z.object({
        id: z.string().optional(),
        text: z.string().min(1).max(MAX_TEXT_LENGTHS.movementClaim),
        classification: z.enum(['opinion', 'experience', 'call_to_action', 'factual']).optional(),
        evidence: z.array(
          z.object({
            url: z.string().min(1).max(MAX_TEXT_LENGTHS.movementClaimEvidenceUrl),
            filename: z.string().max(MAX_TEXT_LENGTHS.movementClaimEvidenceFilename).optional(),
            mime: z.string().max(MAX_TEXT_LENGTHS.movementClaimEvidenceMime).optional(),
            size: z.number().optional(),
          })
        ).optional(),
      })
    ).optional().nullable(),
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid movement payload' });
  }

  const raw = parsed.data || {};
  const hasAnyField = Object.keys(raw).length > 0;
  if (!hasAnyField) {
    return reply.code(400).send({ error: 'No fields provided' });
  }

  const cleanOptional = (value, max) => {
    if (value == null) return undefined;
    const cleaned = cleanText(String(value), max);
    return cleaned ? cleaned : null;
  };

  const roundCoord = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    return Number(v.toFixed(2));
  };

  const payload = {
    title: raw.title != null ? cleanText(raw.title, MAX_TEXT_LENGTHS.movementTitle) : undefined,
    description: raw.description != null ? cleanOptional(raw.description, MAX_TEXT_LENGTHS.movementDescription) : undefined,
    summary: raw.summary != null ? cleanOptional(raw.summary, MAX_TEXT_LENGTHS.movementSummary) : undefined,
    description_html: raw.description_html != null ? String(raw.description_html).slice(0, MAX_TEXT_LENGTHS.movementDescriptionHtml) : undefined,
    tags: raw.tags != null ? normalizeTags(raw.tags).filter((t) => ALLOWED_TAGS.has(t)) : undefined,
    location_city: raw.location_city != null ? cleanOptional(raw.location_city, MAX_TEXT_LENGTHS.locationLabel) : undefined,
    location_country: raw.location_country != null ? cleanOptional(raw.location_country, MAX_TEXT_LENGTHS.locationLabel) : undefined,
    location_lat: raw.location_lat != null ? roundCoord(raw.location_lat) : undefined,
    location_lon: raw.location_lon != null ? roundCoord(raw.location_lon) : undefined,
    media_urls: raw.media_urls != null
      ? (Array.isArray(raw.media_urls)
        ? raw.media_urls.map((u) => String(u).slice(0, MAX_TEXT_LENGTHS.movementMediaUrl)).filter(Boolean)
        : null)
      : undefined,
    claims: raw.claims != null
      ? (Array.isArray(raw.claims)
        ? raw.claims.map((c) => ({
            id: c.id ? String(c.id) : undefined,
            text: cleanText(c.text, MAX_TEXT_LENGTHS.movementClaim),
            classification: c.classification ? String(c.classification) : undefined,
            evidence: Array.isArray(c.evidence)
              ? c.evidence
                  .filter((e) => e && typeof e === 'object')
                  .map((e) => ({
                    url: String(e.url || '').slice(0, MAX_TEXT_LENGTHS.movementClaimEvidenceUrl),
                    filename: e.filename
                      ? String(e.filename).slice(0, MAX_TEXT_LENGTHS.movementClaimEvidenceFilename)
                      : undefined,
                    mime: e.mime ? String(e.mime).slice(0, MAX_TEXT_LENGTHS.movementClaimEvidenceMime) : undefined,
                    size: typeof e.size === 'number' ? e.size : undefined,
                  }))
                  .filter((e) => e.url)
              : undefined,
          }))
        : null)
      : undefined,
  };

  const staffRole = getStaffRoleForEmail(email);

  // Memory-backed movements
  const memIdx = memoryMovements.findIndex((m) => String(m?.id) === id);
  if (memIdx !== -1) {
    const existing = memoryMovements[memIdx];
    const ownerEmail = normalizeEmail(existing?.author_email);
    const isOwner = ownerEmail && ownerEmail === email;
    if (!isOwner && staffRole !== 'admin') {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const next = { ...existing };
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) next[key] = value;
    }
    next.updated_at = nowIso();
    memoryMovements[memIdx] = next;
    const enriched = (await attachCreatorProfilesToMovements([next]))[0] || next;
    return reply.send(enriched);
  }

  if (!hasDatabaseUrl) {
    return reply.code(404).send({ error: 'Movement not found' });
  }

  try {
    const existingRes = await pool.query('SELECT * FROM movements WHERE id = $1 LIMIT 1', [id]);
    const existing = existingRes.rows?.[0] || null;
    if (!existing) return reply.code(404).send({ error: 'Movement not found' });

    const ownerEmail = normalizeEmail(existing?.author_email);
    const isOwner = ownerEmail && ownerEmail === email;
    if (!isOwner && staffRole !== 'admin') {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const columns = await getMovementsColumns();
    const byName = new Map(columns.map((c) => [c.column_name, c]));
    const updates = [];
    const values = [];

    const pushUpdate = (key, value, cast) => {
      if (!byName.has(key)) return;
      values.push(value);
      const idx = values.length;
      updates.push(`${key} = ${cast ? `$${idx}${cast}` : `$${idx}`}`);
    };

    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;
      if (key === 'tags') {
        const col = byName.get('tags');
        if (col?.data_type === 'ARRAY' || col?.udt_name === '_text') {
          pushUpdate('tags', value, '');
        } else if (col?.data_type === 'json' || col?.data_type === 'jsonb') {
          pushUpdate('tags', value, '::jsonb');
        } else {
          pushUpdate('tags', Array.isArray(value) ? value.join(',') : value, '');
        }
        continue;
      }
      if (key === 'media_urls' || key === 'claims') {
        const col = byName.get(key);
        if (col?.data_type === 'json' || col?.data_type === 'jsonb') {
          pushUpdate(key, value, '::jsonb');
        } else {
          pushUpdate(key, value, '');
        }
        continue;
      }
      pushUpdate(key, value, '');
    }

    if (!updates.length) {
      return reply.code(400).send({ error: 'No fields provided' });
    }

    updates.push('updated_at = NOW()');
    values.push(id);
    const query = `UPDATE movements SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`;
    const updatedRes = await pool.query(query, values);
    const updated = updatedRes.rows?.[0] || null;
    if (!updated) return reply.code(500).send({ error: 'Failed to update movement' });
    const enriched = (await attachCreatorProfilesToMovements([updated]))[0] || updated;
    return reply.send(enriched);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update movement');
    return reply.code(500).send({ error: 'Failed to update movement' });
  }
});

fastify.delete('/movements/:id', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });
  const staffRole = getStaffRoleForEmail(email);

  // Memory-backed movements
  const memIdx = memoryMovements.findIndex((m) => String(m?.id) === id);
  if (memIdx !== -1) {
    const m = memoryMovements[memIdx];
    const ownerEmail = normalizeEmail(m?.author_email);
    const movementTitle = m?.title ? String(m.title) : 'Movement';
    const isOwner = ownerEmail && ownerEmail === email;
    const trustScore = await getUserTrustScore(email);
    if (!isOwner && staffRole !== 'admin' && trustScore < TRUST_SCORE_THRESHOLD) {
      await logCollaboratorAction({
        movement_id: id,
        actor_user_id: authedUser.id || authedUser.email,
        action_type: 'blocked_action',
        target_id: id,
        metadata: { reason: 'low_trust_delete_movement', trustScore }
      });
      return reply.code(403).send({ error: 'This action requires a higher trust level or owner approval.' });
    }
    if (!isOwner && staffRole !== 'admin') {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    memoryMovements.splice(memIdx, 1);
    await logCollaboratorAction({
      movement_id: id,
      actor_user_id: authedUser.id || authedUser.email,
      action_type: 'delete_movement',
      target_id: id,
      metadata: null
    });
    let notifyResult = { sent: 0, mode: 'none' };
    try {
      notifyResult = await notifyVerifiedParticipantsOnDeletion({
        movementId: id,
        movementTitle,
        deletedByEmail: email,
      });
    } catch {
      // ignore notification failures
    }
    return reply.code(200).send({ ok: true, notified_count: notifyResult.sent, notification_mode: notifyResult.mode });
  }

  if (!hasDatabaseUrl) {
    return reply.code(404).send({ error: 'Movement not found' });
  }

  try {
    const existing = await pool.query('SELECT * FROM movements WHERE id = $1 LIMIT 1', [id]);
    const row = existing.rows?.[0] || null;
    if (!row) return reply.code(404).send({ error: 'Movement not found' });

    const ownerEmail = normalizeEmail(row?.author_email);
    const movementTitle = row?.title ? String(row.title) : 'Movement';
    const isOwner = ownerEmail && ownerEmail === email;
    const trustScore = await getUserTrustScore(email);
    if (!isOwner && staffRole !== 'admin' && trustScore < TRUST_SCORE_THRESHOLD) {
      await logCollaboratorAction({
        movement_id: id,
        actor_user_id: authedUser.id || authedUser.email,
        action_type: 'blocked_action',
        target_id: id,
        metadata: { reason: 'low_trust_delete_movement', trustScore }
      });
      return reply.code(403).send({ error: 'This action requires a higher trust level or owner approval.' });
    }
    if (!isOwner && staffRole !== 'admin') {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    await pool.query('DELETE FROM movements WHERE id = $1', [id]);
    await logCollaboratorAction({
      movement_id: id,
      actor_user_id: authedUser.id || authedUser.email,
      action_type: 'delete_movement',
      target_id: id,
      metadata: null
    });
    let notifyResult = { sent: 0, mode: 'none' };
    try {
      notifyResult = await notifyVerifiedParticipantsOnDeletion({
        movementId: id,
        movementTitle,
        deletedByEmail: email,
      });
    } catch {
      // ignore notification failures
    }
    return reply.code(200).send({ ok: true, notified_count: notifyResult.sent, notification_mode: notifyResult.mode });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to delete movement');
    return reply.code(500).send({ error: 'Failed to delete movement' });
  }
});

fastify.post('/reports', { config: { rateLimit: RATE_LIMITS.reportCreate } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({
    report_type: z.enum(['abuse', 'bug', 'feedback']).optional(),
    report_title: z.string().max(MAX_TEXT_LENGTHS.reportTitle).optional().nullable(),
    reported_content_type: z.string().min(1).max(MAX_TEXT_LENGTHS.reportContentType),
    reported_content_id: z.string().min(1).max(MAX_TEXT_LENGTHS.reportContentId),
    report_category: z.string().min(1).max(MAX_TEXT_LENGTHS.reportCategory),
    report_details: z.string().max(MAX_TEXT_LENGTHS.reportDetails).optional().nullable(),
    evidence_urls: z.array(z.string().min(1).max(MAX_TEXT_LENGTHS.reportEvidenceUrl)).max(6).optional(),
  }).superRefine((data, ctx) => {
    const type = data.report_type || 'abuse';
    if (type === 'bug') {
      if (!data.report_title || !String(data.report_title).trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bug reports require a title', path: ['report_title'] });
      }
      const details = data.report_details ? String(data.report_details).trim() : '';
      if (!details) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bug reports require details', path: ['report_details'] });
      }
      if (details.length > MAX_TEXT_LENGTHS.reportBugDetails) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bug report details are too long', path: ['report_details'] });
      }
    }
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid report payload' });
  }

  const createMemoryReport = async () => {
    const reportType = parsed.data.report_type || 'abuse';
    const reportTitle = parsed.data.report_title
      ? cleanText(parsed.data.report_title, MAX_TEXT_LENGTHS.reportTitle)
      : null;
    const reportDetails = parsed.data.report_details
      ? cleanText(
          parsed.data.report_details,
          reportType === 'bug' ? MAX_TEXT_LENGTHS.reportBugDetails : MAX_TEXT_LENGTHS.reportDetails
        )
      : null;
    const evidenceUrls = Array.isArray(parsed.data.evidence_urls)
      ? parsed.data.evidence_urls.map((u) => String(u)).filter(Boolean).slice(0, 6)
      : null;
    const reporterEmail = String(authedUser.email || '');
    const now = nowIso();
    const isRepeatReport = memoryReports.some(
      (r) =>
        normalizeEmail(r?.reporter_email) === normalizeEmail(reporterEmail) &&
        String(r?.reported_content_type) === String(parsed.data.reported_content_type) &&
        String(r?.reported_content_id) === String(parsed.data.reported_content_id)
    );
    const fallbackReport = {
      id: String(memoryReportSeq++),
      reporter_email: reporterEmail,
      reported_content_type: String(parsed.data.reported_content_type),
      reported_content_id: String(parsed.data.reported_content_id),
      report_category: String(parsed.data.report_category),
      report_details: reportDetails,
      report_type: reportType,
      report_title: reportTitle,
      evidence_urls: evidenceUrls,
      evidence_file_url: evidenceUrls?.[0] ? String(evidenceUrls[0]) : null,
      status: 'pending',
      priority: 'normal',
      is_repeat_report: isRepeatReport,
      created_at: now,
      updated_at: now,
      moderator_email: null,
      moderator_notes: null,
      action_taken: null,
    };
    memoryReports.unshift(fallbackReport);

    try {
      await logIncident({
        event_type: 'report_created',
        actor_user_id: String(authedUser.id || ''),
        actor_email: reporterEmail,
        trigger_system: 'user_report',
        human_reviewed: false,
        related_entity_type: 'report',
        related_entity_id: String(fallbackReport.id),
        context: {
          reported_content_type: String(parsed.data.reported_content_type),
          reported_content_id: String(parsed.data.reported_content_id),
          report_category: String(parsed.data.report_category),
          report_type: reportType,
        },
      });
    } catch (e) {
      // Never fail report creation if incident logging fails.
      fastify.log.error({ err: e }, 'Failed to log incident for report fallback');
    }

    return fallbackReport;
  };

  if (!hasDatabaseUrl) {
    const fallbackReport = await createMemoryReport();
    const receipt = buildReportReceiptEmail(fallbackReport);
    void sendReportEmail({
      to: fallbackReport?.reporter_email,
      subject: receipt.subject,
      text: receipt.text,
      html: receipt.html,
    });
    return reply.code(201).send(fallbackReport);
  }

  try {
    await ensureReportsTable();
    const reportType = parsed.data.report_type || 'abuse';
    const reportTitle = parsed.data.report_title
      ? cleanText(parsed.data.report_title, MAX_TEXT_LENGTHS.reportTitle)
      : null;
    const reportDetails = parsed.data.report_details
      ? cleanText(
          parsed.data.report_details,
          reportType === 'bug' ? MAX_TEXT_LENGTHS.reportBugDetails : MAX_TEXT_LENGTHS.reportDetails
        )
      : null;

    const result = await pool.query(
      `INSERT INTO reports
        (reporter_email, reported_content_type, reported_content_id, report_category, report_details, report_type, report_title, evidence_urls, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [
        String(authedUser.email || ''),
        String(parsed.data.reported_content_type),
        String(parsed.data.reported_content_id),
        String(parsed.data.report_category),
        reportDetails,
        reportType,
        reportTitle,
        Array.isArray(parsed.data.evidence_urls)
          ? parsed.data.evidence_urls.map((u) => String(u)).filter(Boolean).slice(0, 6)
          : null,
      ]
    );

    const row = result.rows?.[0] ?? null;
    if (row?.id) {
      fastify.log.info(
        {
          event: 'report_created',
          report_id: String(row.id),
          reporter_id: String(authedUser.id || ''),
          reported_content_type: String(parsed.data.reported_content_type),
          reported_content_id: String(parsed.data.reported_content_id),
        },
        'Report created'
      );

      await logIncident({
        event_type: 'report_created',
        actor_user_id: String(authedUser.id || ''),
        actor_email: String(authedUser.email || ''),
        trigger_system: 'user_report',
        human_reviewed: false,
        related_entity_type: 'report',
        related_entity_id: String(row.id),
        context: {
          reported_content_type: String(parsed.data.reported_content_type),
          reported_content_id: String(parsed.data.reported_content_id),
          report_category: String(parsed.data.report_category),
          report_type: reportType,
        },
      });
    }

    if (row) {
      const receipt = buildReportReceiptEmail(row);
      void sendReportEmail({
        to: row?.reporter_email,
        subject: receipt.subject,
        text: receipt.text,
        html: receipt.html,
      });
    }
    return reply.code(201).send(row ?? { ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create report; using memory fallback');
    try {
      const fallbackReport = await createMemoryReport();
      const receipt = buildReportReceiptEmail(fallbackReport);
      void sendReportEmail({
        to: fallbackReport?.reporter_email,
        subject: receipt.subject,
        text: receipt.text,
        html: receipt.html,
      });
      return reply.code(201).send(fallbackReport);
    } catch (fallbackError) {
      fastify.log.error({ err: fallbackError }, 'Memory fallback failed for report');
      return reply.code(201).send({ ok: true, mode: 'fallback' });
    }
  }
});

fastify.get('/reports', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const staffUser = await requireAdminUser(request, reply);
  if (!staffUser) return;

  if (!hasDatabaseUrl) {
    const status = request.query?.status ? String(request.query.status) : null;
    const rows = Array.isArray(memoryReports) ? memoryReports : [];
    const filtered = status ? rows.filter((r) => String(r?.status || '') === status) : rows;
    const ordered = [...filtered].sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
    return reply.send(ordered);
  }

  const status = request.query?.status ? String(request.query.status) : null;

  try {
    await ensureReportsTable();
    const result = status
      ? await pool.query(
          'SELECT * FROM reports WHERE status = $1 ORDER BY created_at DESC LIMIT 200',
          [status]
        )
      : await pool.query('SELECT * FROM reports ORDER BY created_at DESC LIMIT 200');

    return reply.send(result.rows || []);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to fetch reports');
    return reply.code(500).send({ error: 'Failed to fetch reports' });
  }
});

fastify.patch('/reports/:id', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const staffUser = await requireAdminUser(request, reply);
  if (!staffUser) return;

  const staffRole = getStaffRoleForEmail(staffUser.email);

  const rawId = request.params?.id ? String(request.params.id) : '';
  const id = Number(rawId);
  if (!Number.isFinite(id)) {
    return reply.code(400).send({ error: 'Invalid report id' });
  }

  const schema = z.object({
    status: z.enum([
      'pending',
      'in_review',
      'needs_info',
      'pending_second_approval',
      'resolved',
      'dismissed',
    ]).optional(),
    moderator_notes: z.string().max(4000).optional().nullable(),
    action_taken: z.string().max(200).optional().nullable(),
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid update payload' });
  }

  if (parsed.data.action_taken !== undefined && staffRole !== 'admin') {
    return reply.code(403).send({ error: 'Admin access required for action_taken' });
  }

  if (!hasDatabaseUrl) {
    const idStr = String(rawId || '');
    const row = memoryReports.find((r) => String(r?.id) === idStr);
    if (!row) return reply.code(404).send({ error: 'Report not found' });

    const previousStatus = String(row.status || '');
    if (parsed.data.status) row.status = String(parsed.data.status);
    if (parsed.data.moderator_notes !== undefined) {
      row.moderator_notes = parsed.data.moderator_notes == null ? null : String(parsed.data.moderator_notes);
    }
    if (parsed.data.action_taken !== undefined) {
      row.action_taken = parsed.data.action_taken == null ? null : String(parsed.data.action_taken);
    }
    row.moderator_email = String(staffUser.email || '');
    row.updated_at = nowIso();

    await logIncident({
      event_type: 'moderation_action_applied',
      actor_user_id: String(staffUser.id || ''),
      actor_email: String(staffUser.email || ''),
      trigger_system: 'moderation',
      human_reviewed: true,
      related_entity_type: 'report',
      related_entity_id: String(row.id),
      context: {
        status: row.status == null ? null : String(row.status),
        action_taken: row.action_taken == null ? null : String(row.action_taken),
      },
    });

    if (parsed.data.status === 'resolved' && previousStatus !== 'resolved') {
      const resolved = buildReportResolvedEmail(row);
      void sendReportEmail({
        to: row?.reporter_email,
        subject: resolved.subject,
        text: resolved.text,
        html: resolved.html,
      });
    }

    return reply.send(row);
  }

  try {
    await ensureReportsTable();

    const previousRes = await pool.query(
      'SELECT status, reporter_email, report_type, report_category, report_title FROM reports WHERE id = $1 LIMIT 1',
      [id]
    );
    const previousRow = previousRes.rows?.[0] || null;

    const fields = [];
    const values = [];

    if (parsed.data.status) {
      values.push(String(parsed.data.status));
      fields.push(`status = $${values.length}`);
    }

    if (parsed.data.moderator_notes !== undefined) {
      values.push(parsed.data.moderator_notes == null ? null : String(parsed.data.moderator_notes));
      fields.push(`moderator_notes = $${values.length}`);
    }

    if (parsed.data.action_taken !== undefined) {
      values.push(parsed.data.action_taken == null ? null : String(parsed.data.action_taken));
      fields.push(`action_taken = $${values.length}`);
    }

    values.push(String(staffUser.email || ''));
    fields.push(`moderator_email = $${values.length}`);

    fields.push('updated_at = NOW()');

    if (fields.length === 0) {
      return reply.code(400).send({ error: 'No updates provided' });
    }

    values.push(id);
    const sql = `UPDATE reports SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`;
    const result = await pool.query(sql, values);
    const row = result.rows?.[0] || null;
    if (!row) return reply.code(404).send({ error: 'Report not found' });

    fastify.log.info(
      {
        event: 'moderation_action_applied',
        report_id: String(row.id),
        moderator_id: String(staffUser.id || ''),
        status: String(row.status || ''),
        action_taken: row.action_taken == null ? null : String(row.action_taken),
      },
      'Moderation action applied'
    );

    await logIncident({
      event_type: 'moderation_action_applied',
      actor_user_id: String(staffUser.id || ''),
      actor_email: String(staffUser.email || ''),
      trigger_system: 'moderation',
      human_reviewed: true,
      related_entity_type: 'report',
      related_entity_id: String(row.id),
      context: {
        status: row.status == null ? null : String(row.status),
        action_taken: row.action_taken == null ? null : String(row.action_taken),
      },
    });

    if (parsed.data.status === 'resolved' && String(previousRow?.status || '') !== 'resolved') {
      const resolved = buildReportResolvedEmail(row || previousRow);
      void sendReportEmail({
        to: row?.reporter_email || previousRow?.reporter_email,
        subject: resolved.subject,
        text: resolved.text,
        html: resolved.html,
      });
    }

    return reply.send(row);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update report');
    return reply.code(500).send({ error: 'Failed to update report' });
  }
});

fastify.post('/incidents', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({
    event_type: z.string().min(1).max(80),
    movement_id: z.string().max(80).optional().nullable(),
    trigger_system: z.string().max(40).optional().nullable(),
    human_reviewed: z.boolean().optional(),
    related_entity_type: z.string().max(40).optional().nullable(),
    related_entity_id: z.string().max(120).optional().nullable(),
    target_user_ids: z.array(z.string().min(1).max(80)).max(25).optional().nullable(),
    target_emails: z.array(z.string().min(1).max(200)).max(25).optional().nullable(),
    context: z.record(z.string(), z.any()).optional().nullable(),
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid incident payload' });
  }

  const created = await logIncident({
    event_type: parsed.data.event_type,
    actor_user_id: String(authedUser.id || ''),
    actor_email: String(authedUser.email || ''),
    target_user_ids: parsed.data.target_user_ids ?? null,
    target_emails: parsed.data.target_emails ?? null,
    movement_id: parsed.data.movement_id ? String(parsed.data.movement_id) : null,
    trigger_system: parsed.data.trigger_system ? String(parsed.data.trigger_system) : 'client',
    human_reviewed: !!parsed.data.human_reviewed,
    related_entity_type: parsed.data.related_entity_type ? String(parsed.data.related_entity_type) : null,
    related_entity_id: parsed.data.related_entity_id ? String(parsed.data.related_entity_id) : null,
    context: parsed.data.context ?? {},
  });

  return reply.code(201).send({ ok: true, incident: created });
});

fastify.get('/admin/incidents', { config: { rateLimit: RATE_LIMITS.admin } }, async (request, reply) => {
  const staffUser = await requireAdminUser(request, reply);
  if (!staffUser) return;

  function parseIntParam(value, fallback, { min = 0, max = 1000 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  const limit = parseIntParam(request.query?.limit, 50, { min: 1, max: 100 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const q = request.query?.q ? String(request.query.q).trim() : '';
  const query = q ? q.toLowerCase() : '';

  if (!hasDatabaseUrl) {
    const matches = (rec) => {
      if (!query) return true;
      const hay = [
        rec?.event_type,
        rec?.actor_email,
        rec?.movement_id,
        rec?.trigger_system,
        rec?.related_entity_type,
        rec?.related_entity_id,
        JSON.stringify(rec?.context || {}),
      ]
        .map((v) => String(v || '').toLowerCase())
        .join(' | ');
      return hay.includes(query);
    };

    const filtered = memoryIncidentLogs.filter(matches);
    const page = filtered.slice(offset, offset + limit);
    const hasMore = offset + limit < filtered.length;
    return reply.send({ items: page, limit, offset, has_more: hasMore });
  }

  try {
    await ensureIncidentLogsTable();

    const take = Math.min(100, limit);
    const takePlusOne = take + 1;

    if (!q) {
      const res = await pool.query(
        'SELECT * FROM incident_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [takePlusOne, offset]
      );
      const rows = Array.isArray(res.rows) ? res.rows : [];
      const hasMore = rows.length > take;
      return reply.send({ items: rows.slice(0, take), limit: take, offset, has_more: hasMore });
    }

    const pattern = `%${q}%`;
    const res = await pool.query(
      `SELECT *
       FROM incident_logs
       WHERE event_type ILIKE $1
          OR COALESCE(actor_email,'') ILIKE $1
          OR COALESCE(movement_id,'') ILIKE $1
          OR COALESCE(trigger_system,'') ILIKE $1
          OR COALESCE(related_entity_type,'') ILIKE $1
          OR COALESCE(related_entity_id,'') ILIKE $1
          OR context::text ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [pattern, takePlusOne, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const hasMore = rows.length > take;
    return reply.send({ items: rows.slice(0, take), limit: take, offset, has_more: hasMore });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to list incident logs');
    return reply.code(500).send({ error: 'Failed to list incident logs' });
  }
});

// Messages (conversations + messages)
fastify.get('/conversations', async (request, reply) => {
  const reqId = request.id;
  try {
    const authedUser = await requireVerifiedUser(request, reply);
    if (!authedUser) return;

    const myEmail = normalizeEmail(authedUser.email);
    if (!myEmail) {
      fastify.log.warn({ reqId }, 'GET /conversations: missing user email');
      return reply.code(400).send({ error: 'User email is required' });
    }

    const type = request.query?.type ? String(request.query.type) : null;
    const viewerBlocks = await withTimeout(getUserBlockSets(myEmail), 4000, 'getUserBlockSets');

  function parseIntParam(value, fallback, { min = 0, max = 500 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    return out;
  }

  const limit = parseIntParam(request.query?.limit, 100, { min: 1, max: 100 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  function getOtherParticipants(convo) {
    const participants = Array.isArray(convo?.participant_emails) ? convo.participant_emails : [];
    return participants
      .map((e) => normalizeEmail(e))
      .filter((e) => e && e !== myEmail);
  }

  function hasBlockedRelation(convo) {
    return getOtherParticipants(convo).some((e) => isBlockedForViewer(e, viewerBlocks));
  }

  function hasBlockedByViewer(convo) {
    return getOtherParticipants(convo).some((e) => isBlockedByViewer(e, viewerBlocks));
  }

  function shouldHideDirectConversation(convo) {
    if (convo?.is_group) return false;
    const other = getOtherParticipants(convo)[0];
    if (!other) return false;
    return isBlockedForViewer(other, viewerBlocks);
  }

  function annotateConversation(convo) {
    const blockedRelation = hasBlockedRelation(convo);
    if (!blockedRelation) return convo;
    const patch = {
      ...convo,
      last_message_body: null,
    };
    if (hasBlockedByViewer(convo)) {
      patch.has_blocked_participant = true;
    }
    return patch;
  }

    if (!hasDatabaseUrl) {
      const list = memoryListConversationsForUser(myEmail).filter((c) => {
      const status = String(c?.request_status || 'accepted');
      const blockedBy = normalizeEmail(c?.blocked_by_email);
      if (status !== 'blocked') return true;
      return !blockedBy || blockedBy === myEmail;
    }).filter((c) => !shouldHideDirectConversation(c)).map(annotateConversation);
    const filtered =
      type === 'requests'
        ? list.filter((c) => c?.request_status === 'pending')
        : type === 'inbox'
          ? list.filter((c) => c?.request_status !== 'pending' && c?.request_status !== 'declined')
          : list;

      const page = filtered.slice(offset, offset + limit).map((c) => projectRecord(c, fields));
      return reply.send(page);
    }

    await withTimeout(ensureMessagesTables(), 4000, 'ensureMessagesTables');

    const whereExtra =
      type === 'requests'
        ? " AND c.request_status = 'pending'"
        : type === 'inbox'
          ? " AND c.request_status <> 'pending' AND c.request_status <> 'declined'"
          : '';

    const result = await withTimeout(pool.query(
      `SELECT
         c.*, 
         lm.body AS last_message_body,
         lm.created_at AS last_message_at,
         (
           SELECT COUNT(*)::int
           FROM messages m
           WHERE m.conversation_id = c.id
             AND m.sender_email <> $1
             AND NOT (m.read_by @> ARRAY[$1])
         ) AS unread_count
       FROM conversations c
       LEFT JOIN LATERAL (
         SELECT body, created_at
         FROM messages m
         WHERE m.conversation_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) lm ON TRUE
       WHERE c.participant_emails @> ARRAY[$1]
         AND (c.request_status <> 'blocked' OR c.blocked_by_email = $1)
         ${whereExtra}
       ORDER BY COALESCE(lm.created_at, c.updated_at) DESC
       LIMIT $2 OFFSET $3`,
      [myEmail, limit, offset]
    ), 5000, 'conversations query');

    const rows = result.rows || [];
    const filtered = Array.isArray(rows) ? rows.filter((c) => !shouldHideDirectConversation(c)) : [];
    const annotated = filtered.map(annotateConversation);
    return reply.send(annotated.map((c) => projectRecord(c, fields)));
  } catch (e) {
    const isTimeout = e && (e.code === 'PP_TIMEOUT' || e.name === 'TimeoutError');
    fastify.log.error(
      {
        reqId,
        isTimeout,
        timeoutLabel: e && e.label,
        timeoutMs: e && e.timeoutMs,
        err: e,
      },
      'GET /conversations failed'
    );
    // Prefer deterministic 500 over hanging (which can surface as upstream 503 without CORS).
    return reply.code(500).send({ error: 'Failed to load conversations' });
  }
});

if (DEBUG_ROUTES_ENABLED) {
  fastify.get('/__debug/whoami', async (request, reply) => {
    const user = await requireVerifiedUser(request, reply);
    if (!user) return;

    const role = getStaffRoleForEmail(user.email);
    return reply.send({ id: user.id || null, email: user.email || null, role });
  });

  fastify.get('/__debug/rbac/reports', async (request, reply) => {
    const user = await requireVerifiedUser(request, reply);
    if (!user) return;

    const role = getStaffRoleForEmail(user.email);
    return reply.send({
      role,
      canViewReports: !!role,
      canUpdateReports: !!role,
      canSetActionTaken: role === 'admin',
    });
  });

  fastify.get('/db-health', async () => {
    const result = await pool.query('SELECT NOW()');
    return { dbTime: result.rows[0] };
  });
}

fastify.post('/conversations', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({ recipient_email: z.string().email() });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload' });
  }

  const myEmail = normalizeEmail(authedUser.email);
  const recipient = normalizeEmail(parsed.data.recipient_email);
  if (!myEmail || !recipient) return reply.code(400).send({ error: 'Invalid emails' });
  if (myEmail === recipient) return reply.code(400).send({ error: 'Cannot message yourself' });
  if (await areUsersBlockedEitherDirection(myEmail, recipient)) {
    return sendBlockedInteraction(reply);
  }

  // DM rules: you can DM people you follow; otherwise this becomes a message request.
  let isRequest = true;
  try {
    isRequest = !(await doesUserFollow(myEmail, recipient));
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to check follow rule; defaulting to request');
    isRequest = true;
  }

  if (!hasDatabaseUrl) {
    const convo = memoryEnsureConversationBetweenWithRequest(myEmail, recipient, {
      is_request: isRequest,
      requester_email: myEmail,
      request_status: isRequest ? 'pending' : 'accepted',
    });
    return reply.code(201).send(convo);
  }

  try {
    await ensureMessagesTables();
    const participants = [myEmail, recipient].sort();

    const existing = await pool.query(
      `SELECT *
       FROM conversations
       WHERE participant_emails @> ARRAY[$1, $2]
         AND array_length(participant_emails, 1) = 2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [participants[0], participants[1]]
    );

    if (existing.rows?.[0]) return reply.send(existing.rows[0]);

    const id = randomUUID();
    const created = await pool.query(
      `INSERT INTO conversations (id, participant_emails, is_request, requester_email, request_status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, participants, isRequest, isRequest ? myEmail : null, isRequest ? 'pending' : 'accepted']
    );

    return reply.code(201).send(created.rows?.[0] ?? { id });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create conversation');
    return reply.code(500).send({ error: 'Failed to create conversation' });
  }
});

// Create a general-purpose group chat (max 10 participants, E2EE-ready).
fastify.post('/conversations/group', { config: { rateLimit: RATE_LIMITS.conversationCreate } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({
    group_name: z.string().min(1).max(120),
    participant_emails: z.array(z.string().email()).min(1).max(MAX_GROUP_PARTICIPANTS),
    group_avatar_url: z.string().max(MAX_TEXT_LENGTHS.profilePhotoUrl).optional().nullable(),
    group_post_mode: z.enum(['owner_only', 'admins', 'selected', 'all']).optional(),
    group_posters: z.array(z.string().email()).optional().nullable(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const myEmail = normalizeEmail(authedUser.email);
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });

  const requested = normalizeEmailList(parsed.data.participant_emails, { max: MAX_GROUP_PARTICIPANTS });
  const participantSet = new Set([myEmail, ...requested]);
  const participants = Array.from(participantSet).sort();
  if (participants.length < 2) {
    return reply.code(400).send({ error: 'At least one other participant is required' });
  }
  if (participants.length > MAX_GROUP_PARTICIPANTS) {
    return reply.code(400).send({ error: `Group chat is limited to ${MAX_GROUP_PARTICIPANTS} participants` });
  }

  const groupName = safeString(parsed.data.group_name, { max: 120 });
  if (!groupName) return reply.code(400).send({ error: 'Group name is required' });

  const groupAvatarUrl = normalizeGroupAvatarUrl(parsed.data.group_avatar_url);
  const groupPostMode = GROUP_POST_MODES.has(parsed.data.group_post_mode) ? parsed.data.group_post_mode : 'all';
  const posters = normalizeEmailList(parsed.data.group_posters);
  const allowedPosters = posters.filter((email) => participants.includes(email));

  if (!hasDatabaseUrl) {
    const missing = participants.filter((p) => !memoryPublicKeys.get(p));
    if (missing.length) {
      return reply.code(409).send({ error: 'Missing public keys', missing });
    }
    const created = memoryCreateGroupConversation({
      participant_emails: participants,
      group_name: groupName,
      group_type: 'custom',
      movement_id: null,
      created_by_email: myEmail,
      group_avatar_url: groupAvatarUrl,
      group_admin_emails: [myEmail],
      group_post_mode: groupPostMode,
      group_posters: allowedPosters,
    });
    if (!created) return reply.code(500).send({ error: 'Failed to create group chat' });
    return reply.code(201).send(created);
  }

  try {
    await ensureMessagesTables();
    await ensurePublicKeysTable();
    const keyRes = await pool.query(
      'SELECT email FROM user_public_keys WHERE email = ANY($1::text[])',
      [participants]
    );
    const found = new Set((keyRes.rows || []).map((r) => normalizeEmail(r?.email)));
    const missing = participants.filter((p) => !found.has(p));
    if (missing.length) {
      return reply.code(409).send({ error: 'Missing public keys', missing });
    }

    const id = randomUUID();
    const created = await pool.query(
      `INSERT INTO conversations
       (id, participant_emails, is_request, requester_email, request_status, is_group, group_name, group_avatar_url, group_type, movement_id, created_by_email, group_admin_emails, group_post_mode, group_posters)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        id,
        participants,
        false,
        null,
        'accepted',
        true,
        groupName,
        groupAvatarUrl,
        'custom',
        null,
        myEmail,
        [myEmail],
        groupPostMode,
        allowedPosters,
      ]
    );
    return reply.code(201).send(created.rows?.[0] ?? { id });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create group chat');
    return reply.code(500).send({ error: 'Failed to create group chat' });
  }
});

// Update group chat settings (name/avatar/post permissions/admins).
fastify.patch('/conversations/:id/group', { config: { rateLimit: RATE_LIMITS.conversationCreate } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const conversationId = request.params?.id ? String(request.params.id) : null;
  if (!conversationId) return reply.code(400).send({ error: 'Conversation id is required' });

  const schema = z.object({
    group_name: z.string().max(120).optional(),
    group_avatar_url: z.string().max(MAX_TEXT_LENGTHS.profilePhotoUrl).optional().nullable(),
    group_post_mode: z.enum(['owner_only', 'admins', 'selected', 'all']).optional(),
    group_posters: z.array(z.string().email()).optional(),
    group_admin_emails: z.array(z.string().email()).optional(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const myEmail = normalizeEmail(authedUser.email);
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });

  function applyGroupPatch(convo) {
    if (!convo?.is_group) return null;

    const isMovementGroup = String(convo?.group_type || '') === 'movement_verified';
    const owner = normalizeEmail(convo?.created_by_email);
    const isOwner = owner && owner === myEmail;
    const canManage = canManageGroup(convo, myEmail);
    if (!canManage) return { error: 'Group admin access required', code: 403 };

    const next = { ...convo };

    if (parsed.data.group_name != null) {
      const name = safeString(parsed.data.group_name, { max: 120 });
      if (!name) return { error: 'Group name is required', code: 400 };
      next.group_name = name;
    }

    if (parsed.data.group_avatar_url !== undefined) {
      const url = normalizeGroupAvatarUrl(parsed.data.group_avatar_url);
      next.group_avatar_url = url;
    }

    if (parsed.data.group_admin_emails) {
      if (!isOwner) return { error: 'Only the group owner can update admin roles', code: 403 };
      const admins = normalizeEmailList(parsed.data.group_admin_emails);
      if (owner && !admins.includes(owner)) admins.unshift(owner);
      next.group_admin_emails = admins;
    }

    if (parsed.data.group_post_mode) {
      if (isMovementGroup && !isOwner) {
        return { error: 'Only the movement owner can update posting permissions', code: 403 };
      }
      next.group_post_mode = parsed.data.group_post_mode;
    }

    if (parsed.data.group_posters) {
      if (isMovementGroup && !isOwner) {
        return { error: 'Only the movement owner can update posting permissions', code: 403 };
      }
      const participants = normalizeEmailList(convo?.participant_emails);
      next.group_posters = normalizeEmailList(parsed.data.group_posters).filter((email) => participants.includes(email));
    }

    return { next };
  }

  if (!hasDatabaseUrl) {
    const convo = getMemoryConversationById(conversationId);
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    const result = applyGroupPatch(convo);
    if (result?.error) return reply.code(result.code || 400).send({ error: result.error });
    const idx = memoryConversations.findIndex((c) => String(c?.id) === String(conversationId));
    if (idx !== -1) memoryConversations[idx] = { ...result.next, updated_at: nowIso() };
    return reply.send(memoryConversations[idx] || result.next);
  }

  try {
    await ensureMessagesTables();
    const convoRes = await pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [conversationId]);
    const convo = convoRes.rows?.[0] || null;
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    if (!(convo.participant_emails || []).map((x) => String(x).toLowerCase()).includes(myEmail)) {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const result = applyGroupPatch(convo);
    if (result?.error) return reply.code(result.code || 400).send({ error: result.error });

    const updated = await pool.query(
      `UPDATE conversations
       SET group_name = $2,
           group_avatar_url = $3,
           group_admin_emails = $4,
           group_post_mode = $5,
           group_posters = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        conversationId,
        result.next.group_name,
        result.next.group_avatar_url,
        normalizeEmailList(result.next.group_admin_emails),
        getGroupPostMode(result.next),
        normalizeEmailList(result.next.group_posters),
      ]
    );
    return reply.send(updated.rows?.[0] || { ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update group settings');
    return reply.code(500).send({ error: 'Failed to update group settings' });
  }
});

// Add/remove group participants (admins only; movement groups are owner-only).
fastify.post('/conversations/:id/participants', { config: { rateLimit: RATE_LIMITS.conversationCreate } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const conversationId = request.params?.id ? String(request.params.id) : null;
  if (!conversationId) return reply.code(400).send({ error: 'Conversation id is required' });

  const schema = z.object({
    add_emails: z.array(z.string().email()).optional(),
    remove_emails: z.array(z.string().email()).optional(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const myEmail = normalizeEmail(authedUser.email);
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });

  async function applyParticipantPatch(convo) {
    if (!convo?.is_group) return { error: 'Not a group chat', code: 400 };
    const isMovementGroup = String(convo?.group_type || '') === 'movement_verified';
    const owner = normalizeEmail(convo?.created_by_email);
    const isOwner = owner && owner === myEmail;
    const canManage = isMovementGroup ? isOwner : canManageGroup(convo, myEmail);
    if (!canManage) return { error: 'Group admin access required', code: 403 };

    const participants = normalizeEmailList(convo?.participant_emails, { max: 200 });
    const add = normalizeEmailList(parsed.data.add_emails);
    const remove = normalizeEmailList(parsed.data.remove_emails);

    if (isMovementGroup && add.length) {
      const verified = await listVerifiedParticipantEmails(convo?.movement_id);
      const verifiedSet = new Set(verified);
      const eligible = await filterMovementGroupOptOut(verified);
      const eligibleSet = new Set(eligible);
      const invalid = add.filter((email) => !verifiedSet.has(email));
      const optedOut = add.filter((email) => verifiedSet.has(email) && !eligibleSet.has(email));
      if (invalid.length || optedOut.length) {
        return {
          error: 'Only verified participants who opted in can be added',
          code: 400,
          invalid,
          opted_out: optedOut,
        };
      }
    }

    const nextSet = new Set(participants);
    for (const email of add) nextSet.add(email);
    for (const email of remove) {
      if (email && email !== owner) nextSet.delete(email);
    }

    const next = Array.from(nextSet);
    if (next.length > MAX_GROUP_PARTICIPANTS) {
      return { error: `Group chat is limited to ${MAX_GROUP_PARTICIPANTS} participants`, code: 400 };
    }
    if (owner && !next.includes(owner)) next.push(owner);

    const nextAdmins = getGroupAdmins(convo).filter((email) => next.includes(email));
    if (owner && !nextAdmins.includes(owner)) nextAdmins.unshift(owner);

    const nextPosters = normalizeEmailList(convo?.group_posters).filter((email) => next.includes(email));

    return {
      nextParticipants: next,
      nextAdmins,
      nextPosters,
    };
  }

  if (!hasDatabaseUrl) {
    const convo = getMemoryConversationById(conversationId);
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    const result = await applyParticipantPatch(convo);
    if (result?.error) return reply.code(result.code || 400).send({ error: result.error, invalid: result.invalid });
    const idx = memoryConversations.findIndex((c) => String(c?.id) === String(conversationId));
    if (idx !== -1) {
      memoryConversations[idx] = {
        ...convo,
        participant_emails: result.nextParticipants,
        group_admin_emails: result.nextAdmins,
        group_posters: result.nextPosters,
        updated_at: nowIso(),
      };
    }
    return reply.send(memoryConversations[idx] || convo);
  }

  try {
    await ensureMessagesTables();
    const convoRes = await pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [conversationId]);
    const convo = convoRes.rows?.[0] || null;
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    if (!(convo.participant_emails || []).map((x) => String(x).toLowerCase()).includes(myEmail)) {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const result = await applyParticipantPatch(convo);
    if (result?.error) return reply.code(result.code || 400).send({ error: result.error, invalid: result.invalid });

    const updated = await pool.query(
      `UPDATE conversations
       SET participant_emails = $2,
           group_admin_emails = $3,
           group_posters = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [conversationId, result.nextParticipants, result.nextAdmins, result.nextPosters]
    );
    return reply.send(updated.rows?.[0] || { ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update group participants');
    return reply.code(500).send({ error: 'Failed to update participants' });
  }
});

fastify.post('/conversations/:id/request', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const myEmail = normalizeEmail(authedUser.email);
  const conversationId = request.params?.id ? String(request.params.id) : null;
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });
  if (!conversationId) return reply.code(400).send({ error: 'Conversation id is required' });

  const schema = z.object({ action: z.enum(['accept', 'decline', 'block']) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload' });
  }

  if (!hasDatabaseUrl) {
    const convo = getMemoryConversationById(conversationId);
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    const participants = Array.isArray(convo.participant_emails) ? convo.participant_emails.map((x) => normalizeEmail(x)) : [];
    if (!participants.includes(myEmail)) return reply.code(403).send({ error: 'Not allowed' });

    const requester = normalizeEmail(convo.requester_email);
    const recipient = getOtherParticipantEmail(convo, requester);
    const isRecipient = !!(recipient && recipient === myEmail);

    if (!isRecipient) return reply.code(403).send({ error: 'Only the recipient can manage the request' });

    let next = { ...convo };
    if (parsed.data.action === 'accept') {
      next.is_request = false;
      next.request_status = 'accepted';
    } else if (parsed.data.action === 'decline') {
      next.is_request = true;
      next.request_status = 'declined';
    } else if (parsed.data.action === 'block') {
      next.is_request = true;
      next.request_status = 'blocked';
      next.blocked_by_email = myEmail;
    }
    const idx = memoryConversations.findIndex((c) => String(c?.id) === String(conversationId));
    if (idx !== -1) memoryConversations[idx] = next;
    wsBroadcastToEmails(next?.participant_emails, {
      type: 'conversation:updated',
      conversationId: String(conversationId),
      conversation: next,
    });
    return reply.send(next);
  }

  try {
    await ensureMessagesTables();
    const convoRes = await pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [conversationId]);
    const convo = convoRes.rows?.[0] || null;
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    if (!(convo.participant_emails || []).map((x) => String(x).toLowerCase()).includes(myEmail)) {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const requester = normalizeEmail(convo.requester_email);
    const recipient = getOtherParticipantEmail(convo, requester);
    const isRecipient = !!(recipient && recipient === myEmail);
    if (!isRecipient) return reply.code(403).send({ error: 'Only the recipient can manage the request' });

    let patch;
    if (parsed.data.action === 'accept') {
      patch = { is_request: false, request_status: 'accepted', blocked_by_email: null };
    } else if (parsed.data.action === 'decline') {
      patch = { is_request: true, request_status: 'declined' };
    } else {
      patch = { is_request: true, request_status: 'blocked', blocked_by_email: myEmail };
    }

    const updated = await pool.query(
      `UPDATE conversations
       SET is_request = $2,
           request_status = $3,
           blocked_by_email = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [conversationId, patch.is_request, patch.request_status, patch.blocked_by_email ?? null]
    );
    const row = updated.rows?.[0] || null;
    if (row) {
      wsBroadcastToEmails(row?.participant_emails, {
        type: 'conversation:updated',
        conversationId: String(conversationId),
        conversation: row,
      });
    }
    return reply.send(row || { ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update request status');
    return reply.code(500).send({ error: 'Failed to update request status' });
  }
});

fastify.get('/conversations/:id/messages', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  function parseIntParam(value, fallback, { min = 0, max = 500 } = {}) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFields(value) {
    if (!value) return null;
    const list = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }

  function projectRecord(record, fields) {
    if (!fields) return record;
    const out = {};
    const want = new Set(['id', ...fields]);
    for (const key of want) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    return out;
  }

  const myEmail = normalizeEmail(authedUser.email);
  const conversationId = request.params?.id ? String(request.params.id) : null;
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });
  if (!conversationId) return reply.code(400).send({ error: 'Conversation id is required' });

  const viewerBlocks = await getUserBlockSets(myEmail);

  const limit = parseIntParam(request.query?.limit, 50, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  if (!hasDatabaseUrl) {
    const convo = getMemoryConversationById(conversationId);
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    const participants = Array.isArray(convo.participant_emails)
      ? convo.participant_emails.map((x) => String(x).toLowerCase())
      : [];
    if (!participants.includes(myEmail)) return reply.code(403).send({ error: 'Not allowed' });
    const other = participants.find((email) => email && email !== myEmail);
    if (!convo?.is_group && other && isBlockedForViewer(other, viewerBlocks)) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }

    const status = String(convo?.request_status || 'accepted');
    const blockedBy = normalizeEmail(convo?.blocked_by_email);
    if (status === 'blocked' && blockedBy && blockedBy !== myEmail) {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const all = memoryListMessages(conversationId);
    const sorted = (Array.isArray(all) ? all : []).slice().sort((a, b) => {
      const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
    const visible = sorted.filter((m) => {
      const sender = normalizeEmail(m?.sender_email || '');
      return !isBlockedForViewer(sender, viewerBlocks);
    });
    const page = visible.slice(offset, offset + limit).map((m) => projectRecord(m, fields));
    return reply.send(page);
  }

  try {
    await ensureMessagesTables();
    const convoRes = await pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [conversationId]);
    const convo = convoRes.rows?.[0] || null;
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    if (!(convo.participant_emails || []).map((x) => String(x).toLowerCase()).includes(myEmail)) {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    const participants = Array.isArray(convo.participant_emails)
      ? convo.participant_emails.map((x) => String(x).toLowerCase())
      : [];
    const other = participants.find((email) => email && email !== myEmail);
    if (!convo?.is_group && other && isBlockedForViewer(other, viewerBlocks)) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }

    const status = String(convo?.request_status || 'accepted');
    const blockedBy = normalizeEmail(convo?.blocked_by_email);
    if (status === 'blocked' && blockedBy && blockedBy !== myEmail) {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const result = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [conversationId, limit, offset]
    );

    const rows = result.rows || [];
    const visible = (Array.isArray(rows) ? rows : []).filter((m) => {
      const sender = normalizeEmail(m?.sender_email || '');
      return !isBlockedForViewer(sender, viewerBlocks);
    });
    return reply.send(visible.map((m) => projectRecord(m, fields)));
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load messages');
    return reply.code(500).send({ error: 'Failed to load messages' });
  }
});

fastify.post('/conversations/:id/messages', { config: { rateLimit: RATE_LIMITS.messageSend } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({ body: z.string().min(1).max(MAX_TEXT_LENGTHS.messageCiphertext) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload' });
  }

  const myEmail = normalizeEmail(authedUser.email);
  const conversationId = request.params?.id ? String(request.params.id) : null;
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });
  if (!conversationId) return reply.code(400).send({ error: 'Conversation id is required' });
  const viewerBlocks = await getUserBlockSets(myEmail);

  if (!hasDatabaseUrl) {
    const convo = getMemoryConversationById(conversationId);
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    const participants = Array.isArray(convo.participant_emails)
      ? convo.participant_emails.map((x) => String(x).toLowerCase())
      : [];
    if (!participants.includes(myEmail)) return reply.code(403).send({ error: 'Not allowed' });
    const other = participants.find((email) => email && email !== myEmail);
    if (!convo?.is_group && other && isBlockedForViewer(other, viewerBlocks)) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }

    const status = String(convo?.request_status || 'accepted');
    const requester = normalizeEmail(convo?.requester_email);
    const blockedBy = normalizeEmail(convo?.blocked_by_email);
    if (status === 'blocked' && blockedBy && blockedBy !== myEmail) {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    const hasBlocked = participants
      .filter((e) => e && e !== myEmail)
      .some((e) => isBlockedForViewer(e, viewerBlocks));
    if (!convo?.is_group && hasBlocked) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }
    if (status === 'pending' && requester && requester !== myEmail) {
      return reply.code(403).send({ error: 'Request pending. Accept to reply.' });
    }
    if (convo?.is_group && !canPostToGroup(convo, myEmail)) {
      return reply.code(403).send({ error: 'Group chat is read-only for your account' });
    }

    const message = memoryAppendMessage(conversationId, myEmail, parsed.data.body);
    if (!message) return reply.code(400).send({ error: 'Message body is required' });
    notifyMessageRecipients({ conversation: convo, body: parsed.data.body, senderEmail: myEmail }).catch((err) => {
      fastify.log.warn({ err }, 'Message notification failed (memory)');
    });
    wsBroadcastToEmails(convo?.participant_emails, {
      type: 'message:new',
      conversationId: String(conversationId),
      conversation: convo,
      message,
    });
    return reply.code(201).send(message);
  }

  try {
    await ensureMessagesTables();
    const convoRes = await pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [conversationId]);
    const convo = convoRes.rows?.[0] || null;
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    if (!(convo.participant_emails || []).map((x) => String(x).toLowerCase()).includes(myEmail)) {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    const participants = Array.isArray(convo.participant_emails)
      ? convo.participant_emails.map((x) => String(x).toLowerCase())
      : [];
    const other = participants.find((email) => email && email !== myEmail);
    if (!convo?.is_group && other && isBlockedForViewer(other, viewerBlocks)) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }

    const status = String(convo?.request_status || 'accepted');
    const requester = normalizeEmail(convo?.requester_email);
    const blockedBy = normalizeEmail(convo?.blocked_by_email);
    if (status === 'blocked' && blockedBy && blockedBy !== myEmail) {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    const hasBlocked = participants
      .filter((e) => e && e !== myEmail)
      .some((e) => isBlockedForViewer(e, viewerBlocks));
    if (!convo?.is_group && hasBlocked) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }
    if (status === 'pending' && requester && requester !== myEmail) {
      return reply.code(403).send({ error: 'Request pending. Accept to reply.' });
    }
    if (convo?.is_group && !canPostToGroup(convo, myEmail)) {
      return reply.code(403).send({ error: 'Group chat is read-only for your account' });
    }

    const id = randomUUID();
    const cleanBody = cleanText(parsed.data.body, MAX_TEXT_LENGTHS.messageCiphertext);
    const created = await pool.query(
      `INSERT INTO messages (id, conversation_id, sender_email, body, read_by, delivered_to)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, conversationId, myEmail, cleanBody, [myEmail], []]
    );

    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
    notifyMessageRecipients({ conversation: convo, body: cleanBody, senderEmail: myEmail }).catch((err) => {
      fastify.log.warn({ err }, 'Message notification failed');
    });

    const row = created.rows?.[0] || null;
    if (row) {
      wsBroadcastToEmails(convo?.participant_emails, {
        type: 'message:new',
        conversationId: String(conversationId),
        conversation: convo,
        message: row,
      });
    }
    return reply.code(201).send(created.rows?.[0] ?? { id });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to send message');
    return reply.code(500).send({ error: 'Failed to send message' });
  }
});

// User follow endpoints (for DM rules and profile UX)
fastify.get('/users/:email/follow', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const target = normalizeEmail(request.params?.email);
  const me = normalizeEmail(authedUser.email);
  if (!target) return reply.code(400).send({ error: 'Valid email is required' });
  if (!me) return reply.code(400).send({ error: 'User email is required' });
  if (await areUsersBlockedEitherDirection(me, target)) {
    return sendBlockedInteraction(reply);
  }

  const following = await doesUserFollow(me, target);

  if (!hasDatabaseUrl) {
    const mySet = memoryUserFollows.get(me) || new Set();
    let followersCount = 0;
    const targetFollowingSet = memoryUserFollows.get(target) || new Set();
    for (const [, set] of memoryUserFollows.entries()) {
      if (set.has(target)) followersCount += 1;
    }
    return reply.send({
      following,
      followers_count: followersCount,
      following_count: targetFollowingSet.size,
      my_following_count: mySet.size,
    });
  }

  try {
    await ensureUserFollowsTable();
    const followersRes = await pool.query('SELECT COUNT(*)::int AS count FROM user_follows WHERE following_email = $1', [target]);
    const followingRes = await pool.query('SELECT COUNT(*)::int AS count FROM user_follows WHERE follower_email = $1', [target]);
    const myFollowingRes = await pool.query('SELECT COUNT(*)::int AS count FROM user_follows WHERE follower_email = $1', [me]);
    return reply.send({
      following,
      followers_count: followersRes.rows?.[0]?.count ?? 0,
      following_count: followingRes.rows?.[0]?.count ?? 0,
      my_following_count: myFollowingRes.rows?.[0]?.count ?? 0,
    });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load follow state');
    return reply.code(500).send({ error: 'Failed to load follow state' });
  }
});

async function getUserIsPrivateByEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return false;

  if (!hasDatabaseUrl) {
    const profile = memoryUserProfiles.get(target) || null;
    return !!profile?.is_private;
  }

  try {
    await ensureUserProfilesTable();
    const res = await pool.query('SELECT is_private FROM user_profiles WHERE user_email = $1 LIMIT 1', [target]);
    return !!res.rows?.[0]?.is_private;
  } catch {
    return false;
  }
}

async function canViewUserFollowLists({ viewerEmail, targetEmail }) {
  const viewer = normalizeEmail(viewerEmail);
  const target = normalizeEmail(targetEmail);
  if (!viewer || !target) return false;
  if (viewer === target) return true;

  const isPrivate = await getUserIsPrivateByEmail(target);
  if (!isPrivate) return true;

  // Private list access rule (per spec): allow only if the target user follows the viewer.
  return doesUserFollow(target, viewer);
}

fastify.get('/users/:email/following-users', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const target = normalizeEmail(request.params?.email);
  const me = normalizeEmail(authedUser.email);
  if (!target) return reply.code(400).send({ error: 'Valid email is required' });
  if (!me) return reply.code(400).send({ error: 'User email is required' });

  if (await areUsersBlockedEitherDirection(me, target)) {
    return sendBlockedInteraction(reply);
  }

  const allowed = await canViewUserFollowLists({ viewerEmail: me, targetEmail: target });
  if (!allowed) {
    return reply.code(403).send({
      error: 'Followers list is only visible to people you follow.',
      code: 'FOLLOW_LIST_PRIVATE',
    });
  }

  try {
    if (!hasDatabaseUrl) {
      const set = memoryUserFollows.get(target) || new Set();
      const emails = Array.from(set).map((e) => normalizeEmail(e)).filter(Boolean);
      const lookup = await getPublicProfilesByEmail(emails);
      const users = emails.map((email) => {
        const profile = lookup.get(email) || null;
        return {
          user_id: profile?.user_id ?? null,
          email,
          display_name: profile?.display_name ?? null,
          username: profile?.username ?? null,
          profile_photo_url: profile?.profile_photo_url ?? null,
        };
      });
      return reply.send({ users });
    }

    await ensureUserFollowsTable();
    const result = await pool.query(
      `SELECT following_email AS email
       FROM user_follows
       WHERE follower_email = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [target]
    );
    const emails = Array.isArray(result.rows)
      ? result.rows.map((r) => normalizeEmail(r?.email)).filter(Boolean)
      : [];
    const lookup = await getPublicProfilesByEmail(emails);
    const users = emails.map((email) => {
      const profile = lookup.get(email) || null;
      return {
        user_id: profile?.user_id ?? null,
        email,
        display_name: profile?.display_name ?? null,
        username: profile?.username ?? null,
        profile_photo_url: profile?.profile_photo_url ?? null,
      };
    });
    return reply.send({ users });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load following users');
    return reply.code(500).send({ error: 'Failed to load following users' });
  }
});

fastify.get('/users/:email/followers', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const target = normalizeEmail(request.params?.email);
  const me = normalizeEmail(authedUser.email);
  if (!target) return reply.code(400).send({ error: 'Valid email is required' });
  if (!me) return reply.code(400).send({ error: 'User email is required' });

  if (await areUsersBlockedEitherDirection(me, target)) {
    return sendBlockedInteraction(reply);
  }

  const allowed = await canViewUserFollowLists({ viewerEmail: me, targetEmail: target });
  if (!allowed) {
    return reply.code(403).send({
      error: 'Followers list is only visible to people you follow.',
      code: 'FOLLOW_LIST_PRIVATE',
    });
  }

  try {
    if (!hasDatabaseUrl) {
      const followers = [];
      for (const [follower, set] of memoryUserFollows.entries()) {
        if (set && set.has(target)) followers.push(normalizeEmail(follower));
      }
      const emails = followers.filter(Boolean);
      const lookup = await getPublicProfilesByEmail(emails);
      const users = emails.map((email) => {
        const profile = lookup.get(email) || null;
        return {
          user_id: profile?.user_id ?? null,
          email,
          display_name: profile?.display_name ?? null,
          username: profile?.username ?? null,
          profile_photo_url: profile?.profile_photo_url ?? null,
        };
      });
      return reply.send({ users });
    }

    await ensureUserFollowsTable();
    const result = await pool.query(
      `SELECT follower_email AS email
       FROM user_follows
       WHERE following_email = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [target]
    );
    const emails = Array.isArray(result.rows)
      ? result.rows.map((r) => normalizeEmail(r?.email)).filter(Boolean)
      : [];
    const lookup = await getPublicProfilesByEmail(emails);
    const users = emails.map((email) => {
      const profile = lookup.get(email) || null;
      return {
        user_id: profile?.user_id ?? null,
        email,
        display_name: profile?.display_name ?? null,
        username: profile?.username ?? null,
        profile_photo_url: profile?.profile_photo_url ?? null,
      };
    });
    return reply.send({ users });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load followers');
    return reply.code(500).send({ error: 'Failed to load followers' });
  }
});

fastify.post('/users/:email/follow', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const target = normalizeEmail(request.params?.email);
  const me = normalizeEmail(authedUser.email);
  if (!target) return reply.code(400).send({ error: 'Valid email is required' });
  if (!me) return reply.code(400).send({ error: 'User email is required' });
  if (target === me) return reply.code(400).send({ error: 'Cannot follow yourself' });
  if (await areUsersBlockedEitherDirection(me, target)) {
    return sendBlockedInteraction(reply);
  }

  const schema = z.object({ following: z.boolean() });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload' });
  }

  if (!hasDatabaseUrl) {
    const set = memoryUserFollows.get(me) || new Set();
    if (parsed.data.following) set.add(target);
    else set.delete(target);
    memoryUserFollows.set(me, set);
    const following = set.has(target);
    let followersCount = 0;
    const targetFollowingSet = memoryUserFollows.get(target) || new Set();
    for (const [, s] of memoryUserFollows.entries()) {
      if (s.has(target)) followersCount += 1;
    }
    return reply.send({
      following,
      followers_count: followersCount,
      following_count: targetFollowingSet.size,
      my_following_count: set.size,
    });
  }

  try {
    await ensureUserFollowsTable();
    if (parsed.data.following) {
      await pool.query(
        'INSERT INTO user_follows (follower_email, following_email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [me, target]
      );
    } else {
      await pool.query('DELETE FROM user_follows WHERE follower_email = $1 AND following_email = $2', [me, target]);
    }

    const following = await doesUserFollow(me, target);
    const followersRes = await pool.query('SELECT COUNT(*)::int AS count FROM user_follows WHERE following_email = $1', [target]);
    const followingRes = await pool.query('SELECT COUNT(*)::int AS count FROM user_follows WHERE follower_email = $1', [target]);
    const myFollowingRes = await pool.query('SELECT COUNT(*)::int AS count FROM user_follows WHERE follower_email = $1', [me]);
    return reply.send({
      following,
      followers_count: followersRes.rows?.[0]?.count ?? 0,
      following_count: followingRes.rows?.[0]?.count ?? 0,
      my_following_count: myFollowingRes.rows?.[0]?.count ?? 0,
    });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update follow state');
    return reply.code(500).send({ error: 'Failed to update follow state' });
  }
});

fastify.get('/me/following-users', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const myEmail = normalizeEmail(authedUser.email);
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });

  try {
    if (!hasDatabaseUrl) {
      const set = memoryUserFollows.get(myEmail) || new Set();
      const emails = Array.from(set).map((e) => normalizeEmail(e)).filter(Boolean);
      const lookup = await getPublicProfilesByEmail(emails);
      const users = emails.map((email) => {
        const profile = lookup.get(email) || null;
        return {
          user_id: profile?.user_id ?? null,
          email,
          display_name: profile?.display_name ?? null,
          username: profile?.username ?? null,
          profile_photo_url: profile?.profile_photo_url ?? null,
        };
      });
      return reply.send({ users });
    }

    await ensureUserFollowsTable();
    const result = await pool.query(
      `SELECT following_email AS email
       FROM user_follows
       WHERE follower_email = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [myEmail]
    );
    const emails = Array.isArray(result.rows)
      ? result.rows.map((r) => normalizeEmail(r?.email)).filter(Boolean)
      : [];
    const lookup = await getPublicProfilesByEmail(emails);
    const users = emails.map((email) => {
      const profile = lookup.get(email) || null;
      return {
        user_id: profile?.user_id ?? null,
        email,
        display_name: profile?.display_name ?? null,
        username: profile?.username ?? null,
        profile_photo_url: profile?.profile_photo_url ?? null,
      };
    });
    return reply.send({ users });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load following users');
    return reply.code(500).send({ error: 'Failed to load following users' });
  }
});

fastify.get('/me/followers', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const myEmail = normalizeEmail(authedUser.email);
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });

  try {
    if (!hasDatabaseUrl) {
      const followers = [];
      for (const [follower, set] of memoryUserFollows.entries()) {
        if (set && set.has(myEmail)) followers.push(normalizeEmail(follower));
      }
      const emails = followers.filter(Boolean);
      const lookup = await getPublicProfilesByEmail(emails);
      const users = emails.map((email) => {
        const profile = lookup.get(email) || null;
        return {
          user_id: profile?.user_id ?? null,
          email,
          display_name: profile?.display_name ?? null,
          username: profile?.username ?? null,
          profile_photo_url: profile?.profile_photo_url ?? null,
        };
      });
      return reply.send({ users });
    }

    await ensureUserFollowsTable();
    const result = await pool.query(
      `SELECT follower_email AS email
       FROM user_follows
       WHERE following_email = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [myEmail]
    );
    const emails = Array.isArray(result.rows)
      ? result.rows.map((r) => normalizeEmail(r?.email)).filter(Boolean)
      : [];
    const lookup = await getPublicProfilesByEmail(emails);
    const users = emails.map((email) => {
      const profile = lookup.get(email) || null;
      return {
        user_id: profile?.user_id ?? null,
        email,
        display_name: profile?.display_name ?? null,
        username: profile?.username ?? null,
        profile_photo_url: profile?.profile_photo_url ?? null,
      };
    });
    return reply.send({ users });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load followers');
    return reply.code(500).send({ error: 'Failed to load followers' });
  }
});

// FIX: add authenticated user lookup/search for DM compose by display name.
fastify.get('/users/search', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const viewerBlocks = await getUserBlockSets(authedUser.email);
  const query = request.query?.query ? String(request.query.query).trim() : '';
  if (!query) return reply.send({ users: [] });

  const limitRaw = request.query?.limit;
  const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(25, Number(limitRaw))) : 10;

  if (!hasDatabaseUrl) return reply.send({ users: [] });

  try {
    await ensureUserProfilesTable();
    const like = `%${query}%`;
    const res = await pool.query(
      `SELECT user_id, user_email, display_name, username, profile_photo_url, location, movement_group_opt_out
       FROM user_profiles
       WHERE display_name ILIKE $1 OR username ILIKE $1 OR user_email ILIKE $1
       ORDER BY display_name NULLS LAST
       LIMIT $2`,
      [like, limit]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const users = rows
      .map((r) => sanitizeUserProfileRecord(r))
      .map((r) => ({
        user_id: r?.user_id ?? null,
        email: r?.user_email ?? null,
        display_name: r?.display_name ?? null,
        username: r?.username ?? null,
        profile_photo_url: r?.profile_photo_url ?? null,
        location: r?.location ?? null,
        movement_group_opt_out: !!r?.movement_group_opt_out,
      }))
      .filter((r) => r.email && !isBlockedForViewer(r.email, viewerBlocks));
    return reply.send({ users });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to search users');
    return reply.code(500).send({ error: 'Failed to search users' });
  }
});

fastify.post('/users/lookup', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const viewerBlocks = await getUserBlockSets(authedUser.email);
  const schema = z
    .object({
      emails: z.array(z.string().email()).max(50).optional(),
      user_ids: z.array(z.string().min(1)).max(50).optional(),
    })
    .refine((v) => (Array.isArray(v.emails) && v.emails.length) || (Array.isArray(v.user_ids) && v.user_ids.length), {
      message: 'Provide emails or user_ids',
    });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  if (!hasDatabaseUrl) return reply.send({ users: [] });

  try {
    await ensureUserProfilesTable();

    const emails = (parsed.data.emails || []).map((e) => String(e).trim().toLowerCase());
    const userIds = (parsed.data.user_ids || []).map((id) => String(id).trim()).filter(Boolean);

    const res = await pool.query(
      `SELECT user_id, user_email, display_name, username, profile_photo_url, location, movement_group_opt_out
       FROM user_profiles
       WHERE (COALESCE(array_length($1::text[], 1), 0) > 0 AND user_email = ANY($1))
          OR (COALESCE(array_length($2::text[], 1), 0) > 0 AND user_id = ANY($2))`,
      [emails, userIds]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const users = rows
      .map((r) => sanitizeUserProfileRecord(r))
      .map((r) => ({
        user_id: r?.user_id ?? null,
        email: r?.user_email ?? null,
        display_name: r?.display_name ?? null,
        username: r?.username ?? null,
        profile_photo_url: r?.profile_photo_url ?? null,
        location: r?.location ?? null,
        movement_group_opt_out: !!r?.movement_group_opt_out,
      }))
      .filter((r) => r.email && !isBlockedForViewer(r.email, viewerBlocks));
    return reply.send({ users });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to lookup users');
    return reply.code(500).send({ error: 'Failed to lookup users' });
  }
});

// Public movement search (safe fields only, no emails).
fastify.get('/search/movements', { config: { rateLimit: RATE_LIMITS.search } }, async (request, reply) => {
  try {
    const q = cleanText(request.query?.q, 160);
    const city = cleanText(request.query?.city, MAX_TEXT_LENGTHS.locationLabel);
    const country = cleanText(request.query?.country, MAX_TEXT_LENGTHS.locationLabel);
    const viewerEmail = await getOptionalAuthedEmail(request);
    const viewerBlocks = viewerEmail ? await getUserBlockSets(viewerEmail) : null;
    const limitRaw = request.query?.limit;
    const offsetRaw = request.query?.offset;
    const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(50, Number(limitRaw))) : 20;
    const offset = Number.isFinite(Number(offsetRaw)) ? Math.max(0, Number(offsetRaw)) : 0;

    function stripHtml(text) {
      return String(text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function buildSummary(record) {
      const existing = record?.summary != null ? String(record.summary).trim() : '';
      if (existing) return existing;
      const source = record?.description || record?.description_html || '';
      const plain = stripHtml(source);
      if (!plain) return '';
      return plain.length > 200 ? `${plain.slice(0, 200)}…` : plain;
    }

    function safeMovement(record) {
      const authorEmail = normalizeEmail(record?.author_email || record?.creator_email || '');
      const creatorIsAdmin = authorEmail ? getStaffRoleForEmail(authorEmail) === 'admin' : false;
      return {
        id: record?.id ?? null,
        title: record?.title ?? record?.name ?? null,
        summary: buildSummary(record),
        tags: normalizeTags(record?.tags ?? record?.tag_list ?? record?.categories),
        location_city: record?.location_city ?? record?.city ?? null,
        location_region: record?.location_region ?? record?.region ?? null,
        location_country: record?.location_country ?? record?.country ?? null,
        created_at: record?.created_at ?? record?.created_date ?? null,
        momentum_score: record?.momentum_score ?? record?.score ?? null,
        verified_participants: record?.verified_participants ?? null,
        creator_display_name: record?.creator_display_name ?? record?.author_display_name ?? null,
        creator_username: record?.creator_username ?? record?.author_username ?? null,
        creator_profile_photo_url: record?.creator_profile_photo_url ?? null,
        creator_is_admin: creatorIsAdmin,
      };
    }

    const qLower = q.toLowerCase();
    const cityLower = city.toLowerCase();
    const countryLower = country.toLowerCase();

    const applyFilters = (record) => {
      if (qLower) {
        const title = String(record?.title || record?.name || '').toLowerCase();
        const summary = buildSummary(record).toLowerCase();
        const desc = stripHtml(record?.description || record?.description_html || '').toLowerCase();
        const tags = normalizeTags(record?.tags ?? record?.tag_list ?? record?.categories).join(' ').toLowerCase();
        const hay = `${title} ${summary} ${desc} ${tags}`;
        if (!hay.includes(qLower)) return false;
      }
      if (cityLower) {
        const recordCity = String(record?.location_city || record?.city || '').toLowerCase();
        if (!recordCity.includes(cityLower)) return false;
      }
      if (countryLower) {
        const recordCountry = String(record?.location_country || record?.country || '').toLowerCase();
        if (!recordCountry.includes(countryLower)) return false;
      }
      return true;
    };

    const scoreRecord = (record) => {
      const title = String(record?.title || record?.name || '').toLowerCase();
      const summary = buildSummary(record).toLowerCase();
      const desc = stripHtml(record?.description || record?.description_html || '').toLowerCase();
      const tags = normalizeTags(record?.tags ?? record?.tag_list ?? record?.categories).join(' ').toLowerCase();
      const hay = `${title} ${summary} ${desc} ${tags}`;
      let score = 0;
      if (qLower) {
        if (title.includes(qLower)) score += 3;
        if (summary.includes(qLower)) score += 2;
        if (desc.includes(qLower)) score += 1;
        if (tags.includes(qLower)) score += 1;
        const words = qLower.split(/\s+/).filter(Boolean);
        score += words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
      }
      const momentum = Number(record?.momentum_score ?? record?.score ?? 0);
      if (Number.isFinite(momentum)) score += momentum * 0.01;
      return score;
    };

    const canViewMovement = (movement) => {
      if (!viewerBlocks) return true;
      const authorEmail = normalizeEmail(movement?.author_email || movement?.creator_email || '');
      return !isBlockedForViewer(authorEmail, viewerBlocks);
    };

    if (!hasDatabaseUrl) {
      const filtered = memoryMovements.filter(applyFilters).filter(canViewMovement);
      const scored = filtered
        .map((m) => ({ record: m, score: scoreRecord(m) }))
        .sort((a, b) => b.score - a.score);
      const page = scored.slice(offset, offset + limit).map((s) => s.record);
      const enriched = await attachCreatorProfilesToMovements(page);
      return reply.send({ ok: true, movements: enriched.map(safeMovement) });
    }

    const values = [];
    const where = [];
    let qParamIndex = null;
    if (qLower) {
      qParamIndex = values.push(`%${q}%`);
      where.push(
        `(m.title ILIKE $${qParamIndex} OR m.summary ILIKE $${qParamIndex} OR m.description ILIKE $${qParamIndex} OR m.tags::text ILIKE $${qParamIndex})`
      );
    }
    if (cityLower) {
      const idx = values.push(`%${city}%`);
      where.push(`(COALESCE(m.location_city, m.city) ILIKE $${idx})`);
    }
    if (countryLower) {
      const idx = values.push(`%${country}%`);
      where.push(`(COALESCE(m.location_country, m.country) ILIKE $${idx})`);
    }

    const relevance =
      qParamIndex != null
        ? `(
            (CASE WHEN m.title ILIKE $${qParamIndex} THEN 3 ELSE 0 END) +
            (CASE WHEN m.summary ILIKE $${qParamIndex} THEN 2 ELSE 0 END) +
            (CASE WHEN m.description ILIKE $${qParamIndex} THEN 1 ELSE 0 END) +
            (CASE WHEN m.tags::text ILIKE $${qParamIndex} THEN 1 ELSE 0 END)
          )`
        : '0';

    const limitIdx = values.push(limit);
    const offsetIdx = values.push(offset);
    const sql =
      `SELECT m.*
       FROM movements m` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY ${relevance} DESC, COALESCE(m.momentum_score, 0) DESC, m.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const res = await pool.query(sql, values);
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const enriched = await attachCreatorProfilesToMovements(rows);
    const visible = enriched.filter(canViewMovement);
    return reply.send({ ok: true, movements: visible.map(safeMovement) });
  } catch (e) {
    fastify.log.error({ err: e }, 'Movement search failed');
    return reply.code(500).send({ ok: false, error: 'Search failed' });
  }
});

// Authenticated user search (safe fields only, no emails).
fastify.get('/search/users', { config: { rateLimit: RATE_LIMITS.search } }, async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  try {
    const viewerBlocks = await getUserBlockSets(authedUser.email);
    const q = cleanText(request.query?.q, 120);
    const limitRaw = request.query?.limit;
    const offsetRaw = request.query?.offset;
    const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(50, Number(limitRaw))) : 20;
    const offset = Number.isFinite(Number(offsetRaw)) ? Math.max(0, Number(offsetRaw)) : 0;

    if (!q) return reply.send({ ok: true, users: [] });

    const qLower = q.toLowerCase();

    const toSafeProfile = (profile) => {
      const email = normalizeEmail(profile?.user_email || profile?.email || '');
      const isAdmin = email ? getStaffRoleForEmail(email) === 'admin' : false;
      if (isBlockedForViewer(email, viewerBlocks)) return null;
      return {
        user_id: profile?.user_id ?? null,
        display_name: profile?.display_name ?? null,
        username: profile?.username ?? null,
        profile_photo_url: profile?.profile_photo_url ?? null,
        location: profile?.location ? sanitizeProfileLocation(profile.location) : null,
        is_admin: isAdmin,
      };
    };

    if (!hasDatabaseUrl) {
      const matches = [];
      for (const profile of memoryUserProfiles.values()) {
        const display = String(profile?.display_name || '').toLowerCase();
        const username = String(profile?.username || '').toLowerCase();
        if (display.includes(qLower) || username.includes(qLower)) {
          matches.push(toSafeProfile(profile));
        }
      }
      const filtered = matches.filter(Boolean);
      return reply.send({ ok: true, users: filtered.slice(offset, offset + limit) });
    }

    await ensureUserProfilesTable();
    const like = `%${q}%`;
    const res = await pool.query(
      `SELECT user_id, user_email, display_name, username, profile_photo_url, location
       FROM user_profiles
       WHERE display_name ILIKE $1 OR username ILIKE $1
       ORDER BY display_name NULLS LAST
       LIMIT $2 OFFSET $3`,
      [like, limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const mapped = rows.map(toSafeProfile).filter(Boolean);
    return reply.send({ ok: true, users: mapped });
  } catch (e) {
    fastify.log.error({ err: e }, 'User search failed');
    return reply.code(500).send({ ok: false, error: 'Search failed' });
  }
});

// Update or create the current user's profile with username uniqueness enforced.
async function handleGetMyProfile(request, reply) {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const userIdRaw = authedUser?.id != null ? String(authedUser.id).trim() : '';
  const userId = userIdRaw || null;
  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });
  const includeMetaRaw = String(request.query?.include_meta || '').trim().toLowerCase();
  const includeMeta = includeMetaRaw === '1' || includeMetaRaw === 'true' || includeMetaRaw === 'yes';
  const staffRole = getStaffRoleForUser(authedUser) || 'user';
  const meta = { staff_role: staffRole };

  if (!hasDatabaseUrl) {
    const existing = memoryUserProfiles.get(email) || null;
    if (existing) {
      const payload = { profile: sanitizeUserProfileRecord(existing) };
      return reply.send(includeMeta ? { ...payload, meta } : payload);
    }
    const fallback = {
      id: randomUUID(),
      user_id: userId,
      user_email: email,
      display_name: null,
      username: normalizeUsername(String(email).split('@')[0] || '') || null,
      bio: null,
      profile_photo_url: null,
      banner_url: null,
      banner_offset_y: 0,
      is_private: false,
      last_seen_update_version: null,
      has_seen_tutorial_v2: false,
      location: null,
      catchment_radius_km: null,
      skills: null,
      ai_features_enabled: false,
      movement_group_opt_out: false,
      email_notifications_opt_in: false,
      birthdate: null,
      age_verified: false,
      onboarding_completed: false,
      onboarding_current_step: 0,
      onboarding_interests: [],
      onboarding_completed_tutorials: [],
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    memoryUserProfiles.set(email, fallback);
    const payload = { profile: sanitizeUserProfileRecord(fallback) };
    return reply.send(includeMeta ? { ...payload, meta } : payload);
  }

  try {
    await ensureUserProfilesTable();
    let row = null;
    if (userId) {
      const byId = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1 LIMIT 1', [userId]);
      row = byId.rows?.[0] || null;
    }
    if (!row) {
      const byEmail = await pool.query('SELECT * FROM user_profiles WHERE user_email = $1 LIMIT 1', [email]);
      row = byEmail.rows?.[0] || null;
      if (row?.id && userId && !row.user_id) {
        await pool.query('UPDATE user_profiles SET user_id = $1, updated_at = NOW() WHERE id = $2', [userId, row.id]);
        row = { ...row, user_id: userId };
      }
    }

    if (!row) {
      const id = randomUUID();
      const now = nowIso();
      await pool.query(
        'INSERT INTO user_profiles (id, user_id, user_email, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
        [id, userId, email, now]
      );
      row = {
        id,
        user_id: userId,
        user_email: email,
        display_name: null,
        username: null,
        bio: null,
        profile_photo_url: null,
        banner_url: null,
        banner_offset_y: 0,
        is_private: false,
        last_seen_update_version: null,
        has_seen_tutorial_v2: false,
        location: null,
        catchment_radius_km: null,
        skills: null,
        ai_features_enabled: false,
        movement_group_opt_out: false,
        email_notifications_opt_in: false,
        birthdate: null,
        age_verified: false,
        onboarding_completed: false,
        onboarding_current_step: 0,
        onboarding_interests: [],
        onboarding_completed_tutorials: [],
        created_at: now,
        updated_at: now,
      };
    }
    const profile = sanitizeUserProfileRecord(row || null);
    const payload = { profile };
    return reply.send(includeMeta ? { ...payload, meta } : payload);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load user profile');
    return reply.code(500).send({ error: 'Failed to load profile' });
  }
}

async function handlePostMyProfile(request, reply) {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const userIdRaw = authedUser?.id != null ? String(authedUser.id).trim() : '';
  const userId = userIdRaw || null;
  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const schema = z.object({
    display_name: z.string().max(MAX_TEXT_LENGTHS.profileDisplayName).optional().nullable(),
    username: z.string().max(MAX_TEXT_LENGTHS.profileUsername).optional().nullable(),
    bio: z.string().max(MAX_TEXT_LENGTHS.profileBio).optional().nullable(),
    profile_photo_url: z.string().max(MAX_TEXT_LENGTHS.profilePhotoUrl).optional().nullable(),
    banner_url: z.string().max(MAX_TEXT_LENGTHS.profileBannerUrl).optional().nullable(),
    banner_offset_y: z.number().min(-1).max(1).optional().nullable(),
    is_private: z.boolean().optional(),
    last_seen_update_version: z.string().max(64).optional().nullable(),
    has_seen_tutorial_v2: z.boolean().optional(),
    location: z.record(z.string(), z.any()).optional().nullable(),
    catchment_radius_km: z.number().int().min(1).max(1000).optional().nullable(),
    skills: z.array(z.string().max(MAX_TEXT_LENGTHS.profileSkill)).max(50).optional().nullable(),
    ai_features_enabled: z.boolean().optional(),
    movement_group_opt_out: z.boolean().optional(),
    email_notifications_opt_in: z.boolean().optional(),
    birthdate: z.string().max(32).optional().nullable(),
    age_verified: z.boolean().optional(),
    onboarding_completed: z.boolean().optional(),
    onboarding_current_step: z.number().int().min(0).max(100).optional(),
    onboarding_interests: z.array(z.string().max(64)).max(50).optional().nullable(),
    onboarding_completed_tutorials: z.array(z.string().max(64)).max(100).optional().nullable(),
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid profile payload' });
  }

  const normalizedUsername = normalizeUsername(parsed.data.username);
  if (normalizedUsername && !isValidUsername(normalizedUsername)) {
    return reply.code(400).send({ error: 'Invalid username format' });
  }

  const clampBannerOffsetY = (value, fallback = 0) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(-1, Math.min(1, value));
  };

  const normalizeUpdateVersion = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    // Light validation: keep it URL-safe + human-safe.
    // Examples: 2026-01-SoftLaunch, v1.2.3, 2026_01
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(raw)) return null;
    return raw;
  };

  const buildNextProfile = (existing) => ({
    display_name: parsed.data.display_name != null ? cleanText(parsed.data.display_name, MAX_TEXT_LENGTHS.profileDisplayName) : existing?.display_name ?? null,
    username: normalizedUsername ?? existing?.username ?? null,
    bio: parsed.data.bio != null ? cleanText(parsed.data.bio, MAX_TEXT_LENGTHS.profileBio) : existing?.bio ?? null,
    profile_photo_url: parsed.data.profile_photo_url != null ? String(parsed.data.profile_photo_url).trim() || null : existing?.profile_photo_url ?? null,
    banner_url: parsed.data.banner_url != null ? String(parsed.data.banner_url).trim() || null : existing?.banner_url ?? null,
    banner_offset_y:
      parsed.data.banner_offset_y != null
        ? clampBannerOffsetY(Number(parsed.data.banner_offset_y), existing?.banner_offset_y ?? 0)
        : (existing?.banner_offset_y ?? 0),
    is_private: parsed.data.is_private != null ? !!parsed.data.is_private : existing?.is_private ?? false,
    last_seen_update_version:
      parsed.data.last_seen_update_version !== undefined
        ? (parsed.data.last_seen_update_version === null ? null : (normalizeUpdateVersion(parsed.data.last_seen_update_version) ?? (existing?.last_seen_update_version ?? null)))
        : (existing?.last_seen_update_version ?? null),
    has_seen_tutorial_v2:
      parsed.data.has_seen_tutorial_v2 != null ? !!parsed.data.has_seen_tutorial_v2 : existing?.has_seen_tutorial_v2 ?? false,
    location: parsed.data.location != null ? sanitizeProfileLocation(parsed.data.location) : existing?.location ?? null,
    catchment_radius_km: parsed.data.catchment_radius_km != null ? Number(parsed.data.catchment_radius_km) : existing?.catchment_radius_km ?? null,
    skills: parsed.data.skills != null ? parsed.data.skills.map((s) => cleanText(s, MAX_TEXT_LENGTHS.profileSkill)).filter(Boolean) : existing?.skills ?? null,
    ai_features_enabled: parsed.data.ai_features_enabled != null ? !!parsed.data.ai_features_enabled : existing?.ai_features_enabled ?? false,
    movement_group_opt_out: parsed.data.movement_group_opt_out != null ? !!parsed.data.movement_group_opt_out : existing?.movement_group_opt_out ?? false,
    email_notifications_opt_in: parsed.data.email_notifications_opt_in != null ? !!parsed.data.email_notifications_opt_in : existing?.email_notifications_opt_in ?? false,
    birthdate:
      parsed.data.birthdate !== undefined
        ? (String(parsed.data.birthdate || '').trim() || null)
        : (existing?.birthdate ?? null),
    age_verified: parsed.data.age_verified != null ? !!parsed.data.age_verified : existing?.age_verified ?? false,
    onboarding_completed:
      parsed.data.onboarding_completed != null ? !!parsed.data.onboarding_completed : existing?.onboarding_completed ?? false,
    onboarding_current_step:
      parsed.data.onboarding_current_step != null
        ? Number(parsed.data.onboarding_current_step)
        : (existing?.onboarding_current_step ?? 0),
    onboarding_interests:
      parsed.data.onboarding_interests !== undefined
        ? (Array.isArray(parsed.data.onboarding_interests) ? parsed.data.onboarding_interests.filter(Boolean) : [])
        : (existing?.onboarding_interests ?? []),
    onboarding_completed_tutorials:
      parsed.data.onboarding_completed_tutorials !== undefined
        ? (Array.isArray(parsed.data.onboarding_completed_tutorials) ? parsed.data.onboarding_completed_tutorials.filter(Boolean) : [])
        : (existing?.onboarding_completed_tutorials ?? []),
  });

  if (!hasDatabaseUrl) {
    const now = nowIso();
    if (normalizedUsername) {
      for (const [otherEmail, profile] of memoryUserProfiles.entries()) {
        if (normalizeEmail(otherEmail) === email) continue;
        const otherUsername = normalizeUsername(profile?.username);
        if (otherUsername && otherUsername === normalizedUsername) {
          return reply.code(409).send({ error: 'USERNAME_TAKEN', message: 'That username is already taken.' });
        }
      }
    }
    const existing = memoryUserProfiles.get(email) || {
      id: randomUUID(),
      user_id: userId,
      user_email: email,
      created_at: now,
      updated_at: now,
      movement_group_opt_out: false,
      email_notifications_opt_in: false,
      banner_offset_y: 0,
      is_private: false,
      last_seen_update_version: null,
      has_seen_tutorial_v2: false,
      birthdate: null,
      age_verified: false,
      onboarding_completed: false,
      onboarding_current_step: 0,
      onboarding_interests: [],
      onboarding_completed_tutorials: [],
    };
    const next = buildNextProfile(existing);
    const merged = {
      ...existing,
      ...next,
      user_id: existing.user_id ?? userId,
      updated_at: now,
      created_at: existing.created_at || now,
    };
    memoryUserProfiles.set(email, merged);
    return reply.send({ profile: sanitizeUserProfileRecord(merged) });
  }

  try {
    await ensureUserProfilesTable();

    if (normalizedUsername) {
      const dup = await pool.query(
        `SELECT 1
         FROM user_profiles
         WHERE LOWER(username) = LOWER($1)
           AND NOT (
             (user_id IS NOT NULL AND user_id = $2)
             OR user_email = $3
           )
         LIMIT 1`,
        [normalizedUsername, userId, email]
      );
      if (dup.rows?.length) {
        return reply.code(409).send({ error: 'USERNAME_TAKEN', message: 'That username is already taken.' });
      }
    }

    let existing = null;
    if (userId) {
      const byId = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1 LIMIT 1', [userId]);
      existing = byId.rows?.[0] || null;
    }
    if (!existing) {
      const byEmail = await pool.query('SELECT * FROM user_profiles WHERE user_email = $1 LIMIT 1', [email]);
      existing = byEmail.rows?.[0] || null;
      if (existing?.id && userId && !existing.user_id) {
        await pool.query('UPDATE user_profiles SET user_id = $1, updated_at = NOW() WHERE id = $2', [userId, existing.id]);
        existing = { ...existing, user_id: userId };
      }
    }

    const next = buildNextProfile(existing);

    const now = nowIso();
    if (existing?.id) {
      await pool.query(
        `UPDATE user_profiles
         SET user_email = $2,
             user_id = $3,
             display_name = $4,
             username = $5,
             bio = $6,
             profile_photo_url = $7,
             banner_url = $8,
             banner_offset_y = $9,
             is_private = $10,
             last_seen_update_version = $11,
             has_seen_tutorial_v2 = $12,
             location = $13,
             catchment_radius_km = $14,
             skills = $15,
             ai_features_enabled = $16,
             movement_group_opt_out = $17,
             email_notifications_opt_in = $18,
             birthdate = $19,
             age_verified = $20,
             onboarding_completed = $21,
             onboarding_current_step = $22,
             onboarding_interests = $23,
             onboarding_completed_tutorials = $24,
             updated_at = $25
         WHERE id = $1`,
        [
          existing.id,
          email,
          userId,
          next.display_name,
          next.username,
          next.bio,
          next.profile_photo_url,
          next.banner_url,
          next.banner_offset_y,
          next.is_private,
          next.last_seen_update_version,
          next.has_seen_tutorial_v2,
          next.location,
          next.catchment_radius_km,
          next.skills,
          next.ai_features_enabled,
          next.movement_group_opt_out,
          next.email_notifications_opt_in,
          next.birthdate,
          next.age_verified,
          next.onboarding_completed,
          next.onboarding_current_step,
          next.onboarding_interests,
          next.onboarding_completed_tutorials,
          now,
        ]
      );
    } else {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO user_profiles
         (id, user_id, user_email, display_name, username, bio, profile_photo_url, banner_url, banner_offset_y, is_private, last_seen_update_version, has_seen_tutorial_v2, location, catchment_radius_km, skills, ai_features_enabled, movement_group_opt_out, email_notifications_opt_in, birthdate, age_verified, onboarding_completed, onboarding_current_step, onboarding_interests, onboarding_completed_tutorials, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25)`,
        [
          id,
          userId,
          email,
          next.display_name,
          next.username,
          next.bio,
          next.profile_photo_url,
          next.banner_url,
          next.banner_offset_y,
          next.is_private,
          next.last_seen_update_version,
          next.has_seen_tutorial_v2,
          next.location,
          next.catchment_radius_km,
          next.skills,
          next.ai_features_enabled,
          next.movement_group_opt_out,
          next.email_notifications_opt_in,
          next.birthdate,
          next.age_verified,
          next.onboarding_completed,
          next.onboarding_current_step,
          next.onboarding_interests,
          next.onboarding_completed_tutorials,
          now,
        ]
      );
    }

    const updatedRes = userId
      ? await pool.query('SELECT * FROM user_profiles WHERE user_id = $1 LIMIT 1', [userId])
      : await pool.query('SELECT * FROM user_profiles WHERE user_email = $1 LIMIT 1', [email]);
    const updated = sanitizeUserProfileRecord(updatedRes.rows?.[0] || null);
    return reply.send({ profile: updated });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to upsert user profile');
    return reply.code(500).send({ error: 'Failed to update profile' });
  }
}

fastify.get('/me/profile', handleGetMyProfile);
fastify.get('/api/me/profile', handleGetMyProfile);
fastify.post('/me/profile', handlePostMyProfile);
fastify.post('/api/me/profile', handlePostMyProfile);

// Notifications (Postgres-backed; auth required)
fastify.get('/me/notifications', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const recipientEmail = normalizeEmail(authedUser.email);
  if (!recipientEmail) return reply.code(400).send({ error: 'User email is required' });

  const limitRaw = request.query?.limit;
  const offsetRaw = request.query?.offset;
  const unreadRaw = String(request.query?.unread || '').trim().toLowerCase();
  const typesRaw = String(request.query?.types || '').trim();

  const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(200, Number(limitRaw))) : 20;
  const offset = Number.isFinite(Number(offsetRaw)) ? Math.max(0, Number(offsetRaw)) : 0;
  const unreadOnly = unreadRaw === '1' || unreadRaw === 'true' || unreadRaw === 'yes';
  const types = typesRaw
    ? typesRaw
        .split(',')
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];

  if (!hasDatabaseUrl) {
    if (isProd) {
      fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: notifications memory fallback blocked in production');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    const list = memoryNotificationsByRecipient.get(recipientEmail) || [];
    const filtered = list
      .filter((n) => (unreadOnly ? !n?.is_read : true))
      .filter((n) => (types.length ? types.includes(String(n?.type || '')) : true))
      .sort((a, b) => String(b?.created_at || b?.created_date || '').localeCompare(String(a?.created_at || a?.created_date || '')));
    const page = filtered.slice(offset, offset + limit).map((n) => ({
      ...n,
      created_date: n?.created_date ?? n?.created_at ?? null,
    }));
    return reply.send({ notifications: page });
  }

  try {
    await ensureNotificationsTable();
    const res = await pool.query(
      `SELECT id, recipient_email, type, actor_name, actor_email, content_id, content_ref, content_title, metadata, is_read,
              created_at
       FROM notifications
       WHERE recipient_email = $1
         AND ($2::boolean = false OR is_read = false)
         AND (COALESCE(array_length($3::text[], 1), 0) = 0 OR type = ANY($3))
       ORDER BY created_at DESC
       LIMIT $4 OFFSET $5`,
      [recipientEmail, unreadOnly, types, limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const mapped = rows.map((r) => ({
      id: r?.id ?? null,
      recipient_email: r?.recipient_email ?? null,
      type: r?.type ?? null,
      actor_name: r?.actor_name ?? null,
      actor_email: r?.actor_email ?? null,
      content_id: r?.content_id ?? null,
      content_ref: r?.content_ref ?? null,
      content_title: r?.content_title ?? null,
      created_date: r?.created_at ? new Date(r.created_at).toISOString() : null,
      is_read: !!r?.is_read,
      metadata: r?.metadata ?? null,
    }));
    return reply.send({ notifications: mapped });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load notifications');
    return reply.code(500).send({ error: 'Failed to load notifications' });
  }
});

// Limited "search" for duplicates (auth required; recipient is always the authed user).
fastify.get('/me/notifications/search', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const recipientEmail = normalizeEmail(authedUser.email);
  if (!recipientEmail) return reply.code(400).send({ error: 'User email is required' });

  const type = request.query?.type ? String(request.query.type).trim() : null;
  const contentRef = request.query?.content_ref ? String(request.query.content_ref).trim() : null;
  const contentId = request.query?.content_id ? String(request.query.content_id).trim() : null;
  const limitRaw = request.query?.limit;
  const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(50, Number(limitRaw))) : 20;

  if (!type && !contentRef && !contentId) return reply.send({ notifications: [] });

  if (!hasDatabaseUrl) {
    if (isProd) {
      fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: notifications search memory fallback blocked in production');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    const list = memoryNotificationsByRecipient.get(recipientEmail) || [];
    const matches = list.filter((n) => {
      if (type && String(n?.type || '') !== type) return false;
      if (contentRef && String(n?.content_ref || '') !== contentRef) return false;
      if (contentId && String(n?.content_id || '') !== contentId) return false;
      return true;
    });
    return reply.send({ notifications: matches.slice(0, limit) });
  }

  try {
    await ensureNotificationsTable();
    const res = await pool.query(
      `SELECT id, recipient_email, type, actor_name, actor_email, content_id, content_ref, content_title, metadata, is_read, created_at
       FROM notifications
       WHERE recipient_email = $1
         AND ($2::text IS NULL OR type = $2)
         AND ($3::text IS NULL OR content_ref = $3)
         AND ($4::text IS NULL OR content_id = $4)
       ORDER BY created_at DESC
       LIMIT $5`,
      [recipientEmail, type, contentRef, contentId, limit]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const mapped = rows.map((r) => ({
      id: r?.id ?? null,
      recipient_email: r?.recipient_email ?? null,
      type: r?.type ?? null,
      actor_name: r?.actor_name ?? null,
      actor_email: r?.actor_email ?? null,
      content_id: r?.content_id ?? null,
      content_ref: r?.content_ref ?? null,
      content_title: r?.content_title ?? null,
      created_date: r?.created_at ? new Date(r.created_at).toISOString() : null,
      is_read: !!r?.is_read,
      metadata: r?.metadata ?? null,
    }));
    return reply.send({ notifications: mapped });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to search notifications');
    return reply.code(500).send({ error: 'Failed to search notifications' });
  }
});

fastify.post('/notifications', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const actorEmail = normalizeEmail(authedUser.email);
  if (!actorEmail) return reply.code(400).send({ error: 'User email is required' });

  const schema = z.object({
    recipient_email: z.string().email(),
    type: z.string().min(1).max(64),
    actor_name: z.string().max(120).optional().nullable(),
    actor_email: z.string().email().optional().nullable(),
    content_id: z.string().max(128).optional().nullable(),
    content_ref: z.string().max(128).optional().nullable(),
    content_title: z.string().max(200).optional().nullable(),
    created_date: z.string().max(64).optional().nullable(),
    is_read: z.boolean().optional(),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
    starts_at: z.string().max(64).optional().nullable(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const recipientEmail = normalizeEmail(parsed.data.recipient_email);
  if (!recipientEmail) return reply.code(400).send({ error: 'Invalid recipient' });

  const isSelf = recipientEmail === actorEmail;
  const actorName = parsed.data.actor_name != null ? String(parsed.data.actor_name).trim() || null : null;
  const requestedActorEmail = parsed.data.actor_email != null ? normalizeEmail(parsed.data.actor_email) : null;
  const storedActorEmail = isSelf && requestedActorEmail == null ? null : actorEmail;
  const storedActorName = isSelf && storedActorEmail == null ? (actorName || 'People Power') : actorName;

  const metadata = parsed.data.metadata && typeof parsed.data.metadata === 'object' ? parsed.data.metadata : null;
  const metaMerged = parsed.data.starts_at ? { ...(metadata || {}), starts_at: String(parsed.data.starts_at) } : metadata;

  const now = nowIso();
  const id = randomUUID();
  const record = {
    id,
    recipient_email: recipientEmail,
    type: String(parsed.data.type).trim(),
    actor_name: storedActorName,
    actor_email: storedActorEmail,
    content_id: parsed.data.content_id != null ? String(parsed.data.content_id).trim() || null : null,
    content_ref: parsed.data.content_ref != null ? String(parsed.data.content_ref).trim() || null : null,
    content_title: parsed.data.content_title != null ? String(parsed.data.content_title).trim() || null : null,
    created_date: now,
    is_read: parsed.data.is_read != null ? !!parsed.data.is_read : false,
    metadata: metaMerged,
  };

  if (!hasDatabaseUrl) {
    if (isProd) {
      fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: notifications create memory fallback blocked in production');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    const list = memoryNotificationsByRecipient.get(recipientEmail) || [];
    list.unshift({ ...record, created_at: now });
    memoryNotificationsByRecipient.set(recipientEmail, list.slice(0, 500));
    return reply.code(201).send({ notification: record });
  }

  try {
    await ensureNotificationsTable();
    await pool.query(
      `INSERT INTO notifications
       (id, recipient_email, type, actor_name, actor_email, content_id, content_ref, content_title, metadata, is_read, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        record.recipient_email,
        record.type,
        record.actor_name,
        record.actor_email,
        record.content_id,
        record.content_ref,
        record.content_title,
        record.metadata,
        record.is_read,
        now,
      ]
    );
    return reply.code(201).send({ notification: record });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create notification');
    return reply.code(500).send({ error: 'Failed to create notification' });
  }
});

fastify.post('/me/notifications/:id/read', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;
  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const id = request.params?.id ? String(request.params.id).trim() : '';
  if (!id) return reply.code(400).send({ error: 'Notification id is required' });

  if (!hasDatabaseUrl) {
    if (isProd) {
      fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: notifications read memory fallback blocked in production');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    const list = memoryNotificationsByRecipient.get(email) || [];
    const next = list.map((n) => (String(n?.id || '') === id ? { ...n, is_read: true } : n));
    memoryNotificationsByRecipient.set(email, next);
    return reply.send({ ok: true });
  }

  try {
    await ensureNotificationsTable();
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND recipient_email = $2',
      [id, email]
    );
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to mark notification read');
    return reply.code(500).send({ error: 'Failed to mark read' });
  }
});

fastify.post('/me/notifications/read', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;
  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const schema = z.object({ ids: z.array(z.string().min(1)).max(200) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });
  const ids = Array.from(new Set(parsed.data.ids.map((x) => String(x).trim()).filter(Boolean)));
  if (!ids.length) return reply.send({ ok: true });

  if (!hasDatabaseUrl) {
    if (isProd) {
      fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: notifications bulk-read memory fallback blocked in production');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    const list = memoryNotificationsByRecipient.get(email) || [];
    const set = new Set(ids);
    const next = list.map((n) => (set.has(String(n?.id || '')) ? { ...n, is_read: true } : n));
    memoryNotificationsByRecipient.set(email, next);
    return reply.send({ ok: true });
  }

  try {
    await ensureNotificationsTable();
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE recipient_email = $1 AND id = ANY($2)',
      [email, ids]
    );
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to mark notifications read');
    return reply.code(500).send({ error: 'Failed to mark read' });
  }
});

// Leadership roles (Postgres-backed; auth required)
const DEFAULT_LEADERSHIP_CAPS = {
  max_movements_created: 5,
  max_collaborator_roles: 10,
  max_events_organized: 8,
  max_petitions_created: 5,
};

function capForRoleType(roleType) {
  const rt = String(roleType || '').trim();
  const caps = DEFAULT_LEADERSHIP_CAPS;
  const roleCapMapping = {
    movement_creator: caps.max_movements_created,
    collaborator_admin: caps.max_collaborator_roles,
    collaborator_editor: caps.max_collaborator_roles,
    event_organizer: caps.max_events_organized,
    petition_creator: caps.max_petitions_created,
  };
  return roleCapMapping[rt] || 5;
}

fastify.get('/me/leadership/cap', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  if (getStaffRoleForUser(authedUser) === 'admin') {
    return reply.send({ can_create: true, current_count: 0, cap: Number.POSITIVE_INFINITY, message: null, bypassed: true });
  }

  const roleType = request.query?.role_type ? String(request.query.role_type).trim() : '';
  if (!roleType) return reply.code(400).send({ error: 'role_type is required' });

  const cap = capForRoleType(roleType);

  if (!hasDatabaseUrl) {
    if (isProd) {
      fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: leadership cap memory fallback blocked in production');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    const current = memoryLeadershipRoles.filter((r) => r?.is_active && normalizeEmail(r?.user_email) === email && String(r?.role_type || '') === roleType).length;
    const hasReachedCap = current >= cap;
    return reply.send({
      can_create: !hasReachedCap,
      current_count: current,
      cap,
      message: hasReachedCap ? `You've reached the limit of ${cap} active ${roleType.replace(/_/g, ' ')} roles.` : null,
    });
  }

  try {
    await ensureLeadershipRolesTable();
    const res = await pool.query(
      'SELECT COUNT(*)::int AS c FROM leadership_roles WHERE user_email = $1 AND role_type = $2 AND is_active = TRUE',
      [email, roleType]
    );
    const current = Number(res.rows?.[0]?.c || 0);
    const hasReachedCap = current >= cap;
    return reply.send({
      can_create: !hasReachedCap,
      current_count: current,
      cap,
      message: hasReachedCap ? `You've reached the limit of ${cap} active ${roleType.replace(/_/g, ' ')} roles.` : null,
    });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to check leadership cap');
    return reply.code(500).send({ error: 'Failed to check cap' });
  }
});

fastify.get('/leadership/counts', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const roleType = request.query?.role_type ? String(request.query.role_type).trim() : '';
  if (!roleType) return reply.code(400).send({ error: 'role_type is required' });

  if (!hasDatabaseUrl) {
    if (isProd) {
      fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: leadership counts memory fallback blocked in production');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    const counts = {};
    for (const r of memoryLeadershipRoles) {
      if (!r?.is_active) continue;
      if (String(r?.role_type || '') !== roleType) continue;
      const email = normalizeEmail(r?.user_email);
      if (!email) continue;
      counts[email] = (counts[email] || 0) + 1;
    }
    return reply.send({ counts });
  }

  try {
    await ensureLeadershipRolesTable();
    const res = await pool.query(
      'SELECT user_email, COUNT(*)::int AS c FROM leadership_roles WHERE role_type = $1 AND is_active = TRUE GROUP BY user_email',
      [roleType]
    );
    const counts = {};
    for (const row of Array.isArray(res.rows) ? res.rows : []) {
      const email = normalizeEmail(row?.user_email);
      if (!email) continue;
      counts[email] = Number(row?.c || 0);
    }
    return reply.send({ counts });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load leadership counts');
    return reply.code(500).send({ error: 'Failed to load counts' });
  }
});

fastify.post('/me/leadership/register', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const schema = z.object({
    role_type: z.string().min(1).max(64),
    movement_id: z.string().max(128).optional().nullable(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const roleType = String(parsed.data.role_type).trim();
  const movementId = parsed.data.movement_id != null ? String(parsed.data.movement_id).trim() || null : null;

  // Cap enforcement.
  if (getStaffRoleForUser(authedUser) !== 'admin') {
    const cap = capForRoleType(roleType);
    let current = 0;
    if (!hasDatabaseUrl) {
      if (isProd) {
        fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: leadership register memory fallback blocked in production');
        return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
      }
      current = memoryLeadershipRoles.filter((r) => r?.is_active && normalizeEmail(r?.user_email) === email && String(r?.role_type || '') === roleType).length;
    } else {
      await ensureLeadershipRolesTable();
      const res = await pool.query(
        'SELECT COUNT(*)::int AS c FROM leadership_roles WHERE user_email = $1 AND role_type = $2 AND is_active = TRUE',
        [email, roleType]
      );
      current = Number(res.rows?.[0]?.c || 0);
    }
    if (current >= cap) {
      return reply.code(403).send({
        error: 'CAP_REACHED',
        message: `You've reached the limit of ${cap} active ${roleType.replace(/_/g, ' ')} roles.`,
      });
    }
  }

  const now = nowIso();
  const id = randomUUID();
  const role = {
    id,
    user_email: email,
    role_type: roleType,
    movement_id: movementId,
    is_active: true,
    reached_cap: false,
    created_at: now,
    updated_at: now,
  };

  if (!hasDatabaseUrl) {
    if (isProd) {
      fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: leadership register memory fallback blocked in production');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    memoryLeadershipRoles.push(role);
    return reply.code(201).send({ role });
  }

  try {
    await ensureLeadershipRolesTable();
    await pool.query(
      `INSERT INTO leadership_roles (id, user_email, role_type, movement_id, is_active, reached_cap, created_at, updated_at)
       VALUES ($1,$2,$3,$4,TRUE,FALSE,$5,$5)
       ON CONFLICT (user_email, role_type, movement_id)
       DO UPDATE SET is_active = TRUE, updated_at = EXCLUDED.updated_at`,
      [id, email, roleType, movementId, now]
    );
    return reply.code(201).send({ role });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to register leadership role');
    return reply.code(500).send({ error: 'Failed to register role' });
  }
});

fastify.post('/me/leadership/deactivate', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const schema = z.object({
    role_type: z.string().min(1).max(64),
    movement_id: z.string().max(128).optional().nullable(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const roleType = String(parsed.data.role_type).trim();
  const movementId = parsed.data.movement_id != null ? String(parsed.data.movement_id).trim() || null : null;
  const now = nowIso();

  if (!hasDatabaseUrl) {
    if (isProd) {
      fastify.log.error({ path: request?.routerPath || request?.url }, '[storage] FATAL: leadership deactivate memory fallback blocked in production');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    for (let i = 0; i < memoryLeadershipRoles.length; i++) {
      const r = memoryLeadershipRoles[i];
      if (!r) continue;
      if (!r.is_active) continue;
      if (normalizeEmail(r.user_email) !== email) continue;
      if (String(r.role_type || '') !== roleType) continue;
      if (String(r.movement_id || '') !== String(movementId || '')) continue;
      memoryLeadershipRoles[i] = { ...r, is_active: false, updated_at: now };
    }
    return reply.send({ ok: true });
  }

  try {
    await ensureLeadershipRolesTable();
    await pool.query(
      `UPDATE leadership_roles
       SET is_active = FALSE, updated_at = $4
       WHERE user_email = $1 AND role_type = $2 AND COALESCE(movement_id, '') = COALESCE($3, '')`,
      [email, roleType, movementId, now]
    );
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to deactivate leadership role');
    return reply.code(500).send({ error: 'Failed to deactivate role' });
  }
});

// User block list (privacy safety)
fastify.get('/me/blocks', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const { blocked } = await getUserBlockSets(email);
  const blockedList = Array.from(blocked);
  const lookup = await getPublicProfilesByEmail(blockedList);
  const items = blockedList.map((blockedEmail) => {
    const profile = lookup.get(blockedEmail);
    return {
      email: blockedEmail,
      display_name: profile?.display_name ?? null,
      username: profile?.username ?? null,
      profile_photo_url: profile?.profile_photo_url ?? null,
    };
  });
  return reply.send({ blocked: items });
});

fastify.post('/me/blocks', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({ blocked_email: z.string().email() });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const blockerEmail = normalizeEmail(authedUser.email);
  const blockedEmail = normalizeEmail(parsed.data.blocked_email);
  if (!blockerEmail || !blockedEmail) return reply.code(400).send({ error: 'Invalid emails' });
  if (blockerEmail === blockedEmail) return reply.code(400).send({ error: 'Cannot block yourself' });

  if (!hasDatabaseUrl) {
    const list = memoryUserBlocks.get(blockerEmail) || new Set();
    list.add(blockedEmail);
    memoryUserBlocks.set(blockerEmail, list);
    return reply.code(201).send({ ok: true });
  }

  try {
    await ensureUserBlocksTable();
    await pool.query(
      'INSERT INTO user_blocks (blocker_email, blocked_email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [blockerEmail, blockedEmail]
    );
    return reply.code(201).send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create user block');
    return reply.code(500).send({ error: 'Failed to block user' });
  }
});

fastify.delete('/me/blocks/:email', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const blockerEmail = normalizeEmail(authedUser.email);
  if (!blockerEmail) return reply.code(400).send({ error: 'User email is required' });

  const raw = request.params?.email ? String(request.params.email) : '';
  const blockedEmail = normalizeEmail(raw);
  if (!blockedEmail) return reply.code(400).send({ error: 'Valid email is required' });

  if (!hasDatabaseUrl) {
    const list = memoryUserBlocks.get(blockerEmail) || new Set();
    list.delete(blockedEmail);
    memoryUserBlocks.set(blockerEmail, list);
    return reply.send({ ok: true });
  }

  try {
    await ensureUserBlocksTable();
    await pool.query('DELETE FROM user_blocks WHERE blocker_email = $1 AND blocked_email = $2', [
      blockerEmail,
      blockedEmail,
    ]);
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to remove user block');
    return reply.code(500).send({ error: 'Failed to unblock user' });
  }
});

// Public-ish profile lookup by username (auth required).
fastify.get('/profiles/username/:username', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const rawUsername = request.params?.username ? String(request.params.username) : '';
  const username = normalizeUsername(rawUsername);
  if (!username) return reply.code(400).send({ error: 'Username is required' });
  const viewerEmail = normalizeEmail(authedUser.email);
  const viewerBlocks = viewerEmail ? await getUserBlockSets(viewerEmail) : null;

  if (!hasDatabaseUrl) {
    const entry = Array.from(memoryUserProfiles.values()).find(
      (p) => normalizeUsername(p?.username) === username
    );
    if (!entry) return reply.code(404).send({ error: 'Profile not found' });
    if (viewerBlocks && isBlockedForViewer(entry?.user_email, viewerBlocks)) {
      return reply.code(404).send({ error: 'Profile not found' });
    }
    return reply.send({ profile: sanitizePublicUserProfileRecord(entry) });
  }

  try {
    await ensureUserProfilesTable();
    const res = await pool.query(
      'SELECT * FROM user_profiles WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username]
    );
    const profile = sanitizePublicUserProfileRecord(res.rows?.[0] || null);
    if (!profile) return reply.code(404).send({ error: 'Profile not found' });
    if (viewerBlocks && isBlockedForViewer(profile?.user_email, viewerBlocks)) {
      return reply.code(404).send({ error: 'Profile not found' });
    }
    return reply.send({ profile });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load profile by username');
    return reply.code(500).send({ error: 'Failed to load profile' });
  }
});

// Public-ish profile lookup by email (auth required).
// Used for internal navigation where we still have an email identifier.
fastify.get('/profiles/email/:email', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const raw = request.params?.email ? String(request.params.email) : '';
  const targetEmail = normalizeEmail(raw);
  if (!targetEmail) return reply.code(400).send({ error: 'Valid email is required' });

  const viewerEmail = normalizeEmail(authedUser.email);
  const viewerBlocks = viewerEmail ? await getUserBlockSets(viewerEmail) : null;

  if (!hasDatabaseUrl) {
    const entry = memoryUserProfiles.get(targetEmail) || null;
    if (!entry) return reply.code(404).send({ error: 'Profile not found' });
    if (viewerBlocks && isBlockedForViewer(entry?.user_email, viewerBlocks)) {
      return reply.code(404).send({ error: 'Profile not found' });
    }
    return reply.send({ profile: sanitizePublicUserProfileRecord(entry) });
  }

  try {
    await ensureUserProfilesTable();
    const res = await pool.query('SELECT * FROM user_profiles WHERE user_email = $1 LIMIT 1', [targetEmail]);
    const profile = sanitizePublicUserProfileRecord(res.rows?.[0] || null);
    if (!profile) return reply.code(404).send({ error: 'Profile not found' });
    if (viewerBlocks && isBlockedForViewer(profile?.user_email, viewerBlocks)) {
      return reply.code(404).send({ error: 'Profile not found' });
    }
    return reply.send({ profile });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to fetch profile by email');
    return reply.code(500).send({ error: 'Failed to load profile' });
  }
});

// Collaboration (movement collaborators / invites)

fastify.get('/movements/:id/collaborators', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const movementId = request.params?.id ? String(request.params.id) : null;
  if (!movementId) return reply.code(400).send({ error: 'Movement id is required' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const staffRole = getStaffRoleForEmail(email);
  const ownerEmail = await getMovementOwnerEmail(movementId);
  const isOwner = ownerEmail && ownerEmail === email;
  const allowAll = !!staffRole || !!isOwner;

  if (!hasDatabaseUrl) {
    const all = memoryListCollaborators(movementId);
    const isMember = allowAll || all.some((c) => normalizeEmail(c?.user_email) === email && String(c?.status || '') === 'accepted');
    if (!isMember) return reply.code(403).send({ error: 'Not allowed' });
    const visible = allowAll ? all : all.filter((c) => String(c?.status || '') === 'accepted');
    return reply.send({ collaborators: visible });
  }

  try {
    await ensureCollaboratorsTable();
    await ensureUserProfilesTable();

    const isMemberRes = await pool.query(
      'SELECT 1 FROM collaborators WHERE movement_id = $1 AND user_email = $2 AND status = $3 LIMIT 1',
      [String(movementId), email, 'accepted']
    );
    const isMember = allowAll || !!isMemberRes.rows?.[0];
    if (!isMember) return reply.code(403).send({ error: 'Not allowed' });

    const res = allowAll
      ? await pool.query(
          `SELECT c.id, c.movement_id, c.user_email, c.role, c.status, c.invited_by, c.created_date, c.accepted_date,
                  up.username AS username, up.display_name AS display_name
           FROM collaborators c
           LEFT JOIN user_profiles up ON up.user_email = c.user_email
           WHERE c.movement_id = $1
           ORDER BY c.created_date DESC`,
          [String(movementId)]
        )
      : await pool.query(
          `SELECT c.id, c.movement_id, c.user_email, c.role, c.status, c.invited_by, c.created_date, c.accepted_date,
                  up.username AS username, up.display_name AS display_name
           FROM collaborators c
           LEFT JOIN user_profiles up ON up.user_email = c.user_email
           WHERE c.movement_id = $1 AND c.status = $2
           ORDER BY c.created_date DESC`,
          [String(movementId), 'accepted']
        );

    return reply.send({ collaborators: Array.isArray(res.rows) ? res.rows : [] });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to list collaborators');
    return reply.code(500).send({ error: 'Failed to load collaborators' });
  }
});

fastify.post('/movements/:id/collaborators/invite', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const movementId = request.params?.id ? String(request.params.id) : null;
  if (!movementId) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({
    username: z.string().min(1).max(80),
    role: z.enum(['admin', 'editor', 'viewer']).optional(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const inviterEmail = normalizeEmail(authedUser.email);
  if (!inviterEmail) return reply.code(400).send({ error: 'User email is required' });

  const usernameRaw = String(parsed.data.username || '').trim().replace(/^@+/, '');
  if (!usernameRaw) return reply.code(400).send({ error: 'Username is required' });

  let invitedEmail = null;
  try {
    if (!hasDatabaseUrl) {
      // Memory mode: profiles may still exist in memory.
      const profile = Array.from(memoryUserProfiles.values()).find(
        (p) => String(p?.username || '').trim().toLowerCase() === usernameRaw.toLowerCase()
      );
      invitedEmail = normalizeEmail(profile?.user_email || profile?.email);
    } else {
      await ensureUserProfilesTable();
      const res = await pool.query(
        'SELECT user_email FROM user_profiles WHERE LOWER(username) = LOWER($1) LIMIT 1',
        [usernameRaw]
      );
      invitedEmail = normalizeEmail(res.rows?.[0]?.user_email);
    }
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to resolve username for collaborator invite');
    return reply.code(500).send({ error: 'Failed to resolve username' });
  }

  if (!invitedEmail) return reply.code(404).send({ error: 'User not found' });

  const staffRole = getStaffRoleForEmail(inviterEmail);
  const ownerEmail = await getMovementOwnerEmail(movementId);
  const isOwner = ownerEmail && ownerEmail === inviterEmail;
  if (!isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });

  const role = parsed.data.role ? String(parsed.data.role) : 'editor';
  const record = {
    id: randomUUID(),
    movement_id: String(movementId),
    user_email: invitedEmail,
    role,
    status: 'pending',
    invited_by: inviterEmail,
    created_date: nowIso(),
    accepted_date: null,
  };

  if (!hasDatabaseUrl) {
    const existing = memoryListCollaborators(movementId).some((c) => normalizeEmail(c?.user_email) === invitedEmail);
    if (existing) return reply.code(409).send({ error: 'User is already a collaborator' });
    memoryUpsertCollaborator(movementId, record);
    getMovementTitle(movementId).then((title) =>
      notifyCollaborationInvite({
        invitedEmail,
        inviterEmail,
        movementTitle: title,
        role,
      }).catch((err) => fastify.log.warn({ err }, 'Collaboration invite email failed (memory)'))
    );
    return reply.code(201).send({ collaborator: record });
  }

  try {
    await ensureCollaboratorsTable();
    const inserted = await pool.query(
      `INSERT INTO collaborators (id, movement_id, user_email, role, status, invited_by, created_date, accepted_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (movement_id, user_email) DO NOTHING
       RETURNING id, movement_id, user_email, role, status, invited_by, created_date, accepted_date`,
      [
        record.id,
        record.movement_id,
        record.user_email,
        record.role,
        record.status,
        record.invited_by,
        record.created_date,
        record.accepted_date,
      ]
    );
    const row = inserted.rows?.[0] || null;
    if (!row) return reply.code(409).send({ error: 'User is already a collaborator' });
    getMovementTitle(movementId).then((title) =>
      notifyCollaborationInvite({
        invitedEmail,
        inviterEmail,
        movementTitle: title,
        role,
      }).catch((err) => fastify.log.warn({ err }, 'Collaboration invite email failed'))
    );
    return reply.code(201).send({ collaborator: row });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to invite collaborator');
    return reply.code(500).send({ error: 'Failed to invite collaborator' });
  }
});

fastify.get('/user/collaboration-invites', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  if (!hasDatabaseUrl) {
    const invites = [];
    for (const list of memoryCollaboratorsByMovement.values()) {
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        if (normalizeEmail(c?.user_email) === email && String(c?.status || '') === 'pending') invites.push(c);
      }
    }
    invites.sort((a, b) => String(b?.created_date || '').localeCompare(String(a?.created_date || '')));
    return reply.send({ invites });
  }

  try {
    await ensureCollaboratorsTable();
    const res = await pool.query(
      `SELECT id, movement_id, user_email, role, status, invited_by, created_date, accepted_date
       FROM collaborators
       WHERE user_email = $1 AND status = $2
       ORDER BY created_date DESC`,
      [email, 'pending']
    );
    return reply.send({ invites: Array.isArray(res.rows) ? res.rows : [] });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load collaboration invites');
    return reply.code(500).send({ error: 'Failed to load invites' });
  }
});

fastify.post('/collaborators/:id/accept', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const collabId = request.params?.id ? String(request.params.id) : null;
  if (!collabId) return reply.code(400).send({ error: 'Collaborator id is required' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const now = nowIso();

  if (!hasDatabaseUrl) {
    const existing = memoryFindCollaboratorById(collabId);
    if (!existing) return reply.code(404).send({ error: 'Invite not found' });
    if (normalizeEmail(existing.user_email) !== email) return reply.code(403).send({ error: 'Not allowed' });
    const updated = { ...existing, status: 'accepted', accepted_date: now };
    memoryUpsertCollaborator(existing.movement_id, updated);
    return reply.send({ collaborator: updated });
  }

  try {
    await ensureCollaboratorsTable();
    const res = await pool.query(
      `UPDATE collaborators
       SET status = 'accepted', accepted_date = $3
       WHERE id = $1 AND user_email = $2
       RETURNING id, movement_id, user_email, role, status, invited_by, created_date, accepted_date`,
      [String(collabId), email, now]
    );
    const row = res.rows?.[0] || null;
    if (!row) return reply.code(404).send({ error: 'Invite not found' });
    return reply.send({ collaborator: row });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to accept invite');
    return reply.code(500).send({ error: 'Failed to accept invite' });
  }
});

fastify.patch('/collaborators/:id', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const collabId = request.params?.id ? String(request.params.id) : null;
  if (!collabId) return reply.code(400).send({ error: 'Collaborator id is required' });

  const schema = z.object({ role: z.enum(['admin', 'editor', 'viewer']) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const staffRole = getStaffRoleForEmail(email);

  if (!hasDatabaseUrl) {
    const existing = memoryFindCollaboratorById(collabId);
    if (!existing) return reply.code(404).send({ error: 'Collaborator not found' });
    const ownerEmail = await getMovementOwnerEmail(existing.movement_id);
    const isOwner = ownerEmail && ownerEmail === email;
    if (!isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });
    const trustScore = await getUserTrustScore(email);
    if (parsed.data.role === 'admin' && trustScore < TRUST_SCORE_THRESHOLD && staffRole !== 'admin') {
      await logCollaboratorAction({
        movement_id: existing.movement_id,
        actor_user_id: authedUser.id || authedUser.email,
        action_type: 'blocked_action',
        target_id: collabId,
        metadata: { reason: 'low_trust_promote_to_admin', trustScore, attemptedRole: parsed.data.role }
      });
      return reply.code(403).send({ error: 'This action requires a higher trust level or owner approval.' });
    }
    const updated = { ...existing, role: parsed.data.role };
    memoryUpsertCollaborator(existing.movement_id, updated);
    await logCollaboratorAction({
      movement_id: existing.movement_id,
      actor_user_id: authedUser.id || authedUser.email,
      action_type: 'change_role',
      target_id: collabId,
      metadata: { newRole: parsed.data.role }
    });
    return reply.send({ collaborator: updated });
  }

  try {
    await ensureCollaboratorsTable();
    const existingRes = await pool.query('SELECT id, movement_id FROM collaborators WHERE id = $1 LIMIT 1', [String(collabId)]);
    const existing = existingRes.rows?.[0] || null;
    if (!existing) return reply.code(404).send({ error: 'Collaborator not found' });

    const ownerEmail = await getMovementOwnerEmail(existing.movement_id);
    const isOwner = ownerEmail && ownerEmail === email;
    if (!isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });
    const trustScore = await getUserTrustScore(email);
    if (parsed.data.role === 'admin' && trustScore < TRUST_SCORE_THRESHOLD && staffRole !== 'admin') {
      await logCollaboratorAction({
        movement_id: existing.movement_id,
        actor_user_id: authedUser.id || authedUser.email,
        action_type: 'blocked_action',
        target_id: collabId,
        metadata: { reason: 'low_trust_promote_to_admin', trustScore, attemptedRole: parsed.data.role }
      });
      return reply.code(403).send({ error: 'This action requires a higher trust level or owner approval.' });
    }

    const res = await pool.query(
      `UPDATE collaborators
       SET role = $2
       WHERE id = $1
       RETURNING id, movement_id, user_email, role, status, invited_by, created_date, accepted_date`,
      [String(collabId), parsed.data.role]
    );
    await logCollaboratorAction({
      movement_id: existing.movement_id,
      actor_user_id: authedUser.id || authedUser.email,
      action_type: 'change_role',
      target_id: collabId,
      metadata: { newRole: parsed.data.role }
    });
    return reply.send({ collaborator: res.rows?.[0] || null });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to update collaborator');
    return reply.code(500).send({ error: 'Failed to update collaborator' });
  }
});

fastify.delete('/collaborators/:id', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const collabId = request.params?.id ? String(request.params.id) : null;
  if (!collabId) return reply.code(400).send({ error: 'Collaborator id is required' });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const staffRole = getStaffRoleForEmail(email);

  if (!hasDatabaseUrl) {
    const existing = memoryFindCollaboratorById(collabId);
    if (!existing) return reply.code(404).send({ error: 'Collaborator not found' });
    const ownerEmail = await getMovementOwnerEmail(existing.movement_id);
    const isOwner = ownerEmail && ownerEmail === email;
    const isSelf = normalizeEmail(existing.user_email) === email;
    if (!isSelf && !isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });
    memoryDeleteCollaborator(collabId);
    return reply.send({ ok: true });
  }

  try {
    await ensureCollaboratorsTable();
    const existingRes = await pool.query('SELECT id, movement_id, user_email FROM collaborators WHERE id = $1 LIMIT 1', [String(collabId)]);
    const existing = existingRes.rows?.[0] || null;
    if (!existing) return reply.code(404).send({ error: 'Collaborator not found' });

    const ownerEmail = await getMovementOwnerEmail(existing.movement_id);
    const isOwner = ownerEmail && ownerEmail === email;
    const isSelf = normalizeEmail(existing.user_email) === email;
    if (!isSelf && !isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });

    await pool.query('DELETE FROM collaborators WHERE id = $1', [String(collabId)]);
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to remove collaborator');
    return reply.code(500).send({ error: 'Failed to remove collaborator' });
  }
});

fastify.get('/user/export', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const exportedAt = nowIso();
  const exportPayload = {
    exported_at: exportedAt,
    warning: 'This export includes only your contributions and activity — not other users\' data.',
    user: sanitizeAuthUser(authedUser),
    profile: null,
    movements_created: [],
    comments: [],
    petitions_created: [],
    petition_signatures: [],
    event_rsvps: [],
    collaboration_roles: [],
  };

  if (!hasDatabaseUrl) {
    exportPayload.movements_created = memoryMovements
      .filter((m) => normalizeEmail(m?.author_email) === email)
      .map((m) => ({
        id: String(m?.id ?? ''),
        title: m?.title ?? null,
        created_at: m?.created_at ?? null,
        created_date: m?.created_date ?? null,
        tags: Array.isArray(m?.tags) ? m.tags : null,
        summary: m?.summary ?? m?.description ?? null,
        location_city: m?.location_city ?? null,
        location_country: m?.location_country ?? null,
      }));

    const memComments = [];
    for (const list of memoryCommentsByMovement.values()) {
      const arr = Array.isArray(list) ? list : [];
      for (const c of arr) {
        if (normalizeEmail(c?.author_email) !== email) continue;
        memComments.push({
          id: String(c?.id ?? ''),
          movement_id: String(c?.movement_id ?? ''),
          content: c?.content ?? null,
          created_at: c?.created_at ?? null,
        });
      }
    }
    exportPayload.comments = memComments;

    const memPetitions = [];
    for (const list of memoryMovementPetitionsByMovement.values()) {
      const arr = Array.isArray(list) ? list : [];
      for (const p of arr) {
        if (normalizeEmail(p?.created_by_email) !== email) continue;
        memPetitions.push({
          id: String(p?.id ?? ''),
          movement_id: String(p?.movement_id ?? ''),
          title: p?.title ?? null,
          url: p?.url ?? null,
          goal_signatures: p?.goal_signatures ?? null,
          created_at: p?.created_at ?? null,
        });
      }
    }
    exportPayload.petitions_created = memPetitions;

    const memSigs = [];
    for (const byUser of memoryPetitionSignaturesByPetition.values()) {
      for (const sig of (byUser?.values?.() || [])) {
        if (normalizeEmail(sig?.user_email) !== email) continue;
        memSigs.push({
          movement_id: String(sig?.movement_id ?? ''),
          timestamp: sig?.created_at ?? sig?.updated_at ?? null,
        });
      }
    }
    exportPayload.petition_signatures = memSigs;

    const memRsvps = [];
    for (const byUser of memoryEventRsvpsByEvent.values()) {
      for (const rsvp of (byUser?.values?.() || [])) {
        if (normalizeEmail(rsvp?.user_email) !== email) continue;
        memRsvps.push({
          event_id: String(rsvp?.event_id ?? ''),
          timestamp: rsvp?.created_at ?? rsvp?.updated_at ?? null,
        });
      }
    }
    exportPayload.event_rsvps = memRsvps;

    const collaboration_roles = [];
    for (const list of memoryCollaboratorsByMovement.values()) {
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        if (normalizeEmail(c?.user_email) !== email) continue;
        collaboration_roles.push({
          id: c?.id ?? null,
          movement_id: c?.movement_id ?? null,
          role: c?.role ?? null,
          status: c?.status ?? null,
          created_date: c?.created_date ?? null,
          accepted_date: c?.accepted_date ?? null,
        });
      }
    }
    exportPayload.collaboration_roles = collaboration_roles;

    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="peoplepower-data-export.json"')
      .send(exportPayload);
    return;
  }

  try {
    // Profile: best-effort, and sanitized.
    try {
      const profRes = await pool.query('SELECT * FROM user_profiles WHERE user_email = $1 LIMIT 1', [email]);
      exportPayload.profile = sanitizeUserProfileRecord(profRes.rows?.[0] || null);
    } catch {
      exportPayload.profile = null;
    }

    // Movements created by user (metadata only).
    try {
      const mvRes = await pool.query(
        `SELECT id, title, summary, description, created_at, created_date, tags, location_city, location_country
         FROM movements
         WHERE author_email = $1
         ORDER BY created_at DESC NULLS LAST`,
        [email]
      );
      exportPayload.movements_created = (mvRes.rows || []).map((m) => ({
        id: String(m?.id ?? ''),
        title: m?.title ?? null,
        created_at: m?.created_at ?? null,
        created_date: m?.created_date ?? null,
        tags: Array.isArray(m?.tags) ? m.tags : null,
        summary: m?.summary ?? m?.description ?? null,
        location_city: m?.location_city ?? null,
        location_country: m?.location_country ?? null,
      }));
    } catch {
      exportPayload.movements_created = [];
    }

    // Comments by user.
    try {
      const cRes = await pool.query(
        `SELECT id, movement_id, content, created_at
         FROM movement_comments
         WHERE author_email = $1
         ORDER BY created_at DESC NULLS LAST`,
        [email]
      );
      exportPayload.comments = (cRes.rows || []).map((c) => ({
        id: String(c?.id ?? ''),
        movement_id: String(c?.movement_id ?? ''),
        content: c?.content ?? null,
        created_at: c?.created_at ?? null,
      }));
    } catch {
      exportPayload.comments = [];
    }

    // Petitions created.
    try {
      await ensureMovementExtrasTables();
      const pRes = await pool.query(
        `SELECT id, movement_id, title, url, goal_signatures, created_at
         FROM movement_petitions
         WHERE created_by_email = $1
         ORDER BY created_at DESC NULLS LAST`,
        [email]
      );
      exportPayload.petitions_created = (pRes.rows || []).map((p) => ({
        id: String(p?.id ?? ''),
        movement_id: String(p?.movement_id ?? ''),
        title: p?.title ?? null,
        url: p?.url ?? null,
        goal_signatures: p?.goal_signatures ?? null,
        created_at: p?.created_at ?? null,
      }));
    } catch {
      exportPayload.petitions_created = [];
    }

    // Petition signatures (movement id + timestamp only).
    try {
      await ensureMovementExtrasTables();
      const sRes = await pool.query(
        `SELECT movement_id, created_at
         FROM movement_petition_signatures
         WHERE user_email = $1
         ORDER BY created_at DESC NULLS LAST`,
        [email]
      );
      exportPayload.petition_signatures = (sRes.rows || []).map((s) => ({
        movement_id: String(s?.movement_id ?? ''),
        timestamp: s?.created_at ?? null,
      }));
    } catch {
      exportPayload.petition_signatures = [];
    }

    // RSVPs (event id + timestamp only).
    try {
      await ensureMovementExtrasTables();
      const rRes = await pool.query(
        `SELECT event_id, created_at
         FROM movement_event_rsvps
         WHERE user_email = $1
         ORDER BY created_at DESC NULLS LAST`,
        [email]
      );
      exportPayload.event_rsvps = (rRes.rows || []).map((r) => ({
        event_id: String(r?.event_id ?? ''),
        timestamp: r?.created_at ?? null,
      }));
    } catch {
      exportPayload.event_rsvps = [];
    }

    // Collaboration roles held (best-effort; excludes invited_by and other users).
    try {
      await ensureCollaboratorsTable();
      const collabRes = await pool.query(
        `SELECT id, movement_id, role, status, created_date, accepted_date
         FROM collaborators
         WHERE user_email = $1
         ORDER BY created_date DESC NULLS LAST`,
        [email]
      );
      exportPayload.collaboration_roles = (collabRes.rows || []).map((c) => ({
        id: String(c?.id ?? ''),
        movement_id: String(c?.movement_id ?? ''),
        role: c?.role ?? null,
        status: c?.status ?? null,
        created_date: c?.created_date ?? null,
        accepted_date: c?.accepted_date ?? null,
      }));
    } catch {
      exportPayload.collaboration_roles = [];
    }

    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="peoplepower-data-export.json"')
      .send(exportPayload);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to export user data');
    return reply.code(500).send({ error: 'Failed to export data' });
  }
});

fastify.post('/conversations/:id/read', async (request, reply) => {
  const reqId = request.id;
  try {
    const authedUser = await requireVerifiedUser(request, reply);
    if (!authedUser) return;

    const myEmail = normalizeEmail(authedUser.email);
    const conversationId = request.params?.id ? String(request.params.id) : null;
    if (!myEmail) {
      fastify.log.warn({ reqId }, 'POST /conversations/:id/read: missing user email');
      return reply.code(400).send({ error: 'User email is required' });
    }
    if (!conversationId) {
      fastify.log.warn({ reqId }, 'POST /conversations/:id/read: missing conversation id');
      return reply.code(400).send({ error: 'Conversation id is required' });
    }

    if (!hasDatabaseUrl) {
      const convo = getMemoryConversationById(conversationId);
      if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
      const participants = Array.isArray(convo.participant_emails) ? convo.participant_emails.map((x) => String(x).toLowerCase()) : [];
      if (!participants.includes(myEmail)) return reply.code(403).send({ error: 'Not allowed' });
      const updated = memoryMarkConversationRead(conversationId, myEmail);
      wsBroadcastToEmails(convo?.participant_emails, {
        type: 'conversation:read',
        conversationId: String(conversationId),
        by: myEmail,
        ts: Date.now(),
      });
      return reply.send({ ok: true, updated });
    }

    await withTimeout(ensureMessagesTables(), 4000, 'ensureMessagesTables');
    const convoRes = await withTimeout(pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [conversationId]), 4000, 'load conversation');
    const convo = convoRes.rows?.[0] || null;
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    if (!(convo.participant_emails || []).map((x) => String(x).toLowerCase()).includes(myEmail)) {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const result = await withTimeout(pool.query(
      `UPDATE messages
       SET read_by = CASE
         WHEN read_by @> ARRAY[$2] THEN read_by
         ELSE array_append(read_by, $2)
       END
       WHERE conversation_id = $1
         AND sender_email <> $2`,
      [conversationId, myEmail]
    ), 5000, 'mark read');

    wsBroadcastToEmails(convo?.participant_emails, {
      type: 'conversation:read',
      conversationId: String(conversationId),
      by: myEmail,
      ts: Date.now(),
    });

    return reply.send({ ok: true, updated: result.rowCount ?? 0 });
  } catch (e) {
    const isTimeout = e && (e.code === 'PP_TIMEOUT' || e.name === 'TimeoutError');
    fastify.log.error(
      {
        reqId,
        conversationId: request.params?.id ? String(request.params.id) : null,
        isTimeout,
        timeoutLabel: e && e.label,
        timeoutMs: e && e.timeoutMs,
        err: e,
      },
      'POST /conversations/:id/read failed'
    );
    return reply.code(500).send({ error: 'Failed to mark conversation read' });
  }
});

fastify.post('/messages/:id/reactions', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({ emoji: z.string().min(1).max(16) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload' });
  }

  const myEmail = normalizeEmail(authedUser.email);
  const messageId = request.params?.id ? String(request.params.id) : null;
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });
  if (!messageId) return reply.code(400).send({ error: 'Message id is required' });

  const emoji = String(parsed.data.emoji || '').trim();
  if (!emoji) return reply.code(400).send({ error: 'Emoji is required' });
  const viewerBlocks = await getUserBlockSets(myEmail);

  if (!hasDatabaseUrl) {
    const message = memoryFindMessageById(messageId);
    if (!message) return reply.code(404).send({ error: 'Message not found' });
    if (isBlockedForViewer(message?.sender_email, viewerBlocks)) {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    const updated = memoryToggleMessageReaction(messageId, myEmail, emoji);
    if (!updated) return reply.code(404).send({ error: 'Message not found' });
    return reply.send(updated);
  }

  try {
    await ensureMessagesTables();
    const res = await pool.query(
      `SELECT m.*, c.participant_emails, c.request_status, c.blocked_by_email
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = $1
       LIMIT 1`,
      [messageId]
    );
    const row = res.rows?.[0] || null;
    if (!row) return reply.code(404).send({ error: 'Message not found' });

    const participants = Array.isArray(row.participant_emails)
      ? row.participant_emails.map((x) => String(x).toLowerCase())
      : [];
    if (!participants.includes(myEmail)) return reply.code(403).send({ error: 'Not allowed' });

    const status = String(row?.request_status || 'accepted');
    const blockedBy = normalizeEmail(row?.blocked_by_email);
    if (status === 'blocked' && blockedBy && blockedBy !== myEmail) {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    if (isBlockedForViewer(row?.sender_email, viewerBlocks)) {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const current = row.reactions && typeof row.reactions === 'object' ? row.reactions : {};
    const prev = Array.isArray(current[emoji]) ? current[emoji].map((x) => normalizeEmail(x)).filter(Boolean) : [];
    const has = prev.includes(myEmail);
    const nextList = has ? prev.filter((x) => x !== myEmail) : [...prev, myEmail];
    const next = { ...current };
    if (nextList.length) next[emoji] = nextList;
    else delete next[emoji];

    const updated = await pool.query(
      'UPDATE messages SET reactions = $2::jsonb WHERE id = $1 RETURNING *',
      [messageId, JSON.stringify(next)]
    );
    return reply.send(updated.rows?.[0] || { ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to toggle reaction');
    return reply.code(500).send({ error: 'Failed to toggle reaction' });
  }
});

const start = async () => {
  try {
    await checkDatabaseConnection();
    initRealtimeServer();
    if (hasDatabaseUrl) {
      try {
        await ensureVotesTable();
      } catch (e) {
        fastify.log.warn({ err: e }, 'Failed to ensure votes table at startup');
      }

      try {
        await ensureReportsTable();
      } catch (e) {
        fastify.log.warn({ err: e }, 'Failed to ensure reports table at startup');
      }

      try {
        await ensureMessagesTables();
      } catch (e) {
        fastify.log.warn({ err: e }, 'Failed to ensure messages tables at startup');
      }

      try {
        await ensureUserBlocksTable();
      } catch (e) {
        fastify.log.warn({ err: e }, 'Failed to ensure user blocks table at startup');
      }

      try {
        await ensureMovementExtrasTables();
      } catch (e) {
        fastify.log.warn({ err: e }, 'Failed to ensure movement extras tables at startup');
      }
    }
    fastify
      .listen({ port: PORT, host: HOST })
      .then(() => {
        fastify.log.info(`People Power API listening on http://${HOST}:${PORT}`);
      })
      .catch((err) => {
        fastify.log.error(err);
        process.exit(1);
      });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
