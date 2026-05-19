import fs from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';

const ROOT_ENV_FILES = ['.env.local', '.env'];
const SERVER_ENV_FILES = ['Server/.env'];

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function mergeEnv(files) {
  return files.reduce((acc, file) => ({ ...acc, ...readEnvFile(file) }), {});
}

function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function bool(value) {
  return value ? 'ok' : 'missing';
}

async function fetchStatus(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    let json = null;
    try {
      json = await res.clone().json();
    } catch {
      // ignore non-JSON bodies
    }
    return { ok: res.ok, status: res.status, json };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function dnsStatus(hostname) {
  if (!hostname) return { ok: false, error: 'missing host' };
  try {
    const rows = await dns.lookup(hostname, { all: true });
    return { ok: rows.length > 0, addresses: rows.map((r) => r.address).slice(0, 3) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function tcpStatus(hostname, port) {
  if (!hostname || !port) return { ok: false, error: 'missing host or port' };
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: hostname, port, timeout: 5000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve({ ok: true });
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    socket.once('error', (error) => {
      resolve({ ok: false, error: error?.message || String(error) });
    });
  });
}

let failedChecks = 0;

function printCheck(name, status, details = '') {
  if (!status) failedChecks += 1;
  const label = status ? 'PASS' : 'FAIL';
  const suffix = details ? ` - ${details}` : '';
  console.log(`[${label}] ${name}${suffix}`);
}

const rootEnv = { ...mergeEnv(ROOT_ENV_FILES), ...process.env };
const serverEnv = { ...mergeEnv(SERVER_ENV_FILES), ...process.env };

const backendBase =
  rootEnv.VITE_API_BASE_URL ||
  rootEnv.VITE_BACKEND_BASE ||
  `http://127.0.0.1:${serverEnv.PORT || serverEnv.PEOPLEPOWER_BACKEND_PORT || 3001}`;

const supabaseUrl = rootEnv.VITE_SUPABASE_URL || serverEnv.SUPABASE_URL || rootEnv.SUPABASE_URL;
const supabaseAnon = rootEnv.VITE_SUPABASE_ANON_KEY || serverEnv.SUPABASE_ANON_KEY || rootEnv.SUPABASE_ANON_KEY;
const databaseUrl = serverEnv.DATABASE_URL || rootEnv.DATABASE_URL;

console.log('People Power doctor');
console.log(`backend_base=${backendBase}`);

printCheck('root node_modules', fs.existsSync('node_modules'), bool(fs.existsSync('node_modules')));
printCheck('server node_modules', fs.existsSync('Server/node_modules'), bool(fs.existsSync('Server/node_modules')));

const backend = safeUrl(backendBase);
if (!backend) {
  printCheck('backend URL parses', false, 'invalid backend URL');
} else {
  printCheck('backend URL parses', true, backend.origin);
  const health = await fetchStatus(`${backend.origin}/health`);
  printCheck('backend /health', health.ok, health.status ? `HTTP ${health.status}` : health.error);
  const db = await fetchStatus(`${backend.origin}/__db`);
  const dbReady = db?.json?.dbReady === true;
  printCheck('backend /__db dbReady', dbReady, db.status ? `HTTP ${db.status}` : db.error);
}

const supabase = safeUrl(supabaseUrl);
if (!supabase) {
  printCheck('Supabase URL parses', false, 'missing or invalid SUPABASE_URL/VITE_SUPABASE_URL');
} else {
  printCheck('Supabase URL parses', true, supabase.origin);
  const dns = await dnsStatus(supabase.hostname);
  printCheck('Supabase DNS', dns.ok, dns.ok ? dns.addresses.join(', ') : dns.error);
  const health = await fetchStatus(`${supabase.origin}/auth/v1/health`, supabaseAnon ? { apikey: supabaseAnon } : {});
  printCheck('Supabase auth health', health.ok, health.status ? `HTTP ${health.status}` : health.error);
}

const db = safeUrl(databaseUrl);
if (!db) {
  printCheck('DATABASE_URL parses', false, 'missing or invalid DATABASE_URL');
} else {
  const port = Number(db.port || 5432);
  printCheck('DATABASE_URL parses', true, `${db.protocol}//${db.hostname}:${port}${db.pathname}`);
  const dns = await dnsStatus(db.hostname);
  printCheck('database DNS', dns.ok, dns.ok ? dns.addresses.join(', ') : dns.error);
  const tcp = await tcpStatus(db.hostname, port);
  printCheck('database TCP', tcp.ok, tcp.ok ? `${db.hostname}:${port}` : tcp.error);
}

if (failedChecks > 0) {
  console.error(`People Power doctor found ${failedChecks} failing check${failedChecks === 1 ? '' : 's'}.`);
  process.exitCode = 1;
}
