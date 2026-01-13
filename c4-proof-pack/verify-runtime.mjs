import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import path from 'node:path';
import { chromium } from 'playwright';

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function resolveRepoPath(p) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

const HOST = '127.0.0.1';

const C4_DB_PATH = requiredEnv('C4_DB_PATH');
const C4_BACKEND_PORT = Number(requiredEnv('C4_BACKEND_PORT'));
const C4_FRONTEND_PORT = Number(requiredEnv('C4_FRONTEND_PORT'));
const C4_HEALTH_ENDPOINT = requiredEnv('C4_HEALTH_ENDPOINT');
const C4_BOOTSTRAP_COMMAND = requiredEnv('C4_BOOTSTRAP_COMMAND');
const C4_DEV_COMMAND = requiredEnv('C4_DEV_COMMAND');

// Optional override (defaults to a conventional path).
const C4_AUTH_ENDPOINT = process.env.C4_AUTH_ENDPOINT || '/auth/me';

const FRONTEND_BASE = `http://${HOST}:${C4_FRONTEND_PORT}`;
const BACKEND_BASE = `http://${HOST}:${C4_BACKEND_PORT}`;

const TIMEOUTS = {
  overallMs: 120_000,
  backendHealthMs: 20_000,
  frontendReadyMs: 60_000,
  playwrightLaunchMs: 30_000,
  routeGotoMs: 30_000,
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

async function assertPortFree(host, port, label) {
  await withTimeout(`port:${label}`, TIMEOUTS.portProbeMs, async () => {
    await new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const done = (err) => {
        socket.removeAllListeners();
        socket.destroy();
        if (err) reject(err);
        else resolve();
      };

      socket.once('connect', () => done(new Error(`port:${label} already in use (${host}:${port})`)));
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

function detachChildStreamsBestEffort(child) {
  if (!child) return;
  const streams = [child.stdout, child.stderr];

  for (const s of streams) {
    if (!s) continue;
    try {
      s.removeAllListeners();
    } catch {
      // ignore
    }
    try {
      // Closing/destroying the pipes ensures the verifier can exit even if some
      // dev descendants keep the FD open.
      s.destroy();
    } catch {
      // ignore
    }
    try {
      // eslint-disable-next-line no-underscore-dangle
      if (typeof s.unref === 'function') s.unref();
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
      C4_FRONTEND_PORT: String(C4_FRONTEND_PORT),
      C4_HEALTH_ENDPOINT,
      C4_BOOTSTRAP_COMMAND,
      C4_DEV_COMMAND,
      C4_AUTH_ENDPOINT,
    },
    detached: true,
  });

  // Don't keep the event loop alive just because the supervisor process exists.
  // (stdio pipes can still keep it alive, so we also detach/destroy those in cleanup.)
  child.unref();

  const logs = [];
  const onLine = (line) => {
    logs.push(line);
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => d.split(/\r?\n/).filter(Boolean).forEach(onLine));
  child.stderr.on('data', (d) => d.split(/\r?\n/).filter(Boolean).forEach(onLine));

  return { child, logs };
}

async function waitForBackend(timeoutMs = 20_000) {
  const start = Date.now();
  const url = `${BACKEND_BASE}${C4_HEALTH_ENDPOINT}`;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchWithTimeout(url, 1_000);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for backend health at ${url}`);
}

async function waitForFrontend(logs, timeoutMs = 60_000) {
  const start = Date.now();
  let last = '';

  while (Date.now() - start < timeoutMs) {
    if (logs.some((l) => l.includes('Failed to resolve import'))) {
      const first = logs.find((l) => l.includes('Failed to resolve import'));
      throw new Error(`Frontend import-resolution failure while starting: ${first}`);
    }

    try {
      const res = await fetchWithTimeout(`${FRONTEND_BASE}/`, 1_000);
      last = `ok status=${res.status}`;
      return;
    } catch (e) {
      last = `err ${String(e?.message || e)}`;
    }

    await delay(250);
  }

  throw new Error(`Frontend not reachable at ${FRONTEND_BASE}/ within ${timeoutMs}ms (last=${last})`);
}

async function requireDevDataViaAuth() {
  const url = `${BACKEND_BASE}${C4_AUTH_ENDPOINT}`;
  try {
    const res = await fetchWithTimeout(url, 2_000);
    if (res.ok) return;
  } catch {
    // ignore
  }

  const err = new Error(`MISSING_DEV_DATA: run ${C4_BOOTSTRAP_COMMAND}`);
  // @ts-ignore
  err.code = 'MISSING_DEV_DATA';
  throw err;
}

async function main() {
  let success = false;
  if (!(await hasNonEmptyDb())) {
    process.stdout.write(`MISSING_DEV_DATA: run ${C4_BOOTSTRAP_COMMAND}\n`);
    process.exitCode = 2;
    return;
  }

  await assertPortFree(HOST, C4_BACKEND_PORT, 'backend');
  await assertPortFree(HOST, C4_FRONTEND_PORT, 'frontend');

  const { child: devChild, logs: devLogs } = startDev();
  const frontendPollHistory = [];

  try {
    const run = async () => {
      await withTimeout('backendHealth', TIMEOUTS.backendHealthMs, async () => {
        await waitForBackend(TIMEOUTS.backendHealthMs);
      });

      await withTimeout('requireDevData', 10_000, async () => {
        await requireDevDataViaAuth();
      });

      await withTimeout('frontendReady', TIMEOUTS.frontendReadyMs, async () => {
        const start = Date.now();
        try {
          await waitForFrontend(devLogs, TIMEOUTS.frontendReadyMs);
          frontendPollHistory.push(`reachable after ${Date.now() - start}ms`);
        } catch (e) {
          frontendPollHistory.push(String(e?.message || e));
          throw e;
        }
      });

      const browser = await withTimeout('playwrightLaunch', TIMEOUTS.playwrightLaunchMs, async () => {
        return await chromium.launch();
      });

      const page = await browser.newPage();

      const consoleLines = [];
      const pageErrors = [];
      const interceptedRequests = [];

      page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' || msg.type() === 'warning') consoleLines.push(text);
      });
      page.on('pageerror', (err) => {
        pageErrors.push(String(err));
      });

      // Intercept all network requests
      page.on('request', (req) => {
        interceptedRequests.push(req.url());
      });

      const routes = ['/'];

      for (const route of routes) {
        await withTimeout(`route:${route}`, TIMEOUTS.routeGotoMs, async () => {
          await page.goto(`${FRONTEND_BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.routeGotoMs });
        });
        await delay(1500);
      }

      // New proof: assert at least one request hits the backend origin
      const expectedOrigin = `http://${HOST}:${C4_BACKEND_PORT}`;
      const matched = interceptedRequests.filter((u) => u.startsWith(expectedOrigin));
      if (matched.length === 0) {
        const msg = [
          `PROOF FAIL: No frontend network requests hit backend origin: ${expectedOrigin}`,
          `Observed requests:`,
          ...interceptedRequests.map((u) => `  - ${u}`)
        ].join('\n');
        throw new Error(msg);
      }

      await browser.close();

      const result = {
        base: FRONTEND_BASE,
        routesVisited: routes,
        consoleWarningsOrErrorsFirst20: consoleLines.slice(0, 20),
        pageErrors,
        networkProof: {
          backendOrigin: expectedOrigin,
          matched,
          allIntercepted: interceptedRequests,
        },
      };

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      success = true;
    };

    await withTimeout('overall', TIMEOUTS.overallMs, run);
  } catch (err) {
    const msg = String(err?.message || err);
    const lines = [];
    lines.push(`ERROR verify-runtime ${msg}`);
    lines.push('devLogsLast50:');
    lines.push(...devLogs.slice(-50));

    if (msg.startsWith('phase:frontendReady') || msg.includes('Frontend not reachable')) {
      lines.push('frontendPollHistoryLast10:');
      lines.push(...frontendPollHistory.slice(-10));
    }
    process.stderr.write(`${lines.join('\n')}\n`);
    throw err;
  } finally {
    killProcessGroupBestEffort(devChild, devLogs);

    // Give the dev process tree a brief chance to exit cleanly.
    await delay(250);

    if (devChild?.pid) {
      try {
        process.kill(-devChild.pid, 'SIGKILL');
      } catch {
        try {
          devChild.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }

    // Regardless of whether the dev tree actually dies, ensure we don't hang
    // waiting on open stdio pipes.
    detachChildStreamsBestEffort(devChild);

    // As a last line of defense, exit explicitly on success so no lingering
    // handles (child-process internals, Playwright edge cases) can cause a hang.
    if (success) {
      process.exit(0);
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(String(err?.stack || err));
  process.exit(1);
});
