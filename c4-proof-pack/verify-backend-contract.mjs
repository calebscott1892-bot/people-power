import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import path from 'node:path';

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function resolveRepoPath(p) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

const C4_DB_PATH = requiredEnv('C4_DB_PATH');
const C4_BACKEND_PORT = Number(requiredEnv('C4_BACKEND_PORT'));
const C4_HEALTH_ENDPOINT = requiredEnv('C4_HEALTH_ENDPOINT');
const C4_BOOTSTRAP_COMMAND = requiredEnv('C4_BOOTSTRAP_COMMAND');
const C4_DEV_COMMAND = requiredEnv('C4_DEV_COMMAND');

// Optional override (defaults to a conventional path).
const C4_AUTH_ENDPOINT = process.env.C4_AUTH_ENDPOINT || '/auth/me';

const BACKEND_BASE = `http://127.0.0.1:${C4_BACKEND_PORT}`;

const TIMEOUTS = {
  overallMs: 90_000,
  healthMs: 20_000,
  fetchMs: 1_000,
  portProbeMs: 800,
};

async function hasNonEmptyDb() {
  try {
    const s = await stat(resolveRepoPath(C4_DB_PATH));
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

async function withTimeout(label, ms, fn) {
  return await Promise.race([
    fn(),
    delay(ms).then(() => {
      throw new Error(`phase:${label} timed out after ${ms}ms`);
    }),
  ]);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error(`fetch timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function assertPortFree(host, port) {
  await withTimeout('portProbe', TIMEOUTS.portProbeMs, async () => {
    await new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const done = (err) => {
        socket.removeAllListeners();
        socket.destroy();
        if (err) reject(err);
        else resolve();
      };

      socket.once('connect', () => done(new Error(`port already in use (${host}:${port})`)));
      socket.once('error', (err) => {
        if (err && (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH')) {
          done(null);
          return;
        }
        done(err);
      });
      socket.setTimeout(TIMEOUTS.portProbeMs, () => done(null));
      socket.connect(port, host);
    });
  });
}

function killProcessGroupBestEffort(child, logs) {
  if (!child || child.killed) return;
  const pid = child.pid;
  if (!pid) return;

  const tryKill = (targetPid, sig) => {
    try {
      process.kill(targetPid, sig);
      return true;
    } catch (e) {
      if (logs) logs.push(`kill ${sig} failed: ${String(e?.message || e)}`);
      return false;
    }
  };

  const killedGroup = tryKill(-pid, 'SIGTERM');
  if (!killedGroup) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

function startDev() {
  const child = spawn('bash', ['-lc', C4_DEV_COMMAND], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      C4_DB_PATH,
      C4_BACKEND_PORT: String(C4_BACKEND_PORT),
      C4_HEALTH_ENDPOINT,
      C4_BOOTSTRAP_COMMAND,
      C4_DEV_COMMAND,
      C4_AUTH_ENDPOINT,
    },
    detached: true,
  });

  const logs = [];
  const onLine = (line) => logs.push(line);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => d.split(/\r?\n/).filter(Boolean).forEach(onLine));
  child.stderr.on('data', (d) => d.split(/\r?\n/).filter(Boolean).forEach(onLine));

  return { child, logs };
}

async function waitForHealth(timeoutMs = 20_000) {
  const start = Date.now();
  const url = `${BACKEND_BASE}${C4_HEALTH_ENDPOINT}`;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchWithTimeout(url, TIMEOUTS.fetchMs);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for backend health at ${url}`);
}

async function requireAuthEndpoint() {
  const url = `${BACKEND_BASE}${C4_AUTH_ENDPOINT}`;
  const res = await fetchWithTimeout(url, 2_000);
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`GET ${C4_AUTH_ENDPOINT} failed: ${res.status} ${text || res.statusText}`);

  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`GET ${C4_AUTH_ENDPOINT} did not return valid JSON`);
  }

  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `GET ${C4_AUTH_ENDPOINT} expected JSON object`);
  assert.ok(typeof parsed.id === 'string' && parsed.id.length > 0, `GET ${C4_AUTH_ENDPOINT} expected string field 'id'`);
}

async function main() {
  if (!(await hasNonEmptyDb())) {
    process.stdout.write(`MISSING_DEV_DATA: run ${C4_BOOTSTRAP_COMMAND}\n`);
    process.exitCode = 2;
    return;
  }

  await assertPortFree('127.0.0.1', C4_BACKEND_PORT);

  const { child, logs } = startDev();

  try {
    await withTimeout('overall', TIMEOUTS.overallMs, async () => {
      await withTimeout('health', TIMEOUTS.healthMs, async () => {
        await waitForHealth(TIMEOUTS.healthMs);
      });

      // Abstract contract checks (project-agnostic):
      // - Health endpoint responds
      // - Auth endpoint is reachable and returns JSON object with stable identifier
      await withTimeout('auth', 10_000, async () => {
        await requireAuthEndpoint();
      });

      process.stdout.write('OK verify-backend-contract\n');
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.startsWith('MISSING_DEV_DATA:')) {
      process.stdout.write(`${msg}\n`);
      process.exitCode = 2;
      return;
    }

    const lines = [];
    lines.push(`ERROR verify-backend-contract ${msg}`);
    lines.push('devLogsLast50:');
    lines.push(...logs.slice(-50));
    process.stderr.write(`${lines.join('\n')}\n`);

    throw err;
  } finally {
    killProcessGroupBestEffort(child, logs);
    await delay(300);

    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  }
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(String(err?.stack || err));
    process.exit(1);
  });
