// api/posts.js
// Dashboard data endpoint
// GET /api/posts?action=recent    → recent published posts
// GET /api/posts?action=queue     → article queue
// GET /api/posts?action=runs      → bot run history
// GET /api/posts?action=stats     → queue + run stats
// POST /api/posts                 → blacklist a slug

import { initDB }                                                     from '../lib/supabase.js';
import { getRecentPublished, getQueuedArticles, getRecentRuns,
         getQueueStats, addToBlacklist, getBlacklist,
         updateQueueStatus }                                           from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db     = initDB();
  const action = req.query?.action || req.body?.action;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      if (action === 'recent') {
        const posts = await getRecentPublished(db, 20);
        return res.status(200).json({ ok: true, posts });
      }

      if (action === 'queue') {
        const queued = await getQueuedArticles(db, 'ready');
        return res.status(200).json({ ok: true, queue: queued });
      }

      if (action === 'runs') {
        const runs = await getRecentRuns(db, 15);
        return res.status(200).json({ ok: true, runs });
      }

      if (action === 'stats') {
        const [queueStats, runs, blacklist] = await Promise.all([
          getQueueStats(db),
          getRecentRuns(db, 5),
          getBlacklist(db),
        ]);
        return res.status(200).json({
          ok: true,
          queue:     queueStats,
          lastRun:   runs[0] || null,
          blacklist: blacklist.length,
        });
      }

      if (action === 'blacklist') {
        const list = await getBlacklist(db);
        return res.status(200).json({ ok: true, blacklist: list });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action: postAction, slug, id, status } = req.body || {};

    // Blacklist a topic slug
    if (postAction === 'blacklist' && slug) {
      await addToBlacklist(db, slug);
      return res.status(200).json({ ok: true, blacklisted: slug });
    }

    // Update queue item status
    if (postAction === 'update_queue' && id) {
      await updateQueueStatus(db, id, status || 'published');
      return res.status(200).json({ ok: true, updated: id });
    }

    return res.status(400).json({ error: 'Unknown action or missing fields' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
