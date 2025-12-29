// --- Initialization: Fastify, dotenv, uuid ---
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
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

// --- Upload limits ---
const MAX_UPLOAD_BYTES = process.env.MAX_UPLOAD_BYTES ? parseInt(process.env.MAX_UPLOAD_BYTES, 10) : 5 * 1024 * 1024; // 5MB default
const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'application/pdf',
];

// --- Core requires ---
const { Pool } = require('pg');
const { z } = require('zod');
const BadWordsFilter = require('bad-words');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');

// ...existing code...
// All await statements must be inside async functions or route handlers.

// Create or update a feature flag
fastify.post('/admin/feature-flags', async (request, reply) => {
  const authedUser = await requireStaffUser(request, reply);
  if (!authedUser) return;
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
fastify.delete('/admin/feature-flags/:id', async (request, reply) => {
  const authedUser = await requireStaffUser(request, reply);
  if (!authedUser) return;
  const id = String(request.params.id);
  await ensureFeatureFlagsTable();
  await pool.query('DELETE FROM feature_flags WHERE id = $1', [id]);
  return reply.send({ ok: true });
});

// Fetch all feature flags (public, for frontend)
fastify.get('/feature-flags', async (_request, reply) => {
  await ensureFeatureFlagsTable();
  const res = await pool.query('SELECT * FROM feature_flags');
  return reply.send({ flags: res.rows });
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
// --- Research Mode Config API (admin-only) ---


// List all research configs
fastify.get('/admin/research-mode-configs', async (request, reply) => {
  const authedUser = await requireStaffUser(request, reply);
  if (!authedUser) return;
  await ensureResearchModeConfigTable();
  const res = await pool.query('SELECT * FROM research_mode_configs ORDER BY updated_at DESC');
  return reply.send({ configs: res.rows });
});

// Create or update a research config
fastify.post('/admin/research-mode-configs', async (request, reply) => {
  const authedUser = await requireStaffUser(request, reply);
  if (!authedUser) return;
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
fastify.delete('/admin/research-mode-configs/:id', async (request, reply) => {
  const authedUser = await requireStaffUser(request, reply);
  if (!authedUser) return;
  const id = String(request.params.id);
  await ensureResearchModeConfigTable();
  await pool.query('DELETE FROM research_mode_configs WHERE id = $1', [id]);
  return reply.send({ ok: true });
});

// Fetch merged research flags for a user or movement (public, but only returns enabled features)
fastify.get('/research-flags', async (request, reply) => {
  const { user_id, movement_id } = request.query || {};
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
  await pool.query('CREATE INDEX IF NOT EXISTS idx_research_mode_updated_at ON research_mode_configs (updated_at DESC)');
}
// GET /admin/community-health (admin-only, aggregate stats, no private content)
fastify.get('/admin/community-health', async (request, reply) => {
  const authedUser = await requireStaffUser(request, reply);
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
      } catch (e) {
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
  } catch {}
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
  } catch {}
  if (!isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });
  const { field, locked } = request.body || {};
  if (!['title','description','claims'].includes(field)) return reply.code(400).send({ error: 'Invalid field' });
  const locks = await setMovementLock(movementId, field, !!locked);
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
  } catch {}
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
  } catch {}
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
fastify.get('/admin/migrations', async (request, reply) => {
  const authedUser = await requireStaffUser(request, reply);
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
fastify.post('/admin/backup', async (request, reply) => {
  const authedUser = await requireStaffUser(request, reply);
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
      'profiles'
    ];
    const data = {};
    for (const t of tables) {
      data[t] = await exportTableToJson(t);
    }
    const fileName = `backup_${started_at.replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(backupsDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    finished_at = nowIso();
    status = 'success';
    message = `Backup completed: ${fileName}`;
    details = { tables, counts: Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])) };
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
    return reply.code(500).send({ error: message, details });
  }
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
// Uses env vars when present, otherwise falls back to the same public project creds
// used by the frontend (anon key is safe to embed).
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://frwkaysiysknenfthauo.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_aV19W7-xDXF6zuPrBgayKQ_yB3qHPoB';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Comma-separated list of admin emails.
// Example: ADMIN_EMAILS="admin@example.com,other@example.com"
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

// Comma-separated list of moderator emails.
// Example: MODERATOR_EMAILS="mod@example.com,othermod@example.com"
const MODERATOR_EMAILS = new Set(
  String(process.env.MODERATOR_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function getStaffRoleForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  if (ADMIN_EMAILS.has(normalized)) return 'admin';
  if (MODERATOR_EMAILS.has(normalized)) return 'moderator';
  return null;
}

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

const hasDatabaseUrl = !!process.env.DATABASE_URL;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
  const s = String(value ?? '').trim();
  if (!s) return '';
  const trimmed = s.slice(0, Math.max(0, maxLen));
  try {
    return profanityFilter.clean(trimmed);
  } catch {
    return trimmed;
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
      reactions JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages (conversation_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_conversations_participants_gin ON conversations USING GIN (participant_emails)');

  // Ensure new request-related columns exist even if the table predates them.
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_request BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS requester_email TEXT NULL");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS request_status TEXT NOT NULL DEFAULT 'accepted'");
  await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS blocked_by_email TEXT NULL");

  // Ensure new message-related columns exist even if the table predates them.
  await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb");
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

function normalizeEmail(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s || null;
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
  const cleanBody = cleanText(body);
  if (!cleanBody) return null;

  const message = {
    id: randomUUID(),
    conversation_id: String(conversationId),
    sender_email: String(senderEmail),
    body: cleanBody,
    created_at: nowIso(),
    read_by: [String(senderEmail).toLowerCase()],
    reactions: {},
  };
  const list = memoryMessagesByConversation.get(String(conversationId)) || [];
  list.push(message);
  memoryMessagesByConversation.set(String(conversationId), list);
  convo.updated_at = nowIso();
  return message;
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

  const { data, error } = await supabase.auth.getUser(token);
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

async function requireStaffUser(request, reply) {
  const user = await requireVerifiedUser(request, reply);
  if (!user) return null;

  const role = getStaffRoleForEmail(user.email);
  if (!role) {
    reply.code(403).send({ error: 'Staff access required' });
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

  const candidates = {
    title,
    description,
    summary: description,
    description_html: descriptionHtml,
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

// ✅ CORS: explicitly allow your frontend origin
fastify.register(require('@fastify/cors'), {
  origin: (origin, cb) => {
    // allow curl / server-to-server (no origin)
    if (!origin) return cb(null, true);
    try {
      const url = new URL(origin);
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      const isHttp = url.protocol === 'http:';
      if (isLocalhost && isHttp) return cb(null, true);
    } catch {
      // ignore
    }
    return cb(null, false);
  },
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

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

async function ensureMovementExtrasColumns() {
  if (!hasDatabaseUrl) return;
  try {
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS description_html TEXT');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS location_city TEXT');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS location_country TEXT');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS location_lon DOUBLE PRECISION');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS media_urls JSONB');
    await pool.query('ALTER TABLE movements ADD COLUMN IF NOT EXISTS claims JSONB');
    movementsColumnsCache = null;
  } catch (e) {
    fastify.log.warn({ err: e }, 'Failed to ensure movement extra columns');
  }
}

fastify.post('/uploads', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

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
  if (file.fields && file.fields['content-length'] && parseInt(file.fields['content-length'], 10) > MAX_UPLOAD_BYTES) {
    return reply.code(413).send({ error: 'File too large' });
  }

  // Enforce MIME type
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.mimetype)) {
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
    url: `/uploads/${storedName}`,
    filename: originalName,
    mime: file.mimetype,
  });
});

fastify.get('/health', async (request, reply) => {
  // Simple healthcheck: no secrets, just basic status
  return { ok: true, uptime: process.uptime() };
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
    return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
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
    return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
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

fastify.get('/db-health', async () => {
  const result = await pool.query('SELECT NOW()');
  return { dbTime: result.rows[0] };
});

fastify.get('/movements', async (request, _reply) => {
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

  const limit = parseIntParam(request.query?.limit, 50, { min: 1, max: 100 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

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
          downvotes: summary.downvotes,
          score: summary.score,
        };
      })
      .sort(sortByCreatedDesc);

    const page = merged.slice(offset, offset + limit);
    return page.map((m) => projectRecord(m, fields));
  }

  try {
    await ensureVotesTable();
    const result = await pool.query(
      `SELECT
         m.*,
         COALESCE(v.upvotes, 0)::int AS upvotes,
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
       LIMIT 500`
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
          downvotes: summary.downvotes,
          score: summary.score,
        };
      });

    const merged = [...rows, ...mergedMemory].sort(sortByCreatedDesc);
    const page = merged.slice(offset, offset + limit);
    return page.map((m) => projectRecord(m, fields));
  } catch (e) {
    fastify.log.warn({ err: e }, 'DB query failed for GET /movements; using memory fallback');
    const merged = memoryMovements
      .map((m) => {
        const summary = getMemoryVoteSummary(m?.id, null);
        return {
          ...m,
          upvotes: summary.upvotes,
          downvotes: summary.downvotes,
          score: summary.score,
        };
      })
      .sort(sortByCreatedDesc);
    const page = merged.slice(offset, offset + limit);
    return page.map((m) => projectRecord(m, fields));
  }
});

fastify.get('/movements/:id', async (request, reply) => {
  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  if (!hasDatabaseUrl) {
    const found = memoryMovements.find((m) => String(m.id) === id) || null;
    if (!found) return reply.code(404).send({ error: 'Movement not found' });
    return found;
  }

  try {
    const result = await pool.query('SELECT * FROM movements WHERE id = $1 LIMIT 1', [id]);
    const row = result.rows?.[0] || null;
    if (!row) {
      // DB is reachable but the movement might have been created via the
      // in-memory fallback path.
      const fromMemory = memoryMovements.find((m) => String(m.id) === id) || null;
      if (fromMemory) return fromMemory;
      return reply.code(404).send({ error: 'Movement not found' });
    }
    return row;
  } catch (e) {
    fastify.log.warn({ err: e }, 'DB query failed for GET /movements/:id; using list fallback');
    try {
      const all = await pool.query('SELECT * FROM movements ORDER BY created_at DESC LIMIT 50');
      const found = all.rows.find((m) => String(m.id) === id) || null;
      if (!found) {
        const fromMemory = memoryMovements.find((m) => String(m.id) === id) || null;
        if (fromMemory) return fromMemory;
        return reply.code(404).send({ error: 'Movement not found' });
      }
      return found;
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

fastify.post('/movements/:id/follow', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({ following: z.boolean() });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid follow payload', details: parsed.error.issues });
  }

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

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

  if (!hasDatabaseUrl) {
    const followedIds = new Set();
    for (const [movementId, set] of memoryMovementFollows.entries()) {
      if (set && set.has(myEmail)) followedIds.add(String(movementId));
    }
    const movements = memoryMovements.filter((m) => followedIds.has(String(m?.id)));
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

    return reply.send({ movements: Array.isArray(result.rows) ? result.rows : [] });
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
    return reply.code(400).send({ error: 'Invalid settings payload', details: parsed.error.issues });
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

  const limit = parseIntParam(request.query?.limit, 50, { min: 1, max: 200 });
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
    const page = sorted.slice(offset, offset + limit);
    return reply.send({ comments: page.map((c) => projectRecord(c, fields)) });
  }

  try {
    await ensureMovementCommentsTables();
    const res = await pool.query(
      'SELECT id, movement_id, author_email, content, created_at FROM movement_comments WHERE movement_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    return reply.send({ comments: rows.map((c) => projectRecord(c, fields)) });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load comments');
    return reply.code(500).send({ error: 'Failed to load comments' });
  }
});

fastify.post('/movements/:id/comments', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  const schema = z.object({ content: z.string().min(1).max(2000) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid comment payload', details: parsed.error.issues });
  }

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const content = cleanText(parsed.data.content);

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
    return reply.code(201).send({ comment: insertRes.rows?.[0] || comment });
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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

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
    if (!isAdmin && owner !== email) return reply.code(403).send({ error: 'Not allowed' });
    memoryDeleteResourceById(resourceId);
    return reply.send({ ok: true });
  }

  try {
    await ensureMovementExtrasTables();
    const existingRes = await pool.query('SELECT id, created_by_email FROM movement_resources WHERE id = $1 LIMIT 1', [String(resourceId)]);
    const existing = existingRes.rows?.[0] || null;
    if (!existing) return reply.code(404).send({ error: 'Resource not found' });

    const owner = normalizeEmail(existing.created_by_email);
    if (!isAdmin && owner !== email) return reply.code(403).send({ error: 'Not allowed' });

    await pool.query('DELETE FROM movement_resources WHERE id = $1', [String(resourceId)]);
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to delete resource');
    return reply.code(500).send({ error: 'Failed to delete resource' });
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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

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

fastify.post('/petitions/:id/sign', async (request, reply) => {
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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

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
    return reply.send({ tasks: page.map((t) => projectRecord(t, fields)) });
  }

  try {
    await ensureMovementExtrasTables();
    const res = await pool.query(
      'SELECT * FROM movement_tasks WHERE movement_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    return reply.send({ tasks: rows.map((t) => projectRecord(t, fields)) });
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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

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
    return reply.code(201).send({ task: memoryAppendExtra(memoryMovementTasksByMovement, id, row) });
  }

  try {
    await ensureMovementExtrasTables();
    const inserted = await pool.query(
      `INSERT INTO movement_tasks (id, movement_id, title, description, status, assigned_to_email, created_by_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [row.id, row.movement_id, row.title, row.description, row.status, row.assigned_to_email, row.created_by_email]
    );
    return reply.code(201).send({ task: inserted.rows?.[0] || row });
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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

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
    return reply.send({ messages: page.map((m) => projectRecord(m, fields)) });
  }

  try {
    await ensureMovementExtrasTables();
    const res = await pool.query(
      'SELECT * FROM movement_discussions WHERE movement_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [String(id), limit, offset]
    );
    const rows = Array.isArray(res.rows) ? res.rows : [];
    return reply.send({ messages: rows.map((m) => projectRecord(m, fields)) });
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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const row = {
    id: randomUUID(),
    movement_id: String(id),
    author_email: email,
    message: cleanText(parsed.data.message),
    created_at: nowIso(),
  };

  if (!hasDatabaseUrl) {
    return reply.code(201).send({ message: memoryAppendExtra(memoryMovementDiscussionsByMovement, id, row) });
  }

  try {
    await ensureMovementExtrasTables();
    const inserted = await pool.query(
      `INSERT INTO movement_discussions (id, movement_id, author_email, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [row.id, row.movement_id, row.author_email, row.message]
    );
    return reply.code(201).send({ message: inserted.rows?.[0] || row });
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
    return reply.code(400).send({ error: 'Invalid vote payload', details: parsed.error.issues });
  }

  const value = parsed.data.value;
  const voterEmail = authedUser.email ?? null;
  if (!voterEmail) return reply.code(400).send({ error: 'User email is required' });

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

fastify.post('/movements', async (request, reply) => {
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
      title: z.string().min(1),
      description: z.string().min(1).optional(),
      description_html: z.string().min(1).optional(),
      summary: z.string().min(1).optional(),
      tags: z.union([z.array(z.string()), z.string()]).optional(),
      author_email: z.string().email().optional().nullable(),
      location_city: z.string().max(120).optional(),
      location_country: z.string().max(120).optional(),
      location_lat: z.number().optional(),
      location_lon: z.number().optional(),
      media_urls: z.array(z.string()).optional(),
      claims: z
        .array(
          z.object({
            id: z.string().optional(),
            text: z.string().min(1),
            classification: z.enum(['opinion', 'experience', 'call_to_action', 'factual']).optional(),
            evidence: z
              .array(
                z.object({
                  url: z.string().min(1),
                  filename: z.string().optional(),
                  mime: z.string().optional(),
                  size: z.number().optional(),
                })
              )
              .optional(),
          })
        )
        .optional(),
    })
    .refine((v) => !!(v.description || v.summary), {
      message: 'description is required',
      path: ['description'],
    });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({
      error: 'Invalid movement payload',
      details: parsed.error.issues,
    });
  }

  const raw = parsed.data;

  const roundCoord = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    return Number(v.toFixed(2));
  };

  const payload = {
    ...raw,
    title: cleanText(raw.title),
    description: raw.description ? cleanText(raw.description) : undefined,
    summary: raw.summary ? cleanText(raw.summary) : undefined,
    description_html: raw.description_html ? String(raw.description_html) : undefined,
    tags: normalizeTags(raw.tags).filter((t) => ALLOWED_TAGS.has(t)),
    author_email: authedUser.email ?? null,
    location_city: raw.location_city ? String(raw.location_city).trim() : undefined,
    location_country: raw.location_country ? String(raw.location_country).trim() : undefined,
    location_lat: roundCoord(raw.location_lat),
    location_lon: roundCoord(raw.location_lon),
    media_urls: Array.isArray(raw.media_urls) ? raw.media_urls.map((u) => String(u)) : undefined,
    claims: Array.isArray(raw.claims)
      ? raw.claims.map((c) => ({
          id: c.id ? String(c.id) : undefined,
          text: cleanText(c.text),
          classification: c.classification ? String(c.classification) : undefined,
          evidence: Array.isArray(c.evidence)
            ? c.evidence
                .filter((e) => e && typeof e === 'object')
                .map((e) => ({
                  url: String(e.url || ''),
                  filename: e.filename ? String(e.filename) : undefined,
                  mime: e.mime ? String(e.mime) : undefined,
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
    return reply.code(201).send(created);
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
    return reply.code(201).send(row);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create movement');

    // Crash-proof fallback: if DB insert fails (bad connection/schema/etc),
    // still allow creation in memory so the app remains usable.
    const created = {
      id: `mem-${Date.now()}`,
      title: payload.title,
      description: payload.description || payload.summary,
      description_html: payload.description_html,
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
    return reply.code(201).send(created);
  }
});

fastify.delete('/movements/:id', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const id = request.params?.id ? String(request.params.id) : null;
  if (!id) return reply.code(400).send({ error: 'Movement id is required' });

  // Memory-backed movements
  const memIdx = memoryMovements.findIndex((m) => String(m?.id) === id);
  if (memIdx !== -1) {
    const m = memoryMovements[memIdx];
    if (String(m?.author_email || '') !== String(authedUser.email || '')) {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    memoryMovements.splice(memIdx, 1);
    return reply.code(200).send({ ok: true });
  }

  if (!hasDatabaseUrl) {
    return reply.code(404).send({ error: 'Movement not found' });
  }

  try {
    const existing = await pool.query('SELECT * FROM movements WHERE id = $1 LIMIT 1', [id]);
    const row = existing.rows?.[0] || null;
    if (!row) return reply.code(404).send({ error: 'Movement not found' });

    if (String(row?.author_email || '') !== String(authedUser.email || '')) {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    await pool.query('DELETE FROM movements WHERE id = $1', [id]);
    return reply.code(200).send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to delete movement');
    return reply.code(500).send({ error: 'Failed to delete movement' });
  }
});

fastify.post('/reports', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({
    reported_content_type: z.string().min(1),
    reported_content_id: z.string().min(1),
    report_category: z.string().min(1),
    report_details: z.string().max(2000).optional().nullable(),
    evidence_urls: z.array(z.string().min(1)).max(6).optional(),
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid report payload', details: parsed.error.issues });
  }

  if (!hasDatabaseUrl) {
    return reply.code(503).send({ error: 'Reporting is unavailable (database not configured)' });
  }

  try {
    await ensureReportsTable();
    const result = await pool.query(
      `INSERT INTO reports
        (reporter_email, reported_content_type, reported_content_id, report_category, report_details, evidence_urls, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [
        String(authedUser.email || ''),
        String(parsed.data.reported_content_type),
        String(parsed.data.reported_content_id),
        String(parsed.data.report_category),
        parsed.data.report_details ? String(parsed.data.report_details) : null,
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
        },
      });
    }

    return reply.code(201).send(row ?? { ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to create report');
    return reply.code(500).send({ error: 'Failed to submit report' });
  }
});

fastify.get('/reports', async (request, reply) => {
  const staffUser = await requireStaffUser(request, reply);
  if (!staffUser) return;

  if (!hasDatabaseUrl) {
    return reply.code(503).send({ error: 'Reporting is unavailable (database not configured)' });
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

fastify.patch('/reports/:id', async (request, reply) => {
  const staffUser = await requireStaffUser(request, reply);
  if (!staffUser) return;

  const staffRole = getStaffRoleForEmail(staffUser.email);

  const rawId = request.params?.id ? String(request.params.id) : '';
  const id = Number(rawId);
  if (!Number.isFinite(id)) {
    return reply.code(400).send({ error: 'Invalid report id' });
  }

  const schema = z.object({
    status: z.enum(['pending', 'in_review', 'resolved', 'dismissed']).optional(),
    moderator_notes: z.string().max(4000).optional().nullable(),
    action_taken: z.string().max(200).optional().nullable(),
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid update payload', details: parsed.error.issues });
  }

  if (parsed.data.action_taken !== undefined && staffRole !== 'admin') {
    return reply.code(403).send({ error: 'Admin access required for action_taken' });
  }

  if (!hasDatabaseUrl) {
    return reply.code(503).send({ error: 'Reporting is unavailable (database not configured)' });
  }

  try {
    await ensureReportsTable();

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
    context: z.record(z.any()).optional().nullable(),
  });

  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid incident payload', details: parsed.error.issues });
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

fastify.get('/admin/incidents', async (request, reply) => {
  const staffUser = await requireStaffUser(request, reply);
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
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const myEmail = normalizeEmail(authedUser.email);
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });

  const type = request.query?.type ? String(request.query.type) : null;

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

  if (!hasDatabaseUrl) {
    const list = memoryListConversationsForUser(myEmail).filter((c) => {
      const status = String(c?.request_status || 'accepted');
      const blockedBy = normalizeEmail(c?.blocked_by_email);
      if (status !== 'blocked') return true;
      return !blockedBy || blockedBy === myEmail;
    });
    const filtered =
      type === 'requests'
        ? list.filter((c) => c?.request_status === 'pending')
        : type === 'inbox'
          ? list.filter((c) => c?.request_status !== 'pending' && c?.request_status !== 'declined')
          : list;

    const page = filtered.slice(offset, offset + limit).map((c) => projectRecord(c, fields));
    return reply.send(page);
  }

  try {
    await ensureMessagesTables();

    const whereExtra =
      type === 'requests'
        ? " AND c.request_status = 'pending'"
        : type === 'inbox'
          ? " AND c.request_status <> 'pending' AND c.request_status <> 'declined'"
          : '';

    const result = await pool.query(
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
    );

    const rows = result.rows || [];
    return reply.send(Array.isArray(rows) ? rows.map((c) => projectRecord(c, fields)) : []);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load conversations');
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
}

fastify.post('/conversations', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({ recipient_email: z.string().email() });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
  }

  const myEmail = normalizeEmail(authedUser.email);
  const recipient = normalizeEmail(parsed.data.recipient_email);
  if (!myEmail || !recipient) return reply.code(400).send({ error: 'Invalid emails' });
  if (myEmail === recipient) return reply.code(400).send({ error: 'Cannot message yourself' });

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
    return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
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
    return reply.send(updated.rows?.[0] || { ok: true });
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

  const limit = parseIntParam(request.query?.limit, 50, { min: 1, max: 200 });
  const offset = parseIntParam(request.query?.offset, 0, { min: 0, max: 1000000 });
  const fields = normalizeFields(request.query?.fields);

  if (!hasDatabaseUrl) {
    const convo = getMemoryConversationById(conversationId);
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    const participants = Array.isArray(convo.participant_emails) ? convo.participant_emails.map((x) => String(x).toLowerCase()) : [];
    if (!participants.includes(myEmail)) return reply.code(403).send({ error: 'Not allowed' });

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
    const page = sorted.slice(offset, offset + limit).map((m) => projectRecord(m, fields));
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
    return reply.send(Array.isArray(rows) ? rows.map((m) => projectRecord(m, fields)) : []);
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load messages');
    return reply.code(500).send({ error: 'Failed to load messages' });
  }
});

fastify.post('/conversations/:id/messages', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({ body: z.string().min(1).max(4000) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
  }

  const myEmail = normalizeEmail(authedUser.email);
  const conversationId = request.params?.id ? String(request.params.id) : null;
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });
  if (!conversationId) return reply.code(400).send({ error: 'Conversation id is required' });

  if (!hasDatabaseUrl) {
    const convo = getMemoryConversationById(conversationId);
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    const participants = Array.isArray(convo.participant_emails) ? convo.participant_emails.map((x) => String(x).toLowerCase()) : [];
    if (!participants.includes(myEmail)) return reply.code(403).send({ error: 'Not allowed' });

    const status = String(convo?.request_status || 'accepted');
    const requester = normalizeEmail(convo?.requester_email);
    const blockedBy = normalizeEmail(convo?.blocked_by_email);
    if (status === 'blocked' && blockedBy && blockedBy !== myEmail) {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    if (status === 'pending' && requester && requester !== myEmail) {
      return reply.code(403).send({ error: 'Request pending. Accept to reply.' });
    }

    const message = memoryAppendMessage(conversationId, myEmail, parsed.data.body);
    if (!message) return reply.code(400).send({ error: 'Message body is required' });
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

    const status = String(convo?.request_status || 'accepted');
    const requester = normalizeEmail(convo?.requester_email);
    const blockedBy = normalizeEmail(convo?.blocked_by_email);
    if (status === 'blocked' && blockedBy && blockedBy !== myEmail) {
      return reply.code(403).send({ error: 'Not allowed' });
    }
    if (status === 'pending' && requester && requester !== myEmail) {
      return reply.code(403).send({ error: 'Request pending. Accept to reply.' });
    }

    const id = randomUUID();
    const cleanBody = cleanText(parsed.data.body);
    const created = await pool.query(
      `INSERT INTO messages (id, conversation_id, sender_email, body, read_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, conversationId, myEmail, cleanBody, [myEmail]]
    );

    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
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

fastify.post('/users/:email/follow', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const target = normalizeEmail(request.params?.email);
  const me = normalizeEmail(authedUser.email);
  if (!target) return reply.code(400).send({ error: 'Valid email is required' });
  if (!me) return reply.code(400).send({ error: 'User email is required' });
  if (target === me) return reply.code(400).send({ error: 'Cannot follow yourself' });

  const schema = z.object({ following: z.boolean() });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
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

  if (!hasDatabaseUrl) {
    const set = memoryUserFollows.get(myEmail) || new Set();
    const users = Array.from(set).map((email) => ({ email }));
    return reply.send({ users });
  }

  try {
    await ensureUserFollowsTable();
    const result = await pool.query(
      `SELECT following_email AS email
       FROM user_follows
       WHERE follower_email = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [myEmail]
    );
    return reply.send({ users: Array.isArray(result.rows) ? result.rows : [] });
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

  if (!hasDatabaseUrl) {
    const followers = [];
    for (const [follower, set] of memoryUserFollows.entries()) {
      if (set && set.has(myEmail)) followers.push({ email: follower });
    }
    return reply.send({ users: followers });
  }

  try {
    await ensureUserFollowsTable();
    const result = await pool.query(
      `SELECT follower_email AS email
       FROM user_follows
       WHERE following_email = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [myEmail]
    );
    return reply.send({ users: Array.isArray(result.rows) ? result.rows : [] });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to load followers');
    return reply.code(500).send({ error: 'Failed to load followers' });
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

    const isMemberRes = await pool.query(
      'SELECT 1 FROM collaborators WHERE movement_id = $1 AND user_email = $2 AND status = $3 LIMIT 1',
      [String(movementId), email, 'accepted']
    );
    const isMember = allowAll || !!isMemberRes.rows?.[0];
    if (!isMember) return reply.code(403).send({ error: 'Not allowed' });

    const res = allowAll
      ? await pool.query(
          'SELECT id, movement_id, user_email, role, status, invited_by, created_date, accepted_date FROM collaborators WHERE movement_id = $1 ORDER BY created_date DESC',
          [String(movementId)]
        )
      : await pool.query(
          'SELECT id, movement_id, user_email, role, status, invited_by, created_date, accepted_date FROM collaborators WHERE movement_id = $1 AND status = $2 ORDER BY created_date DESC',
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
    user_email: z.string().email(),
    role: z.enum(['admin', 'editor', 'viewer']).optional(),
  });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

  const inviterEmail = normalizeEmail(authedUser.email);
  if (!inviterEmail) return reply.code(400).send({ error: 'User email is required' });

  const invitedEmail = normalizeEmail(parsed.data.user_email);
  if (!invitedEmail) return reply.code(400).send({ error: 'Invite email is required' });

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
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });

  const email = normalizeEmail(authedUser.email);
  if (!email) return reply.code(400).send({ error: 'User email is required' });

  const staffRole = getStaffRoleForEmail(email);
  // Trust check: block low-trust from promoting to admin
  let trustScore = await getUserTrustScore(email);
  if (parsed.data.role === 'admin' && trustScore < TRUST_SCORE_THRESHOLD && staffRole !== 'admin') {
    await logCollaboratorAction({
      movement_id: existing?.movement_id,
      actor_user_id: authedUser.id,
      action_type: 'blocked_action',
      target_id: collabId,
      metadata: { reason: 'low_trust_promote_to_admin', trustScore, attemptedRole: parsed.data.role }
    });
    return reply.code(403).send({ error: 'This action requires a higher trust level or owner approval.' });
  }
  // Trust check: block low-trust from deleting movements
  trustScore = await getUserTrustScore(email);
  if (trustScore < TRUST_SCORE_THRESHOLD && staffRole !== 'admin' && !isOwner) {
    await logCollaboratorAction({
      movement_id: id,
      actor_user_id: authedUser.id,
      action_type: 'blocked_action',
      target_id: id,
      metadata: { reason: 'low_trust_delete_movement', trustScore }
    });
    return reply.code(403).send({ error: 'This action requires a higher trust level or owner approval.' });
  }
  // Trust check: block low-trust from deleting resources (could extend to bulk deletes)
  trustScore = await getUserTrustScore(email);
  if (trustScore < TRUST_SCORE_THRESHOLD && staffRole !== 'admin' && !isOwner) {
    await logCollaboratorAction({
      movement_id: resource?.movement_id,
      actor_user_id: authedUser.id,
      action_type: 'blocked_action',
      target_id: id,
      metadata: { reason: 'low_trust_delete_resource', trustScore }
    });
    return reply.code(403).send({ error: 'This action requires a higher trust level or owner approval.' });
  }
  // Log movement edits by collaborators
  await logCollaboratorAction({
    movement_id: id,
    actor_user_id: authedUser.id,
    action_type: 'edit_movement',
    target_id: id,
    metadata: { fields: Object.keys(request.body || {}) }
  });
  // Log role changes
  await logCollaboratorAction({
    movement_id: existing?.movement_id,
    actor_user_id: authedUser.id,
    action_type: 'change_role',
    target_id: collabId,
    metadata: { newRole: parsed.data.role }
  });
  // Log resource deletes
  await logCollaboratorAction({
    movement_id: resource?.movement_id,
    actor_user_id: authedUser.id,
    action_type: 'delete_resource',
    target_id: id,
    metadata: null
  });

  if (!hasDatabaseUrl) {
    const existing = memoryFindCollaboratorById(collabId);
    if (!existing) return reply.code(404).send({ error: 'Collaborator not found' });
    const ownerEmail = await getMovementOwnerEmail(existing.movement_id);
    const isOwner = ownerEmail && ownerEmail === email;
    if (!isOwner && staffRole !== 'admin') return reply.code(403).send({ error: 'Not allowed' });
    const updated = { ...existing, role: parsed.data.role };
    memoryUpsertCollaborator(existing.movement_id, updated);
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

    const res = await pool.query(
      `UPDATE collaborators
       SET role = $2
       WHERE id = $1
       RETURNING id, movement_id, user_email, role, status, invited_by, created_date, accepted_date`,
      [String(collabId), parsed.data.role]
    );
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
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const myEmail = normalizeEmail(authedUser.email);
  const conversationId = request.params?.id ? String(request.params.id) : null;
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });
  if (!conversationId) return reply.code(400).send({ error: 'Conversation id is required' });

  if (!hasDatabaseUrl) {
    const convo = getMemoryConversationById(conversationId);
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    const participants = Array.isArray(convo.participant_emails) ? convo.participant_emails.map((x) => String(x).toLowerCase()) : [];
    if (!participants.includes(myEmail)) return reply.code(403).send({ error: 'Not allowed' });
    const updated = memoryMarkConversationRead(conversationId, myEmail);
    return reply.send({ ok: true, updated });
  }

  try {
    await ensureMessagesTables();
    const convoRes = await pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [conversationId]);
    const convo = convoRes.rows?.[0] || null;
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });
    if (!(convo.participant_emails || []).map((x) => String(x).toLowerCase()).includes(myEmail)) {
      return reply.code(403).send({ error: 'Not allowed' });
    }

    const result = await pool.query(
      `UPDATE messages
       SET read_by = CASE
         WHEN read_by @> ARRAY[$2] THEN read_by
         ELSE array_append(read_by, $2)
       END
       WHERE conversation_id = $1
         AND sender_email <> $2`,
      [conversationId, myEmail]
    );

    return reply.send({ ok: true, updated: result.rowCount ?? 0 });
  } catch (e) {
    fastify.log.error({ err: e }, 'Failed to mark conversation read');
    return reply.code(500).send({ error: 'Failed to mark conversation read' });
  }
});

fastify.post('/messages/:id/reactions', async (request, reply) => {
  const authedUser = await requireVerifiedUser(request, reply);
  if (!authedUser) return;

  const schema = z.object({ emoji: z.string().min(1).max(16) });
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
  }

  const myEmail = normalizeEmail(authedUser.email);
  const messageId = request.params?.id ? String(request.params.id) : null;
  if (!myEmail) return reply.code(400).send({ error: 'User email is required' });
  if (!messageId) return reply.code(400).send({ error: 'Message id is required' });

  const emoji = String(parsed.data.emoji || '').trim();
  if (!emoji) return reply.code(400).send({ error: 'Emoji is required' });

  if (!hasDatabaseUrl) {
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
    const port = process.env.PORT || 3001;
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
        await ensureMovementExtrasTables();
      } catch (e) {
        fastify.log.warn({ err: e }, 'Failed to ensure movement extras tables at startup');
      }
    }
    await fastify.listen({ port, host: '127.0.0.1' });
    fastify.log.info(`Server running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
