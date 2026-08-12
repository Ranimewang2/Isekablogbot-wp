// api/health.js

import config from '../config.js';
import { loadSettings, validateSettings } from '../lib/settings.js';
import { testWPConnection } from '../lib/publisher.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: health check ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const settings = await loadSettings({});
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
    const body = req.body || {};
    const action = body.action;

    // Get settings for dashboard display
    if (action === 'get_settings') {
      return res.status(200).json({
        ok: true,
        settings: {
          wp_url:      config.wpUrl      || '',
          wp_username: config.wpUsername || '',
          wp_app_password: config.wpAppPassword ? '••••••••' + config.wpAppPassword.slice(-4) : '',
          openrouter_key:  config.openrouterKey  ? '••••••••' + config.openrouterKey.slice(-4)  : '',
          blog_name:   config.blogName   || '',
          site_url:    config.siteUrl    || '',
          articles_per_run: String(config.articlesPerRun || 2),
          schedule_gap_hrs: String(config.scheduleGapHrs || 4),
        },
      });
    }

    // Save settings — no DB, show instruction
    if (action === 'save_settings') {
      return res.status(200).json({
        ok:    false,
        error: 'To update settings: edit config.js in your GitHub repo → Vercel auto-redeploys.',
      });
    }

    // Test WP connection
    if (action === 'test_wp') {
      try {
        const settings = await loadSettings({});
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
