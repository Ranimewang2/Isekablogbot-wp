// lib/formatter.js
// Converts raw article HTML + plan into a complete WP REST API post object
// Handles: RankMath SEO meta, JSON-LD schema (Article + FAQPage), WP categories/tags,
// internal link injection, reading time, clean final HTML

// ─── READING TIME ─────────────────────────────────────────────────────────────

function calcReadingTime(html) {
  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

// ─── EXTRACT H1 AS WP TITLE ───────────────────────────────────────────────────

function extractTitle(html) {
  const match = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
  if (!match) return null;
  return match[1].replace(/<[^>]+>/g, '').trim();
}

// ─── INTERNAL LINK INJECTOR ───────────────────────────────────────────────────
// Replaces first occurrence of anime title mentions with links to AnimeReza catalog
// Drives traffic back to animereza.xyz — critical for internal linking SEO

function injectInternalLinks(html, topic, siteUrl) {
  const mainSiteUrl = siteUrl || 'https://animereza.xyz';
  const slug = topic.slug;
  const title = topic.title;
  const romaji = topic.titleRomaji;

  let modified = html;

  // Link first mention of exact title (not inside existing anchor or heading)
  const titlePattern = new RegExp(
    `(?<!<a[^>]*>)(?<!<h[1-6][^>]*>)(${escapeRegex(title)}|${escapeRegex(romaji)})(?!</a>)(?!</h)`,
    'i'
  );

  modified = modified.replace(titlePattern, (match) => {
    return `<a href="${mainSiteUrl}/anime/${slug}" target="_blank" rel="noopener">${match}</a>`;
  });

  // Link genres to genre pages (first mention only)
  const topGenre = topic.genres[0];
  if (topGenre) {
    const genreSlug = topGenre.toLowerCase().replace(/\s+/g, '-');
    const genrePattern = new RegExp(`\\b(${escapeRegex(topGenre)})\\b(?![^<]*>)`, 'i');
    modified = modified.replace(genrePattern, (match) => {
      return `<a href="${mainSiteUrl}/genre/${genreSlug}" target="_blank" rel="noopener">${match}</a>`;
    });
  }

  return modified;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── READING TIME BADGE ───────────────────────────────────────────────────────

function buildReadingTimeBadge(minutes) {
  return `<div class="ar-reading-time">⏱️ <strong>${minutes} min read</strong></div>`;
}

// ─── ARTICLE META BAR ─────────────────────────────────────────────────────────

function buildMetaBar(topic, plan) {
  const score = topic.malScore
    ? topic.malScore.toFixed(1)
    : topic.score ? (topic.score / 10).toFixed(1) : null;

  const parts = [];
  if (topic.studio)   parts.push(`<span>🎬 ${topic.studio}</span>`);
  if (topic.year)     parts.push(`<span>📅 ${topic.year}</span>`);
  if (topic.episodes) parts.push(`<span>📺 ${topic.episodes} Episodes</span>`);
  if (score)          parts.push(`<span>⭐ ${score}/10 on MAL</span>`);
  if (topic.status === 'RELEASING') parts.push(`<span class="ar-airing">🔴 Currently Airing</span>`);

  if (parts.length === 0) return '';

  return `<div class="ar-meta-bar">${parts.join('')}</div>`;
}

// ─── AUTHOR BOX ───────────────────────────────────────────────────────────────

function buildAuthorBox() {
  return `<div class="ar-author-box">
  <div class="ar-author-info">
    <strong>AnimeReza Team</strong>
    <p>Anime enthusiasts with 1,000+ series watched. We cover everything from seasonal picks to hidden gems — helping you decide what to watch next.</p>
  </div>
</div>`;
}

// ─── JSON-LD SCHEMA ───────────────────────────────────────────────────────────
// Article schema + FAQPage schema — boosts rich results eligibility

function buildSchema(plan, topic, publishDate) {
  const schemas = [];

  // Article schema
  schemas.push({
    '@context':          'https://schema.org',
    '@type':             'Article',
    'headline':          plan.h1Title,
    'description':       plan.metaDesc,
    'image':             topic.bannerImage || topic.coverImage || '',
    'author': {
      '@type': 'Organization',
      'name':  'AnimeReza',
      'url':   'https://isekaiblogging.gt.tc',
    },
    'publisher': {
      '@type': 'Organization',
      'name':  'AnimeReza',
      'url':   'https://isekaiblogging.gt.tc',
    },
    'datePublished': publishDate || new Date().toISOString(),
    'dateModified':  new Date().toISOString(),
    'mainEntityOfPage': {
      '@type': '@id',
      '@id':   `https://isekaiblogging.gt.tc/${plan.articleSlug}/`,
    },
    'keywords': [plan.primaryKeyword, ...plan.secondaryKeywords].join(', '),
    'articleSection': plan.wpCategory,
  });

  // FAQPage schema
  if (plan.faqs && plan.faqs.length > 0) {
    schemas.push({
      '@context':  'https://schema.org',
      '@type':     'FAQPage',
      'mainEntity': plan.faqs.map(f => ({
        '@type':          'Question',
        'name':           f.q,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text':  f.hint,
        },
      })),
    });
  }

  return schemas.map(s => `<script type="application/ld+json">\n${JSON.stringify(s, null, 2)}\n</script>`).join('\n');
}

// ─── RANKMATH META FIELDS ─────────────────────────────────────────────────────
// RankMath stores SEO data in post meta with specific keys

function buildRankMathMeta(plan, topic) {
  return {
    // RankMath core fields
    'rank_math_focus_keyword':      plan.primaryKeyword,
    'rank_math_description':        plan.metaDesc,
    'rank_math_title':              plan.seoTitle,

    // RankMath robots
    'rank_math_robots':             ['index', 'follow'],

    // Open Graph
    'rank_math_og_title':           plan.h1Title,
    'rank_math_og_description':     plan.metaDesc,
    'rank_math_og_image':           topic.bannerImage || topic.coverImage || '',
    'rank_math_og_image_id':        '',  // filled after featured image upload

    // Twitter card
    'rank_math_twitter_title':      plan.h1Title,
    'rank_math_twitter_description': plan.metaDesc,
    'rank_math_twitter_image':      topic.bannerImage || topic.coverImage || '',

    // Schema type hint for RankMath
    'rank_math_schema_Article': JSON.stringify({
      '@type':      'Article',
      'headline':   plan.h1Title,
      'image':      topic.bannerImage || topic.coverImage || '',
    }),
  };
}

// ─── WP CATEGORY MAPPER ───────────────────────────────────────────────────────
// Returns category slug — actual WP category IDs set from dashboard settings

function getCategorySlug(type) {
  const map = {
    REVIEW:    'anime-reviews',
    TOP_LIST:  'anime-lists',
    NEWS:      'anime-news',
    EXPLAINED: 'anime-explained',
    GUIDE:     'anime-guides',
  };
  return map[type] || 'anime-reviews';
}

// ─── MAIN FORMATTER ───────────────────────────────────────────────────────────

export function formatPost(articleHtml, plan, imageSet, settings, scheduledFor = null) {
  const topic       = plan.topic;
  const siteUrl     = settings.siteUrl || 'https://animereza.xyz';
  const publishDate = scheduledFor ? new Date(scheduledFor).toISOString() : new Date().toISOString();

  // Inject internal links
  let html = injectInternalLinks(articleHtml, topic, siteUrl);

  // Extract H1 title from article (use as WP post title)
  const wpTitle = extractTitle(html) || plan.h1Title;

  // Reading time
  const readingMins = calcReadingTime(html);

  // Build meta bar and reading time badge
  const metaBar    = buildMetaBar(topic, plan);
  const readBadge  = buildReadingTimeBadge(readingMins);
  const authorBox  = buildAuthorBox();
  const schemaHTML = buildSchema(plan, topic, publishDate);

  // Remove H1 from article body — WP uses the post title field for H1
  const bodyHtml = html.replace(/<h1[^>]*>.*?<\/h1>/is, '').trim();

  // Assemble final WP content
  const finalContent = `${schemaHTML}
${readBadge}
${metaBar}
${bodyHtml}
${authorBox}`;

  // RankMath meta
  const rankMathMeta = buildRankMathMeta(plan, topic);

  // WP tag list
  const wpTags = [
    topic.title,
    topic.titleRomaji !== topic.title ? topic.titleRomaji : null,
    ...topic.genres.slice(0, 4),
    topic.studio,
    String(topic.year),
    'anime',
    plan.type === 'TOP_LIST'  ? 'anime recommendations' : null,
    plan.type === 'REVIEW'    ? 'anime review'          : null,
    plan.type === 'NEWS'      ? 'anime news'            : null,
    plan.type === 'EXPLAINED' ? 'anime explained'       : null,
  ].filter(Boolean);

  return {
    // WP REST API fields
    title:           wpTitle,
    content:         finalContent,
    status:          scheduledFor ? 'future' : 'publish',
    date:            publishDate,
    slug:            plan.articleSlug,
    comment_status:  'open',
    ping_status:     'open',

    // WP taxonomy (IDs resolved in publisher from settings)
    categorySlug:    getCategorySlug(plan.type),
    tags:            [...new Set(wpTags)],

    // Featured image (URL — publisher uploads and gets ID)
    featuredImageUrl: imageSet?.featured?.url || null,
    featuredImageAlt: imageSet?.featured?.alt || wpTitle,

    // RankMath meta
    meta: rankMathMeta,

    // Internal tracking
    articleSlug:     plan.articleSlug,
    primaryKeyword:  plan.primaryKeyword,
    metaDesc:        plan.metaDesc,
    seoTitle:        plan.seoTitle,
    wordCount:       readingMins * 220,
    readingMins,
    type:            plan.type,
    animeTitle:      topic.title,
    anilistId:       topic.anilistId,
  };
}
