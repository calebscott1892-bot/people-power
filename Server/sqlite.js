// Upsert user into main users table (for proof mode)
function upsertUser(db, id, email, passwordHash) {
  db.prepare(`INSERT INTO users (id, email, password_hash, created_at, last_seen)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, password_hash=excluded.password_hash, last_seen=datetime('now')
  `).run(id, email, passwordHash);
}
// --- PROOF PACK AUTH TABLES & HELPERS ---
function ensureProofUsersTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS proof_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

function createProofUser(db, id, email, passwordHash) {
  db.prepare(`INSERT INTO proof_users (id, email, password_hash) VALUES (?, ?, ?)`)
    .run(id, email, passwordHash);
}

function getProofUserByEmail(db, email) {
  return db.prepare(`SELECT * FROM proof_users WHERE email = ?`).get(email);
}

function getProofUserById(db, id) {
  return db.prepare(`SELECT * FROM proof_users WHERE id = ?`).get(id);
}
// SQLite helper for People Power backend
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');


function resolveDbPathFromEnv() {
  const fs = require('fs');
  const envPath = process.env.C4_DB_PATH || 'server/dev.db';
  const repoRoot = require('path').resolve(__dirname, '..');
  const dbPath = require('path').isAbsolute(envPath) ? envPath : require('path').resolve(repoRoot, envPath);
  // Print and validate in proof mode
  if (process.env.C4_PROOF_PACK === '1') {
    console.log('[proof-sqlite] path=' + dbPath);
  }
  // Fail loudly if dbPath is a directory
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory()) {
    throw new Error('C4_DB_PATH is a directory: ' + dbPath);
  }
  return dbPath;
}

const DB_PATH = resolveDbPathFromEnv();

function getDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return new Database(DB_PATH);
}

function ensureUsersTable(db) {
  // Create table if missing, with correct schema
  db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    password_hash TEXT,
    last_seen TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  // Safe migrations for existing DBs
  const info = db.prepare('PRAGMA table_info(users)').all();
  const columns = info.map(c => c.name);
  if (!columns.includes('role')) {
    db.prepare("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'").run();
  }
  if (!columns.includes('password_hash')) {
    db.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run();
  }
  if (!columns.includes('last_seen')) {
    db.prepare('ALTER TABLE users ADD COLUMN last_seen TEXT').run();
  }
  if (!columns.includes('created_at')) {
    db.prepare('ALTER TABLE users ADD COLUMN created_at TEXT').run();
    db.prepare("UPDATE users SET created_at = COALESCE(created_at, datetime('now'))").run();
  }
}

module.exports = {
  getDb,
  ensureUsersTable,
  ensureProofUsersTable,
  createProofUser,
  getProofUserByEmail,
  getProofUserById,
  upsertUser,
  DB_PATH,
  resolveDbPathFromEnv,
};
