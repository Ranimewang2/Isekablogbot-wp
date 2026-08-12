// api/health.js
// Health check endpoint — also handles first-time schema init and settings save
// GET  /api/health          → status check
// POST /api/health/settings → save settings from dashboard

import { initDB, initSchema, getAllSettings, bulkSetSettings } from '../lib/supabase.js';
import { loadSettings, validateSettings, clearSettingsCache }   from '../lib/settings.js';
import { testWPConnection }                                       from '../lib/publisher.js';

export default async function handler(req, res) {
  // CORS for dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = initDB();

  // ── GET: health check ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const settings   = await loadSettings(db);
      const { valid, missing } = validateSettings(settings);

      return res.status(200).json({
        ok:       true,
        status:   'running',
        configured: valid,
        missing:  valid ? [] : missing,
        wpUrl:    settings.wpUrl || null,
        blogName: settings.blogName || null,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── POST: save settings ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, settings: newSettings } = req.body || {};

    // Init schema (first-time setup)
    if (action === 'init') {
      try {
        await initSchema(db);
        return res.status(200).json({ ok: true, message: 'Schema initialized' });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    // Save settings
    if (action === 'save_settings' && newSettings) {
      try {
        // Map dashboard field names to DB keys
        const dbMap = {
          wpUrl:          'wp_url',
          wpUsername:     'wp_username',
          wpAppPassword:  'wp_app_password',
          openrouterKey:  'openrouter_key',
          blogName:       'blog_name',
          siteUrl:        'site_url',
          articlesPerRun: 'articles_per_run',
          scheduleGapHrs: 'schedule_gap_hrs',
        };

        const toSave = {};
        for (const [frontKey, dbKey] of Object.entries(dbMap)) {
          if (newSettings[frontKey] !== undefined && newSettings[frontKey] !== '') {
            toSave[dbKey] = String(newSettings[frontKey]);
          }
        }

        await bulkSetSettings(db, toSave);
        clearSettingsCache();
        return res.status(200).json({ ok: true, message: 'Settings saved', saved: Object.keys(toSave) });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    // Test WP connection
    if (action === 'test_wp') {
      try {
        const settings = await loadSettings(db);
        const result   = await testWPConnection(settings);
        return res.status(200).json({ ok: result.ok, ...result });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    // Get all current settings (masked)
    if (action === 'get_settings') {
      try {
        const all = await getAllSettings(db);
        // Mask sensitive values
        const masked = {};
        for (const [k, v] of Object.entries(all)) {
          if (k.includes('password') || k.includes('key')) {
            masked[k] = v ? '••••••••' + v.slice(-4) : '';
          } else {
            masked[k] = v;
          }
        }
        return res.status(200).json({ ok: true, settings: masked });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
