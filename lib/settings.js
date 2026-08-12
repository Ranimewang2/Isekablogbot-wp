// lib/settings.js
// Loads all bot credentials and config from Supabase settings table.
// Zero Vercel env vars needed — everything stored in DB via dashboard.

import { getSupabase, getAllSettings } from './supabase.js';

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000; // 1 min cache so we don't hammer Supabase on every call

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
// On very first run, Supabase URL + anon key are passed as query params to
// /api/health?init=true&sb_url=xxx&sb_key=xxx — they get saved to env only once
// via Vercel env, then everything else is stored in Supabase settings table.
// After that, dashboard handles all credential management.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

export function initDB() {
  return getSupabase(SUPABASE_URL, SUPABASE_KEY);
}

// ─── LOAD ALL SETTINGS ────────────────────────────────────────────────────────

export async function loadSettings(db) {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  const raw = await getAllSettings(db);

  _cache = {
    // WordPress
    wpUrl:         raw.wp_url        || '',   // e.g. https://blog.animereza.xyz
    wpUsername:    raw.wp_username   || '',
    wpAppPassword: raw.wp_app_password || '',

    // OpenRouter (same key from blogger bot)
    openrouterKey: raw.openrouter_key || '',

    // Blog identity
    blogName:      raw.blog_name     || 'AnimeReza Blog',
    siteUrl:       raw.site_url      || 'https://animereza.xyz',

    // RankMath category IDs (set from dashboard after WP install)
    categoryReview:  parseInt(raw.category_review  || '1'),
    categoryList:    parseInt(raw.category_list    || '1'),
    categoryNews:    parseInt(raw.category_news    || '1'),

    // Generation config
    articlesPerRun:  parseInt(raw.articles_per_run || '2'),
    scheduleGapHrs:  parseInt(raw.schedule_gap_hrs || '4'),

    // Raw for anything extra
    _raw: raw,
  };

  _cacheTime = now;
  return _cache;
}

export function clearSettingsCache() {
  _cache = null;
  _cacheTime = 0;
}

// ─── VALIDATE ─────────────────────────────────────────────────────────────────

export function validateSettings(s) {
  const missing = [];
  if (!s.wpUrl)          missing.push('wp_url');
  if (!s.wpUsername)     missing.push('wp_username');
  if (!s.wpAppPassword)  missing.push('wp_app_password');
  if (!s.openrouterKey)  missing.push('openrouter_key');
  return { valid: missing.length === 0, missing };
}
