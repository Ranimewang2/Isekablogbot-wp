// lib/settings.js
// Loads settings directly from config.js — no DB, no env vars needed.

import config from '../config.js';

export function initDB() { return {}; }

let _cache    = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000;

export async function loadSettings(_db) {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  _cache = {
    wpUrl:          config.wpUrl          || '',
    wpUsername:     config.wpUsername      || '',
    wpAppPassword:  config.wpAppPassword   || '',
    openrouterKey:  config.openrouterKey   || '',
    blogName:       config.blogName        || 'My Blog',
    siteUrl:        config.siteUrl         || '',
    articlesPerRun: parseInt(config.articlesPerRun || 2),
    scheduleGapHrs: parseInt(config.scheduleGapHrs || 4),
    _raw: config,
  };

  _cacheTime = now;
  return _cache;
}

export function clearSettingsCache() {
  _cache     = null;
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
