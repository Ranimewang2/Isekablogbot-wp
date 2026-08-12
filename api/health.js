// api/health.js
// Health check + settings endpoint for the dashboard.
// Settings are read from config.js (edit that file and redeploy to update).

import { initDB, initSchema, getAllSettings } from '../lib/supabase.js';
import { loadSettings, validateSettings, clearSettingsCache } from '../lib/settings.js';
import { testWPConnection } from '../lib/publisher.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = initDB();

  // ── GET: health check ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const settings = await loadSettings(db);
      const { valid, missing } = validateSettings(settings);
      return res.status(200).json({
        ok:         true,
        status:     'running',
        configured: valid,
        missing:    valid ? [] : missing,
        wpUrl:      settings.wpUrl   || null,
        blogName:   settings.blogName || null,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, settings: newSettings } = req.body || {};

    if (action === 'init') {
      await initSchema(db);
      return res.status(200).json({ ok: true, message: 'Ready' });
    }

    // Get settings — read from config.js
    if (action === 'get_settings') {
      try {
        const all = getAllSettings();
        // Mask sensitive values for display
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

    // Save settings — not supported without a DB; tell the user what to do
    if (action === 'save_settings') {
      return res.status(200).json({
        ok:      false,
        error:   'Edit config.js in your project and redeploy to update settings.',
        hint:    'Open config.js, update your credentials, then push to Vercel.',
      });
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

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
