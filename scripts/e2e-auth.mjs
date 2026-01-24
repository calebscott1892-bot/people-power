#!/usr/bin/env node
/*
  Headless SPA auth e2e using Playwright.

  HARD RULES:
  - Never print secrets (tokens/passwords/keys). Only booleans, lengths, dotCounts, and non-secret URLs/hosts.
  - No manual browser steps.

  Output contract:
  - Final line MUST be exactly:
      [e2e] PASS
    or
      [e2e] FAIL <reason>
*/

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(ROOT);

const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = '3001';
const FRONTEND_HOST = '127.0.0.1';
const FRONTEND_PORT = '5173';

const BACKEND_BASE = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
const FRONTEND_BASE = `http://${FRONTEND_HOST}:${FRONTEND_PORT}`;

function safeLog(line) {
  process.stdout.write(String(line) + '\n');
}

function fail(reason) {
  // Diagnostics are printed by the caller (only non-secret), then end with this single line.
  safeLog(`[e2e] FAIL ${String(reason || 'unknown')}`);
  process.exit(1);
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function loadEnvFileNoOverride(file) {
  if (!isFile(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let kv = line;
    if (kv.startsWith('export ')) kv = kv.slice('export '.length);
    const eq = kv.indexOf('=');
    if (eq <= 0) continue;
    const key = kv.slice(0, eq).trim();
    let val = kv.slice(eq + 1);
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    // Strip surrounding quotes only
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function decodeJwtRole(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const pad = '='.repeat((4 - (payload.length % 4)) % 4);
    const b64 = (payload + pad).replace(/-/g, '+').replace(/_/g, '/');
    const obj = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return obj?.role ? String(obj.role) : null;
  } catch {
    return null;
  }
}

async function fetchOk(url, { name, timeoutMs = 20_000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      throw new Error(`${name || url} status=${res.status}`);
    }
  } finally {
    clearTimeout(t);
  }
}

async function waitForUrlOk(url, { name, timeoutMs = 40_000, intervalMs = 250 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      await fetchOk(url, { name, timeoutMs: 10_000 });
      return;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timeout waiting for ${name || url}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

function spawnDetached(command, args, { logFile, env } = {}) {
  const outFd = fs.openSync(logFile, 'a');
  const child = spawn(command, args, {
    env: { ...process.env, ...(env || {}) },
    stdio: ['ignore', outFd, outFd],
    detached: true,
  });
  child.unref();
  return child;
}

function getServiceRoleKey() {
  const names = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE', 'SUPABASE_SERVICE'];
  for (const name of names) {
    if (process.env[name]) return { name, value: String(process.env[name]) };
  }
  return null;
}

async function ensureE2ECreds() {
  const existingEmail = process.env.E2E_EMAIL || process.env.E2E_USER_EMAIL || process.env.E2E_ADMIN_EMAIL;
  const existingPass = process.env.E2E_PASSWORD || process.env.E2E_USER_PASSWORD || process.env.E2E_ADMIN_PASSWORD;
  if (existingEmail && existingPass) {
    process.env.E2E_EMAIL = String(existingEmail);
    process.env.E2E_PASSWORD = String(existingPass);
    return { mode: 'existing' };
  }

  const service = getServiceRoleKey();
  const hasServiceRole = !!service && decodeJwtRole(service.value) === 'service_role';
  if (!hasServiceRole) {
    // FAIL with clear missing vars (true/false only)
    safeLog('[e2e][diag] E2E_EMAIL_present=' + String(!!existingEmail));
    safeLog('[e2e][diag] E2E_PASSWORD_present=' + String(!!existingPass));
    safeLog('[e2e][diag] serviceRole_present=' + String(!!service));
    safeLog('[e2e][diag] serviceRole_isServiceRole=' + String(hasServiceRole));
    throw new Error('missing_credentials');
  }

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!supabaseUrl) {
    safeLog('[e2e][diag] VITE_SUPABASE_URL_present=false');
    throw new Error('missing_vite_supabase_url');
  }

  // Create a temporary user via the Admin API.
  const email = `pp_e2e_${Date.now()}@example.com`;
  const password = randomBytes(24).toString('base64url') + 'Aa1!';

  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: service.value,
      Authorization: `Bearer ${service.value}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    safeLog(`[e2e][diag] adminCreateUser_status=${res.status}`);
    safeLog(`[e2e][diag] adminCreateUser_bodyLen=${text.length}`);
    throw new Error('admin_create_user_failed');
  }

  // DO NOT LOG password.
  process.env.E2E_EMAIL = email;
  process.env.E2E_PASSWORD = password;
  return { mode: 'admin_created' };
}

async function main() {
  let backendChild = null;
  let frontendChild = null;
  const backendLog = path.join(os.tmpdir(), `peoplepower-e2e-backend.${process.pid}.log`);
  const frontendLog = path.join(os.tmpdir(), `peoplepower-e2e-frontend.${process.pid}.log`);

  const backendRequests = [];
  let pageRef = null;
  let lastKnownUrl = '';

  const dumpNonSecretDiagnostics = () => {
    try {
      const url = pageRef ? pageRef.url() : lastKnownUrl;
      safeLog(`[e2e][diag] finalUrl=${url || 'unknown'}`);
    } catch {
      safeLog('[e2e][diag] finalUrl=unknown');
    }

    for (const r of backendRequests) {
      try {
        const p = new URL(r.url).pathname;
        safeLog(
          `[e2e][diag][req] url=${p} method=${r.method} status=${r.status ?? 'null'} authHeaderPresent=${r.authHeaderPresent}`
        );
      } catch {
        // ignore
      }
    }
  };

  const cleanup = () => {
    for (const child of [frontendChild, backendChild]) {
      if (!child) continue;
      try {
        // kill process group
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // ignore
      }
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  // Deterministic env load (no override)
  loadEnvFileNoOverride(path.join(ROOT, '.env'));
  loadEnvFileNoOverride(path.join(ROOT, '.env.local'));
  loadEnvFileNoOverride(path.join(ROOT, 'Server', '.env'));
  loadEnvFileNoOverride(path.join(ROOT, '.env.e2e'));

  // Ensure required frontend Supabase config is present (no values printed)
  const hasViteUrl = !!process.env.VITE_SUPABASE_URL;
  const hasViteAnon = !!process.env.VITE_SUPABASE_ANON_KEY;
  if (!hasViteUrl || !hasViteAnon) {
    safeLog('[e2e][diag] VITE_SUPABASE_URL_present=' + String(hasViteUrl));
    safeLog('[e2e][diag] VITE_SUPABASE_ANON_KEY_present=' + String(hasViteAnon));
    throw new Error('missing_vite_supabase');
  }

  // Start/verify backend
  try {
    await fetchOk(`${BACKEND_BASE}/__health`, { name: 'backend' });
    safeLog(`[e2e] backend already up: ${BACKEND_BASE}`);
  } catch {
    safeLog(`[e2e] starting backend: ${BACKEND_BASE}`);
    backendChild = spawnDetached('npm', ['run', 'dev:server'], { logFile: backendLog, env: { PEOPLEPOWER_BACKEND_PORT: BACKEND_PORT, C4_BACKEND_PORT: BACKEND_PORT } });
    await waitForUrlOk(`${BACKEND_BASE}/__health`, { name: 'backend' });
  }

  // Start/verify frontend
  try {
    await fetchOk(`${FRONTEND_BASE}/`, { name: 'frontend' });
    safeLog(`[e2e] frontend already up: ${FRONTEND_BASE}`);
  } catch {
    safeLog(`[e2e] starting frontend: ${FRONTEND_BASE}`);
    frontendChild = spawnDetached('npm', ['run', 'dev:client'], { logFile: frontendLog, env: { PEOPLEPOWER_BACKEND_PORT: BACKEND_PORT, C4_BACKEND_PORT: BACKEND_PORT } });
    await waitForUrlOk(`${FRONTEND_BASE}/`, { name: 'frontend' });
  }

  // Ensure credentials exist (or auto-provision via service role)
  try {
    await ensureE2ECreds();
  } catch (e) {
    if (String(e?.message || e) === 'missing_credentials') {
      fail('missing E2E creds (and no usable service role key)');
      return;
    }
    throw e;
  }

  let browser = null;
  let context = null;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      baseURL: FRONTEND_BASE,
    });

  context.on('request', (req) => {
    try {
      const u = new URL(req.url());
      if (u.host !== `${BACKEND_HOST}:${BACKEND_PORT}`) return;
      const headers = req.headers();
      const hasAuth = !!headers?.authorization;
      backendRequests.push({
        url: req.url(),
        method: req.method(),
        authHeaderPresent: hasAuth,
        status: null,
      });
    } catch {
      // ignore
    }
  });

  context.on('response', (res) => {
    try {
      const u = new URL(res.url());
      if (u.host !== `${BACKEND_HOST}:${BACKEND_PORT}`) return;
      const url = res.url();
      // Update the most recent matching request that has no status yet.
      for (let i = backendRequests.length - 1; i >= 0; i--) {
        const r = backendRequests[i];
        if (r.url === url && r.status == null) {
          r.status = res.status();
          break;
        }
      }
    } catch {
      // ignore
    }
  });

    const page = await context.newPage();
    pageRef = page;
  page.on('framenavigated', (frame) => {
    try {
      if (frame === page.mainFrame()) {
        lastKnownUrl = frame.url();
      }
    } catch {
      // ignore
    }
  });

    // Navigate to login explicitly to make selectors deterministic.
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('login-password').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('login-submit').waitFor({ state: 'visible', timeout: 30_000 });

    // Fill login form
    await page.getByTestId('login-email').fill(String(process.env.E2E_EMAIL || ''));
    await page.getByTestId('login-password').fill(String(process.env.E2E_PASSWORD || ''));

    // Click submit and wait for either a route change away from /login OR a Supabase token to appear.
    // (Avoid Playwright networkidle here; SPAs often keep connections open.)
    await page.getByTestId('login-submit').click();
    await Promise.race([
      page.waitForFunction(() => window.location.pathname !== '/login', null, { timeout: 30_000 }),
      page.waitForFunction(
        () => {
          try {
            return Object.keys(window.localStorage || {}).some((k) => /^sb-.*-auth-token$/.test(k));
          } catch {
            return false;
          }
        },
        null,
        { timeout: 30_000 }
      ),
    ]);

  // Assert we are not on /login
  {
    const p = new URL(page.url()).pathname;
    if (p === '/login') {
      // Diagnostics on failure (safe)
      safeLog('[e2e][diag] finalPath=/login');
      dumpNonSecretDiagnostics();
      fail('post-login still on /login');
      await browser.close();
      return;
    }
  }

  // Trigger a backend call from within the SPA runtime using window.fetch.
  // This should flow through the installed authFetch wrapper if present.
    await page.evaluate(async (base) => {
    try {
      await fetch(`${base}/auth/me`, { headers: { Accept: 'application/json' } });
    } catch {
      // ignore
    }
    }, BACKEND_BASE);

  // Assert localStorage contains a Supabase auth token key
    const tokenInfo = await page.evaluate(() => {
    const keys = Object.keys(window.localStorage || {});
    const key = keys.find((k) => /^sb-.*-auth-token$/.test(k)) || null;
    if (!key) return { ok: false, key: null, tokenLen: 0, dotCount: 0 };
    try {
      const raw = String(window.localStorage.getItem(key) || '');
      const parsed = JSON.parse(raw);
      const token = String(parsed?.access_token || '');
      const dotCount = (token.match(/\./g) || []).length;
      return { ok: !!token, key, tokenLen: token.length, dotCount };
    } catch {
      return { ok: false, key, tokenLen: 0, dotCount: 0 };
    }
    });

  safeLog(`[e2e][diag] supabaseTokenKey=${tokenInfo.key || 'missing'} tokenLen=${tokenInfo.tokenLen} dotCount=${tokenInfo.dotCount}`);

  if (!tokenInfo.ok) {
    dumpNonSecretDiagnostics();
    fail('missing_supabase_localstorage_token');
    await browser.close();
    return;
  }

  // Assert at least one backend request had Authorization header.
  const anyAuthed = backendRequests.some((r) => r.authHeaderPresent === true);
  if (!anyAuthed) {
    dumpNonSecretDiagnostics();
    fail('no_backend_request_with_authorization');
    await browser.close();
    return;
  }

  // Assert the SPA does not navigate back to /login for 30 seconds.
    const start = Date.now();
    while (Date.now() - start < 30_000) {
    const p = new URL(page.url()).pathname;
    if (p === '/login') {
      dumpNonSecretDiagnostics();
      fail('navigated_to_login_within_30s');
      await browser.close();
      return;
    }
    await page.waitForTimeout(250);
    }

    // Hard reload: should remain authenticated.
    // Avoid waiting for 'networkidle' (SPAs often keep connections open).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const afterReloadPath = new URL(page.url()).pathname;
    if (afterReloadPath === '/login') {
    dumpNonSecretDiagnostics();
    fail('reload_lost_auth_redirected_to_login');
    await browser.close();
    return;
    }

    // After reload, token should still be present.
    const tokenInfoAfterReload = await page.evaluate(() => {
      const keys = Object.keys(window.localStorage || {});
      const key = keys.find((k) => /^sb-.*-auth-token$/.test(k)) || null;
      if (!key) return { ok: false, key: null, tokenLen: 0, dotCount: 0 };
      try {
        const raw = String(window.localStorage.getItem(key) || '');
        const parsed = JSON.parse(raw);
        const token = String(parsed?.access_token || '');
        const dotCount = (token.match(/\./g) || []).length;
        return { ok: !!token, key, tokenLen: token.length, dotCount };
      } catch {
        return { ok: false, key, tokenLen: 0, dotCount: 0 };
      }
    });
    if (!tokenInfoAfterReload.ok) {
      safeLog(`[e2e][diag] supabaseTokenKeyAfterReload=${tokenInfoAfterReload.key || 'missing'} tokenLen=${tokenInfoAfterReload.tokenLen} dotCount=${tokenInfoAfterReload.dotCount}`);
      dumpNonSecretDiagnostics();
      fail('reload_missing_supabase_token');
      await browser.close();
      return;
    }

    await browser.close();
    safeLog('[e2e] PASS');
  } catch (e) {
    safeLog('[e2e][diag] unhandledError=' + String(e?.message || e));
    dumpNonSecretDiagnostics();
    fail('exception');
  }
}

main();
