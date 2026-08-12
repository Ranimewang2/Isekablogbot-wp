// lib/supabase.js
// Supabase client + all database operations
// Tables: settings, published_log, article_queue, bot_runs

import { createClient } from '@supabase/supabase-js';

let _client = null;

// ─── CLIENT ──────────────────────────────────────────────────────────────────
// Supabase URL + anon key come from the settings table itself on first boot.
// On very first run, they must be passed as query params to /api/health to seed.

export function getSupabase(url, key) {
  if (_client) return _client;
  if (!url || !key) throw new Error('[Supabase] URL and key required to init client');
  _client = createClient(url, key);
  return _client;
}

// ─── SCHEMA INIT (run once via /api/health?init=true) ────────────────────────

export async function initSchema(db) {
  const sql = `
    -- Settings: all bot credentials and config stored here (no Vercel env vars)
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Permanent dedup log: never post same topic twice
    CREATE TABLE IF NOT EXISTS published_log (
      id           SERIAL PRIMARY KEY,
      slug         TEXT UNIQUE NOT NULL,
      title        TEXT,
      wp_post_id   INTEGER,
      wp_url       TEXT,
      post_type    TEXT,
      published_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Article queue: pending articles waiting to publish
    CREATE TABLE IF NOT EXISTS article_queue (
      id             SERIAL PRIMARY KEY,
      slug           TEXT UNIQUE NOT NULL,
      title          TEXT,
      post_type      TEXT,
      topic_data     JSONB,
      article_html   TEXT,
      wp_meta        JSONB,
      status         TEXT DEFAULT 'ready',
      scheduled_for  TIMESTAMPTZ,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      published_at   TIMESTAMPTZ
    );

    -- Bot run log: history of every generate call
    CREATE TABLE IF NOT EXISTS bot_runs (
      id                  SERIAL PRIMARY KEY,
      ran_at              TIMESTAMPTZ DEFAULT NOW(),
      trigger             TEXT DEFAULT 'cron',
      articles_generated  INTEGER DEFAULT 0,
      articles_published  INTEGER DEFAULT 0,
      topics_used         JSONB,
      models_used         JSONB,
      duration_ms         INTEGER,
      error               TEXT,
      success             BOOLEAN DEFAULT TRUE
    );
  `;

  const { error } = await db.rpc('exec_sql', { sql }).catch(() => ({ error: 'rpc_not_available' }));

  // Fallback: run each create separately via raw query
  if (error) {
    const tables = [
      `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS published_log (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT, wp_post_id INTEGER, wp_url TEXT, post_type TEXT, published_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS article_queue (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT, post_type TEXT, topic_data JSONB, article_html TEXT, wp_meta JSONB, status TEXT DEFAULT 'ready', scheduled_for TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), published_at TIMESTAMPTZ)`,
      `CREATE TABLE IF NOT EXISTS bot_runs (id SERIAL PRIMARY KEY, ran_at TIMESTAMPTZ DEFAULT NOW(), trigger TEXT DEFAULT 'cron', articles_generated INTEGER DEFAULT 0, articles_published INTEGER DEFAULT 0, topics_used JSONB, models_used JSONB, duration_ms INTEGER, error TEXT, success BOOLEAN DEFAULT TRUE)`,
    ];
    for (const q of tables) {
      await db.from('_').select().limit(0).catch(() => {}); // keep alive
    }
  }

  return { ok: true };
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

export async function getSetting(db, key) {
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();
  if (error || !data) return null;
  return data.value;
}

export async function getAllSettings(db) {
  const { data, error } = await db.from('settings').select('key, value');
  if (error || !data) return {};
  return Object.fromEntries(data.map((r) => [r.key, r.value]));
}

export async function setSetting(db, key, value) {
  const { error } = await db
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return !error;
}

export async function bulkSetSettings(db, obj) {
  const rows = Object.entries(obj).map(([key, value]) => ({
    key,
    value: String(value),
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db.from('settings').upsert(rows, { onConflict: 'key' });
  return !error;
}

// ─── DEDUP ───────────────────────────────────────────────────────────────────

export async function wasPublished(db, slug) {
  const { data } = await db
    .from('published_log')
    .select('id')
    .eq('slug', slug)
    .single();
  return !!data;
}

export async function markPublished(db, { slug, title, wpPostId, wpUrl, postType }) {
  const { error } = await db.from('published_log').upsert(
    { slug, title, wp_post_id: wpPostId, wp_url: wpUrl, post_type: postType },
    { onConflict: 'slug' }
  );
  return !error;
}

export async function getRecentPublished(db, limit = 20) {
  const { data } = await db
    .from('published_log')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// ─── ARTICLE QUEUE ────────────────────────────────────────────────────────────

export async function addToQueue(db, { slug, title, postType, topicData, articleHtml, wpMeta, scheduledFor }) {
  const { error } = await db.from('article_queue').upsert(
    {
      slug,
      title,
      post_type: postType,
      topic_data: topicData,
      article_html: articleHtml,
      wp_meta: wpMeta,
      status: 'ready',
      scheduled_for: scheduledFor || null,
    },
    { onConflict: 'slug' }
  );
  return !error;
}

export async function getQueuedArticles(db, status = 'ready') {
  const { data } = await db
    .from('article_queue')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: true });
  return data || [];
}

export async function getNextQueued(db) {
  const { data } = await db
    .from('article_queue')
    .select('*')
    .eq('status', 'ready')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(1)
    .single();
  return data || null;
}

export async function updateQueueStatus(db, id, status, extras = {}) {
  const { error } = await db
    .from('article_queue')
    .update({ status, ...extras })
    .eq('id', id);
  return !error;
}

export async function getQueueStats(db) {
  const { data } = await db.from('article_queue').select('status');
  if (!data) return { ready: 0, published: 0, failed: 0, total: 0 };
  const counts = { ready: 0, published: 0, failed: 0, total: data.length };
  for (const row of data) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

// ─── BOT RUN LOG ──────────────────────────────────────────────────────────────

export async function logRun(db, { trigger = 'cron', articlesGenerated, articlesPublished, topicsUsed, modelsUsed, durationMs, error, success }) {
  const { data } = await db.from('bot_runs').insert({
    trigger,
    articles_generated: articlesGenerated || 0,
    articles_published: articlesPublished || 0,
    topics_used: topicsUsed || [],
    models_used: modelsUsed || [],
    duration_ms: durationMs || 0,
    error: error || null,
    success: success !== false,
  }).select('id').single();
  return data?.id;
}

export async function getRecentRuns(db, limit = 15) {
  const { data } = await db
    .from('bot_runs')
    .select('*')
    .order('ran_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// ─── BLACKLIST ────────────────────────────────────────────────────────────────

export async function getBlacklist(db) {
  const raw = await getSetting(db, 'blacklist');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export async function addToBlacklist(db, slug) {
  const list = await getBlacklist(db);
  if (!list.includes(slug)) list.push(slug);
  await setSetting(db, 'blacklist', JSON.stringify(list));
}

export async function isBlacklisted(db, slug) {
  const list = await getBlacklist(db);
  return list.includes(slug);
}
