#!/usr/bin/env node

// Repro script: sign + direct PUT + verify stored size.
//
// Usage:
//   ACCESS_TOKEN=... node scripts/test-avatar-upload-size.mjs ./path/to/image.png
// Optional:
//   API_BASE=http://127.0.0.1:3001
//
// Exits non-zero if:
// - signing fails
// - PUT fails
// - server-side verify fails
// - remote content-length mismatches local size (server enforces)

import fs from 'node:fs/promises';
import path from 'node:path';

function getApiBase() {
  const raw = String(process.env.API_BASE || '').trim();
  return (raw || 'http://127.0.0.1:3001').replace(/\/+$/, '');
}

function sniffContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return null;
}

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const token = String(process.env.ACCESS_TOKEN || '').trim();
  if (!token) {
    console.error('Missing ACCESS_TOKEN');
    process.exit(2);
  }

  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/test-avatar-upload-size.mjs <imagePath>');
    process.exit(2);
  }

  const apiBase = getApiBase();
  const buf = await fs.readFile(filePath);
  const bytes = buf.byteLength;
  const contentType = sniffContentType(filePath);
  if (!contentType) {
    console.error(`Unsupported file extension for: ${filePath}`);
    process.exit(2);
  }

  console.log(`[test] apiBase=${apiBase}`);
  console.log(`[test] file=${filePath} bytes=${bytes} contentType=${contentType}`);

  // 1) Sign
  const signRes = await fetch(`${apiBase}/uploads/sign`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      bucket: 'avatars',
      content_type: contentType,
      bytes,
    }),
  });

  const signBody = await readJsonSafe(signRes);
  if (!signRes.ok) {
    console.error('[test] sign failed', signRes.status, signBody);
    process.exit(1);
  }

  const uploadUrl = signBody?.upload_url;
  const objectKey = signBody?.object_key;
  const requestId = signBody?.request_id || signBody?.requestId || signRes.headers.get('x-request-id');

  if (!uploadUrl || !objectKey) {
    console.error('[test] sign response missing upload_url/object_key', signBody);
    process.exit(1);
  }

  console.log(`[test] signed ok request_id=${requestId || 'n/a'} object_key=${objectKey}`);

  // 2) PUT
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: buf,
  });

  if (!putRes.ok) {
    const text = await putRes.text().catch(() => null);
    console.error('[test] put failed', putRes.status, text ? text.slice(0, 500) : null);
    process.exit(1);
  }

  console.log('[test] put ok');

  // 3) Verify
  const verifyRes = await fetch(`${apiBase}/uploads/verify`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      kind: 'avatar',
      object_key: objectKey,
      expected_bytes: bytes,
    }),
  });

  const verifyBody = await readJsonSafe(verifyRes);
  if (!verifyRes.ok) {
    console.error('[test] verify failed', verifyRes.status, verifyBody);
    process.exit(1);
  }

  console.log('[test] verify ok', {
    remote_bytes: verifyBody?.remote_bytes,
    expected_bytes: verifyBody?.expected_bytes,
    tolerance_bytes: verifyBody?.tolerance_bytes,
    url: verifyBody?.url,
    request_id: verifyBody?.request_id || verifyRes.headers.get('x-request-id') || null,
  });

  console.log('[test] PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
