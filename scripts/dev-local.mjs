#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`[dev:local] ${message}\n`);
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
    log('[dev:local] Supabase local stack is not running; starting it now.');
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
  const forced = Number(process.env[`PP_LOCAL_${label.toUpperCase()}_PORT`] || '');
  if (Number.isInteger(forced) && forced > 0) {
    if (!(await isPortFree(forced))) fail(`${label} port ${forced} is already in use`);
    return forced;
  }

  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await isPortFree(port)) return port;
  }
  fail(`no free ${label} port found near ${preferred}`);
}

async function waitForHttp(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready: ${lastError}`);
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

let shuttingDown = false;
const children = [];

function cleanup() {
  for (const child of children) killTree(child);
}

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

const supabase = getSupabaseEnv();
const backendPort = await pickPort(Number(process.env.PEOPLEPOWER_BACKEND_PORT || 3001), 'backend');
const frontendPort = await pickPort(Number(process.env.VITE_DEV_PORT || 5173), 'frontend');
const backendBase = `http://${HOST}:${backendPort}`;
const frontendBase = `http://${HOST}:${frontendPort}`;

const sharedEnv = {
  DATABASE_URL: supabase.DB_URL,
  SUPABASE_URL: supabase.API_URL,
  SUPABASE_ANON_KEY: supabase.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: supabase.SERVICE_ROLE_KEY,
  VITE_SUPABASE_URL: supabase.API_URL,
  VITE_SUPABASE_ANON_KEY: supabase.ANON_KEY,
  VITE_API_BASE_URL: backendBase,
  VITE_BACKEND_BASE: backendBase,
  VITE_BACKEND_PORT: String(backendPort),
  VITE_SITE_URL: frontendBase,
};

children.push(
  spawnChild('backend', process.execPath, ['Server/index.js'], {
    ...sharedEnv,
    PEOPLEPOWER_BACKEND_PORT: String(backendPort),
    PORT: String(backendPort),
    HOST,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS || 'local-admin@example.test',
  })
);

children.push(
  spawnChild('frontend', commandFor('npx'), ['vite', '--host', HOST, '--port', String(frontendPort), '--strictPort'], sharedEnv)
);

try {
  await Promise.all([
    waitForHttp(`${backendBase}/health`, 'backend'),
    waitForHttp(`${frontendBase}/`, 'frontend'),
  ]);
} catch (error) {
  shuttingDown = true;
  cleanup();
  fail(error?.message || String(error));
}

log('');
log(`[dev:local] frontend ${frontendBase}`);
log(`[dev:local] backend  ${backendBase}`);
log('[dev:local] Supabase Studio http://127.0.0.1:54323');
log('[dev:local] Mailpit http://127.0.0.1:54324');

if (process.env.PP_LOCAL_EXIT_AFTER_READY === '1') {
  shuttingDown = true;
  cleanup();
  process.exit(0);
}
