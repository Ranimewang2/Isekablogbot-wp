// config.js — Fill this before deploying to Vercel. No env vars needed.
// After editing, push to Vercel and all settings are live.

const config = {
  // ── WordPress ──────────────────────────────────────────
  wpUrl:         'https://isekaiblogging.gt.tc',       // e.g. https://animereza.xyz
  wpUsername:    'isekai',
  wpAppPassword: '4KlYfX22imD!cFlV&lWBVZCz',        // WP Application Password

  // ── OpenRouter ─────────────────────────────────────────
  openrouterKey: 'sk-or-xxxxxxxxxxxxxxxxxxxx',

  // ── Blog identity ──────────────────────────────────────
  blogName:      'My Anime Blog',
  siteUrl:       'https://yourblog.com',

  // ── WordPress category IDs (set after WP install) ──────
  categoryReview: 1,
  categoryList:   1,
  categoryNews:   1,

  // ── Generation config ──────────────────────────────────
  articlesPerRun: 2,
  scheduleGapHrs: 4,
};

export default config;
