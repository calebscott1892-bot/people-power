#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';

let shuttingDown = false;
const children = [];

function log(message = '') {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`[verify:local] ${message}\n`);
  process.exit(1);
}

function commandFor(name) {
  if (process.platform !== 'win32') return name;
  const found = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
  const candidates = String(found.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    candidates.find((line) => /\.cmd$/i.test(line)) ||
    candidates.find((line) => /\.exe$/i.test(line)) ||
    candidates.find((line) => /\.bat$/i.test(line)) ||
    candidates[0] ||
    name
  );
}

function wrapCommand(command, args) {
  if (process.platform === 'win32' && /\.cmd$/i.test(command)) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/c', command, ...args],
    };
  }
  return { command, args };
}

function runSync(command, args, options = {}) {
  const wrapped = wrapCommand(command, args);
  return spawnSync(wrapped.command, wrapped.args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
}

function parseSupabaseEnv(output) {
  const vars = {};
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[match[1]] = value;
  }
  return vars;
}

function getSupabaseEnv() {
  const supabase = commandFor('supabase');
  const first = runSync(supabase, ['status', '-o', 'env']);
  if (first.error?.code === 'ENOENT') {
    fail('Supabase CLI is not installed or not on PATH');
  }
  let vars = parseSupabaseEnv(`${first.stdout || ''}\n${first.stderr || ''}`);

  if (!vars.API_URL || !vars.DB_URL || !vars.ANON_KEY || !vars.SERVICE_ROLE_KEY) {
    log('[verify:local] Supabase local stack is not running; starting it now.');
    const started = runSync(supabase, ['start'], { stdio: 'inherit' });
    if (started.error?.code === 'ENOENT') {
      fail('Supabase CLI is not installed or not on PATH');
    }
    if (started.status !== 0) fail('supabase start failed');

    const second = runSync(supabase, ['status', '-o', 'env']);
    vars = parseSupabaseEnv(`${second.stdout || ''}\n${second.stderr || ''}`);
  }

  const missing = ['API_URL', 'DB_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'].filter((key) => !vars[key]);
  if (missing.length) {
    fail(`missing Supabase local values: ${missing.join(', ')}`);
  }
  return vars;
}

function localUrl(value, label) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    fail(`${label} must be local; got ${url.hostname}`);
  }
  return url;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: HOST, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickPort(preferred, label) {
  const forced = Number(process.env[`PP_VERIFY_${label.toUpperCase()}_PORT`] || '');
  if (Number.isInteger(forced) && forced > 0) {
    if (!(await isPortFree(forced))) fail(`${label} port ${forced} is already in use`);
    return forced;
  }

  for (let port = preferred; port < preferred + 30; port += 1) {
    if (await isPortFree(port)) return port;
  }
  fail(`no free ${label} port found near ${preferred}`);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(2500),
  });
  let body = null;
  try {
    body = await res.clone().json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

async function waitForBackend(base, label, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(`${base}/health`);
      const db = await fetchJson(`${base}/__db`);
      if (health.ok && db.ok && db.body?.dbReady === true) return;
      lastError = `/health=${health.status} /__db=${db.status} dbReady=${String(db.body?.dbReady)}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready: ${lastError}`);
}

async function waitForFrontend(base, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base, {
        cache: 'no-store',
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`frontend did not become ready: ${lastError}`);
}

function spawnChild(name, command, args, env) {
  const wrapped = wrapCommand(command, args);
  const child = spawn(wrapped.command, wrapped.args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    windowsHide: true,
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanup();
    fail(`${name} exited unexpectedly (${signal || code})`);
  });
  child.on('error', (error) => {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanup();
    fail(`${name} failed to start: ${error?.message || String(error)}`);
  });

  children.push(child);
  return child;
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // ignore cleanup failures
  }
}

function cleanup() {
  for (const child of children) killTree(child);
}

function installCleanupHandlers() {
  process.on('SIGINT', () => {
    shuttingDown = true;
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    shuttingDown = true;
    cleanup();
    process.exit(143);
  });
  process.on('exit', cleanup);
}

function buildSharedEnv({ supabase, primaryBackendBase, frontendBase }) {
  return {
    DATABASE_URL: supabase.DB_URL,
    SUPABASE_URL: supabase.API_URL,
    SUPABASE_ANON_KEY: supabase.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: supabase.SERVICE_ROLE_KEY,
    VITE_SUPABASE_URL: supabase.API_URL,
    VITE_SUPABASE_ANON_KEY: supabase.ANON_KEY,
    VITE_API_BASE_URL: primaryBackendBase,
    VITE_BACKEND_BASE: primaryBackendBase,
    VITE_SITE_URL: frontendBase,
  };
}

async function runStep(name, command, args, env) {
  log('');
  log(`[verify:local] ${name}`);
  const wrapped = wrapCommand(command, args);
  const child = spawn(wrapped.command, wrapped.args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    windowsHide: true,
  });

  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (exitCode, signal) => {
      if (signal) resolve(128);
      else resolve(exitCode ?? 0);
    });
  });
  if (code !== 0) {
    throw new Error(`${name} failed with exit code ${code}`);
  }
}

installCleanupHandlers();

const supabase = getSupabaseEnv();
localUrl(supabase.API_URL, 'Supabase API URL');
localUrl(supabase.DB_URL, 'Supabase DB URL');

const primaryPort = await pickPort(Number(process.env.PP_VERIFY_PRIMARY_PORT || 3020), 'primary');
const secondaryPort = await pickPort(Number(process.env.PP_VERIFY_SECONDARY_PORT || primaryPort + 1), 'secondary');
const frontendPort = await pickPort(Number(process.env.PP_VERIFY_FRONTEND_PORT || 5180), 'frontend');
const primaryBackendBase = `http://${HOST}:${primaryPort}`;
const secondaryBackendBase = `http://${HOST}:${secondaryPort}`;
const frontendBase = `http://${HOST}:${frontendPort}`;
const sharedEnv = buildSharedEnv({ supabase, primaryBackendBase, frontendBase });

log('[verify:local] starting disposable local proof stack');
log(`[verify:local] primary backend   ${primaryBackendBase}`);
log(`[verify:local] secondary backend ${secondaryBackendBase}`);
log(`[verify:local] frontend          ${frontendBase}`);

spawnChild('primary backend', process.execPath, ['Server/index.js'], {
  ...sharedEnv,
  PEOPLEPOWER_BACKEND_PORT: String(primaryPort),
  PORT: String(primaryPort),
  HOST,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS || 'local-admin@example.test',
});

spawnChild('secondary backend', process.execPath, ['Server/index.js'], {
  ...sharedEnv,
  PEOPLEPOWER_BACKEND_PORT: String(secondaryPort),
  PORT: String(secondaryPort),
  HOST,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS || 'local-admin@example.test',
});

spawnChild('frontend', commandFor('npx'), ['vite', '--host', HOST, '--port', String(frontendPort), '--strictPort'], {
  ...sharedEnv,
  VITE_BACKEND_PORT: String(primaryPort),
});

try {
  await Promise.all([
    waitForBackend(primaryBackendBase, 'primary backend'),
    waitForBackend(secondaryBackendBase, 'secondary backend'),
    waitForFrontend(frontendBase),
  ]);

  await runStep('doctor against primary backend', commandFor('npm'), ['run', 'doctor'], {
    ...sharedEnv,
    PEOPLEPOWER_BACKEND_PORT: String(primaryPort),
    PORT: String(primaryPort),
  });

  await runStep('cross-process DM realtime smoke', commandFor('npm'), ['run', 'smoke:realtime'], {
    ...sharedEnv,
    E2E_BACKEND_BASE: primaryBackendBase,
    E2E_SENDER_BACKEND_BASE: primaryBackendBase,
    E2E_RECEIVER_BACKEND_BASE: secondaryBackendBase,
  });

  await runStep('cross-process movement engagement realtime smoke', commandFor('npm'), ['run', 'smoke:movement-realtime'], {
    ...sharedEnv,
    E2E_BACKEND_BASE: primaryBackendBase,
    E2E_SENDER_BACKEND_BASE: primaryBackendBase,
    E2E_RECEIVER_BACKEND_BASE: secondaryBackendBase,
  });

  await runStep('SPA auth e2e', commandFor('npm'), ['run', 'e2e:auth'], {
    ...sharedEnv,
    E2E_BACKEND_PORT: String(primaryPort),
    E2E_FRONTEND_PORT: String(frontendPort),
    PEOPLEPOWER_BACKEND_PORT: String(primaryPort),
    VITE_DEV_PORT: String(frontendPort),
    VITE_BACKEND_PORT: String(primaryPort),
  });

  log('');
  log('[verify:local] PASS');
} catch (error) {
  shuttingDown = true;
  cleanup();
  fail(error?.message || String(error));
} finally {
  shuttingDown = true;
  cleanup();
}
