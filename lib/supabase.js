// lib/supabase.js
// Supabase removed — all functions stubbed. Settings come from config.js.
// Add a real DB later by replacing this file.

import config from '../config.js';

export function initDB() { return {}; }
export async function initSchema() { return { ok: true }; }

// ── Settings ──────────────────────────────────────────────────────────────────

export function getAllSettings() {
  return {
    wp_url:           config.wpUrl          || '',
    wp_username:      config.wpUsername      || '',
    wp_app_password:  config.wpAppPassword   || '',
    openrouter_key:   config.openrouterKey   || '',
    blog_name:        config.blogName        || 'My Blog',
    site_url:         config.siteUrl         || '',
    articles_per_run: String(config.articlesPerRun || 2),
    schedule_gap_hrs: String(config.scheduleGapHrs || 4),
    category_review:  String(config.categoryReview  || 1),
    category_list:    String(config.categoryList    || 1),
    category_news:    String(config.categoryNews    || 1),
  };
}

export async function getSetting(_, key) { return getAllSettings()[key] || null; }
export async function bulkSetSettings()  { return true; } // no-op, edit config.js instead

// ── Dedup (no persistence — no duplicate check) ───────────────────────────────

export async function wasPublished()      { return false; }
export async function markPublished()     { return true; }
export async function getRecentPublished(){ return []; }

// ── Queue (no-op) ─────────────────────────────────────────────────────────────

export async function addToQueue()        { return true; }
export async function getQueuedArticles() { return []; }
export async function getNextQueued()     { return null; }
export async function updateQueueStatus() { return true; }
export async function getQueueStats()     { return { ready: 0, published: 0, failed: 0, total: 0 }; }

// ── Run log (console only) ────────────────────────────────────────────────────

export async function logRun(_, data) { console.log('[RunLog]', JSON.stringify(data)); }
export async function getRecentRuns() { return []; }

// ── Blacklist (no-op) ─────────────────────────────────────────────────────────

export async function getBlacklist()   { return []; }
export async function addToBlacklist() { return true; }
export async function isBlacklisted()  { return false; }
