#!/usr/bin/env node

import pg from 'pg';

const { Pool } = pg;

function getSupabasePublicStorageBase() {
  const explicit = String(process.env.SUPABASE_PUBLIC_STORAGE_BASE || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public`;
}

function buildPublicStorageUrl(bucket, key) {
  const base = getSupabasePublicStorageBase();
  if (!base) return null;
  const b = String(bucket || '').trim().replace(/^\/+|\/+$/g, '');
  const k = String(key || '').trim().replace(/^\/+/, '');
  if (!b || !k) return null;
  return `${base}/${b}/${k}`;
}

function bucketForBanners() {
  return String(process.env.SUPABASE_BUCKET_BANNERS || 'banners').trim() || 'banners';
}

function toUploadsPath(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return null;
  if (s.startsWith('/uploads/')) return s;
  if (s.startsWith('uploads/')) return `/${s}`;
  const idx = s.indexOf('/uploads/');
  if (idx >= 0) return s.slice(idx);
  return null;
}

function convertUploadsToPublicUrl(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  const uploadsPath = toUploadsPath(raw);
  if (!uploadsPath) return null;

  const rest = uploadsPath.slice('/uploads/'.length).replace(/^\/+/, '');
  if (!rest) return null;
  return buildPublicStorageUrl(bucketForBanners(), rest);
}

function expectedBannerKeyPatternForUser(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const escaped = uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp)$`, 'i');
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    dryRun: args.has('--dry-run') || args.has('-n'),
    limit: (() => {
      const m = argv.find((a) => a && a.startsWith('--limit='));
      if (!m) return null;
      const n = Number(m.split('=')[1]);
      return Number.isFinite(n) ? Math.max(1, Math.min(50_000, Math.floor(n))) : null;
    })(),
  };
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv);
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    console.error('Missing DATABASE_URL');
    process.exit(1);
  }
  const base = getSupabasePublicStorageBase();
  if (!base) {
    console.error('Missing SUPABASE_PUBLIC_STORAGE_BASE or SUPABASE_URL');
    process.exit(1);
  }

  const bannersBucket = bucketForBanners();
  const pool = new Pool({ connectionString: databaseUrl });

  const res = await pool.query(
    `SELECT id, user_id, banner_url
     FROM user_profiles
     WHERE banner_url IS NOT NULL
       AND banner_url <> ''
       AND banner_url NOT ILIKE 'http%'
     ${limit ? `LIMIT ${limit}` : ''}`
  );

  const planned = [];
  for (const row of res.rows || []) {
    const id = row.id;
    const userId = row.user_id;
    const raw = row.banner_url != null ? String(row.banner_url).trim() : '';
    if (!raw) continue;

    // Convert legacy /uploads paths.
    const fromUploads = convertUploadsToPublicUrl(raw);
    if (fromUploads) {
      planned.push({ id, next: fromUploads, reason: 'uploads_to_public' });
      continue;
    }

    // Accept object key only if it matches the expected pattern.
    const pattern = expectedBannerKeyPatternForUser(userId);
    if (!pattern) continue;

    const cleaned = raw.replace(/^\/+/, '');

    // bucket:path
    const colonIdx = cleaned.indexOf(':');
    if (colonIdx > 0 && !cleaned.slice(0, colonIdx).includes('/')) {
      const bucket = cleaned.slice(0, colonIdx).trim();
      const path = cleaned.slice(colonIdx + 1).replace(/^\/+/, '').trim();
      if (bucket === bannersBucket && pattern.test(path)) {
        const next = buildPublicStorageUrl(bannersBucket, path);
        if (next) planned.push({ id, next, reason: 'bucket_colon_key' });
      }
      continue;
    }

    // bucket/path
    const firstSlash = cleaned.indexOf('/');
    if (firstSlash > 0) {
      const maybeBucket = cleaned.slice(0, firstSlash).trim();
      const rest = cleaned.slice(firstSlash + 1).replace(/^\/+/, '').trim();
      if (maybeBucket === bannersBucket && pattern.test(rest)) {
        const next = buildPublicStorageUrl(bannersBucket, rest);
        if (next) planned.push({ id, next, reason: 'bucket_slash_key' });
      }
      continue;
    }

    // raw key
    if (pattern.test(cleaned)) {
      const next = buildPublicStorageUrl(bannersBucket, cleaned);
      if (next) planned.push({ id, next, reason: 'raw_key' });
    }
  }

  console.log(`Planned banner_url repairs: ${planned.length}${dryRun ? ' (dry-run)' : ''}`);

  if (!planned.length) {
    await pool.end();
    return;
  }

  if (dryRun) {
    for (const p of planned.slice(0, 25)) {
      console.log(p);
    }
    if (planned.length > 25) console.log(`... (${planned.length - 25} more)`);
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of planned) {
      await client.query('UPDATE user_profiles SET banner_url = $2, updated_at = NOW() WHERE id = $1', [p.id, p.next]);
    }
    await client.query('COMMIT');
    console.log('Repair complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
