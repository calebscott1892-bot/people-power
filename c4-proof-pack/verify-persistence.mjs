import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { chromium } from 'playwright';

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const HOST = '127.0.0.1';
const C4_BACKEND_PORT = Number(requiredEnv('C4_BACKEND_PORT'));
const C4_FRONTEND_PORT = Number(requiredEnv('C4_FRONTEND_PORT'));
const C4_HEALTH_ENDPOINT = requiredEnv('C4_HEALTH_ENDPOINT');
const C4_DEV_COMMAND = requiredEnv('C4_DEV_COMMAND');

const FRONTEND_BASE = `http://${HOST}:${C4_FRONTEND_PORT}`;
const BACKEND_BASE = `http://${HOST}:${C4_BACKEND_PORT}`;

const TIMEOUTS = {
  backendHealthMs: 20000,
  frontendReadyMs: 60000,
  playwrightLaunchMs: 30000,
  routeGotoMs: 30000,
};

function startDev() {
  const child = spawn('bash', ['-lc', C4_DEV_COMMAND], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, C4_PROOF_PACK: '1' },
    detached: true,
  });
  child.unref();
  return child;
}

async function waitForBackend(timeoutMs = 20000) {
  const url = `${BACKEND_BASE}${C4_HEALTH_ENDPOINT}`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await delay(150);
  }
  throw new Error(`Timed out waiting for backend health at ${url}`);
}

async function createUser(page) {
  // Assumes a signup form at /auth/register or similar
  const email = `proof${Date.now()}@example.com`;
  const password = 'ProofPack123!';
  await page.goto(`${FRONTEND_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.routeGotoMs });
  // Switch to signup mode
  await page.click('button:has-text("New here? Create an account")');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  // Submit signup
  await page.click('button[type="submit"]');
  // Wait for navigation to /welcome (or success message)
  await page.waitForURL(url => url.pathname === '/welcome', { timeout: 10000 });
  return { email, password };
}

async function getUserId(page, email) {
  // Proof-pack mode: verify the authenticated user via backend session (cookie-based).
  // This avoids relying on UI rendering of email (which may be intentionally hidden).
  const res = await page.context().request.get(`${BACKEND_BASE}/debug/proof/whoami`);
  if (!res.ok()) return null;
  const data = await res.json().catch(() => null);
  const currentEmail = data?.user?.email ? String(data.user.email) : null;
  if (!currentEmail) return null;
  if (email && currentEmail !== String(email)) return null;
  return currentEmail;
}

async function killDev(child) {
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    try { child.kill('SIGKILL'); } catch {}
  }
}

async function main() {
  // 1. Start dev stack
  const devChild = startDev();
  await waitForBackend();

  // 2. Create user
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const { email, password } = await createUser(page);
  const userId = await getUserId(page, email);
  await browser.close();
  killDev(devChild);
  await delay(2000);

  // 3. Restart dev stack
  const devChild2 = startDev();
  await waitForBackend();

  // 4. Query for user
  const browser2 = await chromium.launch();
  const page2 = await browser2.newPage();
  // Log in again
  await page2.goto(`${FRONTEND_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.routeGotoMs });
  await page2.fill('input[type="email"]', email);
  await page2.fill('input[type="password"]', password);
  await page2.click('button[type="submit"]');
  await delay(2000);
  const userIdAfter = await getUserId(page2, email);
  await browser2.close();
  killDev(devChild2);

  // 5. Output result
  const result = {
    persistenceProof: {
      userId,
      existsAfterRestart: !!userIdAfter,
    }
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!userIdAfter) {
    throw new Error('PROOF FAIL: User did not persist after backend restart');
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});
