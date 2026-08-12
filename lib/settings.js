// lib/settings.js
// Loads settings from config.js — no DB, no env vars needed.

import { getAllSettings } from './supabase.js';

export function initDB() { return {}; }

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000;

export async function loadSettings(_db) {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  const raw = getAllSettings();

  _cache = {
    wpUrl:          raw.wp_url,
    wpUsername:     raw.wp_username,
    wpAppPassword:  raw.wp_app_password,
    openrouterKey:  raw.openrouter_key,
    blogName:       raw.blog_name        || 'My Blog',
    siteUrl:        raw.site_url         || '',
    categoryReview: parseInt(raw.category_review  || '1'),
    categoryList:   parseInt(raw.category_list    || '1'),
    categoryNews:   parseInt(raw.category_news    || '1'),
    articlesPerRun: parseInt(raw.articles_per_run || '2'),
    scheduleGapHrs: parseInt(raw.schedule_gap_hrs || '4'),
    _raw: raw,
  };

  _cacheTime = now;
  return _cache;
}

export function clearSettingsCache() {
  _cache = null;
  _cacheTime = 0;
}

export function validateSettings(s) {
  const missing = [];
  if (!s.wpUrl)         missing.push('wpUrl');
  if (!s.wpUsername)    missing.push('wpUsername');
  if (!s.wpAppPassword) missing.push('wpAppPassword');
  if (!s.openrouterKey) missing.push('openrouterKey');
  return { valid: missing.length === 0, missing };
}
