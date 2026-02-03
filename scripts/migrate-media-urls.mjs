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

function bucketForMediaKind(kind) {
  const avatarsBucket = String(process.env.SUPABASE_BUCKET_AVATARS || 'avatars').trim() || 'avatars';
  const bannersBucket = String(process.env.SUPABASE_BUCKET_BANNERS || 'banners').trim() || 'banners';
  const movementBucket = String(process.env.SUPABASE_BUCKET_MOVEMENT_MEDIA || 'movement-media').trim() || 'movement-media';
  if (kind === 'avatar') return avatarsBucket;
  if (kind === 'banner') return bannersBucket;
  return movementBucket;
}

function convertUploadsToPublicUrl(value, { kindHint } = {}) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  const stripQueryAndHash = (s) => String(s || '').split(/[?#]/)[0];
  const cleaned = stripQueryAndHash(raw);

  let uploadsPath = null;
  if (cleaned.startsWith('/uploads/')) uploadsPath = cleaned;
  else if (cleaned.startsWith('uploads/')) uploadsPath = `/${cleaned}`;
  else {
    const idx = cleaned.indexOf('/uploads/');
    if (idx !== -1) uploadsPath = cleaned.slice(idx);
  }

  if (!uploadsPath) return raw;

  const base = getSupabasePublicStorageBase();
  if (!base) return null;

  const rest = uploadsPath.slice('/uploads/'.length).replace(/^\/+/, '');
  if (!rest) return null;

  const kind = kindHint === 'avatar' || kindHint === 'banner' || kindHint === 'movement-media' ? kindHint : 'movement-media';
  const bucket = bucketForMediaKind(kind);
  return `${base}/${bucket}/${rest}`;
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    dryRun: args.has('--dry-run') || args.has('-n'),
  };
}

async function main() {
  const { dryRun } = parseArgs(process.argv);
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    console.error('Missing DATABASE_URL');
    process.exit(1);
  }

  const base = getSupabasePublicStorageBase();
  if (!base) {
    console.error('Missing SUPABASE_PUBLIC_STORAGE_BASE or SUPABASE_URL (needed to convert /uploads to public URLs)');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  const updates = [];
  const addUpdate = (sql, params) => updates.push({ sql, params });

  const run = async (sql, params = []) => pool.query(sql, params);

  // user_profiles: profile_photo_url, banner_url
  {
    const res = await run(
      `SELECT user_email, profile_photo_url, banner_url
       FROM user_profiles
       WHERE (profile_photo_url ILIKE '%/uploads/%') OR (banner_url ILIKE '%/uploads/%')`
    );
    for (const row of res.rows || []) {
      const nextPhoto = convertUploadsToPublicUrl(row.profile_photo_url, { kindHint: 'avatar' }) ?? row.profile_photo_url;
      const nextBanner = convertUploadsToPublicUrl(row.banner_url, { kindHint: 'banner' }) ?? row.banner_url;
      if (nextPhoto !== row.profile_photo_url || nextBanner !== row.banner_url) {
        addUpdate(
          'UPDATE user_profiles SET profile_photo_url = $2, banner_url = $3 WHERE user_email = $1',
          [row.user_email, nextPhoto, nextBanner]
        );
      }
    }
  }

  // conversations: group_avatar_url
  {
    const res = await run(
      `SELECT id, group_avatar_url
       FROM conversations
       WHERE group_avatar_url ILIKE '%/uploads/%'`
    );
    for (const row of res.rows || []) {
      const next = convertUploadsToPublicUrl(row.group_avatar_url, { kindHint: 'avatar' });
      if (next && next !== row.group_avatar_url) {
        addUpdate('UPDATE conversations SET group_avatar_url = $2 WHERE id = $1', [row.id, next]);
      }
    }
  }

  // movement_resources: file_url
  {
    const res = await run(
      `SELECT id, file_url
       FROM movement_resources
       WHERE file_url ILIKE '%/uploads/%'`
    );
    for (const row of res.rows || []) {
      const next = convertUploadsToPublicUrl(row.file_url, { kindHint: 'movement-media' });
      if (next && next !== row.file_url) {
        addUpdate('UPDATE movement_resources SET file_url = $2 WHERE id = $1', [row.id, next]);
      }
    }
  }

  // movement_evidence: url
  {
    const res = await run(
      `SELECT id, url
       FROM movement_evidence
       WHERE url ILIKE '%/uploads/%'`
    );
    for (const row of res.rows || []) {
      const next = convertUploadsToPublicUrl(row.url, { kindHint: 'movement-media' });
      if (next && next !== row.url) {
        addUpdate('UPDATE movement_evidence SET url = $2 WHERE id = $1', [row.id, next]);
      }
    }
  }

  // movements: media_urls (jsonb array) + claims (jsonb)
  {
    const res = await run(
      `SELECT id, media_urls, claims
       FROM movements
       WHERE (media_urls::text ILIKE '%/uploads/%') OR (claims::text ILIKE '%/uploads/%')`
    );

    for (const row of res.rows || []) {
      let nextMedia = row.media_urls;
      let nextClaims = row.claims;
      let changed = false;

      if (Array.isArray(row.media_urls)) {
        const converted = row.media_urls
          .map((u) => convertUploadsToPublicUrl(u, { kindHint: 'movement-media' }) ?? u)
          .filter(Boolean);
        if (JSON.stringify(converted) !== JSON.stringify(row.media_urls)) {
          nextMedia = converted;
          changed = true;
        }
      }

      if (Array.isArray(row.claims)) {
        const convertedClaims = row.claims.map((c) => {
          if (!c || typeof c !== 'object') return c;
          const out = { ...c };
          if (Array.isArray(out.evidence)) {
            out.evidence = out.evidence.map((e) => {
              if (!e || typeof e !== 'object') return e;
              const ev = { ...e };
              if (ev.url) {
                const convertedUrl = convertUploadsToPublicUrl(ev.url, { kindHint: 'movement-media' });
                if (convertedUrl) ev.url = convertedUrl;
              }
              return ev;
            });
          }
          return out;
        });

        if (JSON.stringify(convertedClaims) !== JSON.stringify(row.claims)) {
          nextClaims = convertedClaims;
          changed = true;
        }
      }

      if (changed) {
        addUpdate('UPDATE movements SET media_urls = $2::jsonb, claims = $3::jsonb WHERE id = $1', [row.id, nextMedia ?? null, nextClaims ?? null]);
      }
    }
  }

  console.log(`Planned updates: ${updates.length}${dryRun ? ' (dry-run)' : ''}`);

  if (!updates.length) {
    await pool.end();
    return;
  }

  if (dryRun) {
    for (const u of updates.slice(0, 20)) {
      console.log(u.sql, u.params);
    }
    if (updates.length > 20) console.log(`... (${updates.length - 20} more)`);
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      await client.query(u.sql, u.params);
    }
    await client.query('COMMIT');
    console.log('Migration complete.');
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
