// lib/fetcher.js
// AniList GraphQL + Jikan topic fetcher
// Simplified query, loose filters, robust error handling

const ANILIST_URL = 'https://graphql.anilist.co';
const JIKAN_URL   = 'https://api.jikan.moe/v4';

// ─── SIMPLE RELIABLE QUERY ────────────────────────────────────────────────────
// Stripped down — fewer fields = less chance of partial failure

const TRENDING_QUERY = `
query {
  trending: Page(page: 1, perPage: 20) {
    media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
      id
      idMal

      title { romaji english }
      description(asHtml: false)
      genres
      averageScore
      popularity
      trending
      episodes
      status
      format
      season
      seasonYear
      startDate { year }
      studios(isMain: true) { nodes { name } }
      coverImage { extraLarge large }
      bannerImage
      siteUrl
      nextAiringEpisode { airingAt episode }
    }
  }
  popular: Page(page: 1, perPage: 20) {
    media(sort: POPULARITY_DESC, type: ANIME, isAdult: false, status: RELEASING) {
      id
      idMal
      title { romaji english }
      description(asHtml: false)
      genres
      averageScore
      popularity
      trending
      episodes
      status
      format
      season
      seasonYear
      startDate { year }
      studios(isMain: true) { nodes { name } }
      coverImage { extraLarge large }
      bannerImage
      siteUrl
      nextAiringEpisode { airingAt episode }
    }
  }
}`;

// ─── ANILIST FETCH ─────────────────────────────────────────────────────────────

async function anilistQuery(query, variables = {}) {
  const res = await fetch(ANILIST_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body:    JSON.stringify({ query, variables }),
    signal:  AbortSignal.timeout(15000),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`AniList HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let json;
  try { json = JSON.parse(text); } catch { throw new Error('AniList returned non-JSON: ' + text.slice(0, 100)); }

  if (json.errors) {
    throw new Error('AniList GraphQL error: ' + json.errors[0]?.message);
  }

  if (!json.data) {
    throw new Error('AniList returned no data field. Raw: ' + text.slice(0, 200));
  }

  return json.data;
}

// ─── JIKAN FETCH ──────────────────────────────────────────────────────────────

async function jikanGet(path) {
  try {
    const res = await fetch(`${JIKAN_URL}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function buildSlug(title) {
  return (title || 'anime')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function cleanDesc(desc) {
  if (!desc) return '';
  return desc
    .replace(/<[^>]+>/g, '')
    .replace(/\(Source:.*?\)/gi, '')
    .replace(/\[Written by.*?\]/gi, '')
    .trim()
    .slice(0, 600);
}

function getTitle(media) {
  return media.title?.english || media.title?.romaji || 'Unknown Anime';
}

function getStudio(media) {
  return media.studios?.nodes?.[0]?.name || 'Unknown Studio';
}

// ─── NORMALIZE ────────────────────────────────────────────────────────────────

function normalizeMedia(media, trendSignal = null) {
  const title = getTitle(media);
  return {
    slug:         buildSlug(title),
    title,
    titleRomaji:  media.title?.romaji || title,
    titleNative:  '',
    malId:        media.idMal  || null,
    anilistId:    media.id,
    anilistUrl:   media.siteUrl || '',
    description:  cleanDesc(media.description),
    genres:       media.genres || ['Action'],
    tags:         [],
    studio:       getStudio(media),
    year:         media.startDate?.year || media.seasonYear || new Date().getFullYear(),
    season:       media.season || '',
    episodes:     media.episodes || null,
    status:       media.status  || 'FINISHED',
    format:       media.format  || 'TV',
    score:        media.averageScore || 0,
    popularity:   media.popularity   || 0,
    trending:     media.trending     || 0,
    bannerImage:  media.bannerImage  || null,
    coverImage:   media.coverImage?.extraLarge || media.coverImage?.large || null,
    trailerId:    null,
    trailerSite:  null,
    nextEpisode:  media.nextAiringEpisode?.episode  || null,
    nextAiringAt: media.nextAiringEpisode?.airingAt || null,
    promoImages:  [],
    malScore:     media.averageScore ? media.averageScore / 10 : null,
    malMembers:   media.popularity || 0,
    trendSignal,
    isTrending:   !!trendSignal,
    trendSource:  trendSignal?.source || null,
    trendRelevance: trendSignal?.relevanceScore || 0,
  };
}

// ─── TREND MATCHER ────────────────────────────────────────────────────────────

function matchTrend(media, trendSignals) {
  if (!trendSignals || trendSignals.length === 0) return null;
  const title  = getTitle(media).toLowerCase();
  const romaji = (media.title?.romaji || '').toLowerCase();

  for (const signal of trendSignals) {
    const name = (signal.animeName || '').toLowerCase();
    if (!name || name.length < 3) continue;
    if (title.includes(name) || romaji.includes(name) || name.includes(title.slice(0, 8))) {
      return signal;
    }
  }
  return null;
}

// ─── JIKAN ENRICHMENT ─────────────────────────────────────────────────────────

export async function enrichWithJikan(topic) {
  if (!topic.malId) return topic;
  try {
    const pics = await jikanGet(`/anime/${topic.malId}/pictures`);
    const promoImages = pics?.data
      ? pics.data.slice(0, 5).map(p => p.jpg?.large_image_url || p.jpg?.image_url).filter(Boolean)
      : [];
    return { ...topic, promoImages };
  } catch {
    return topic;
  }
}

// ─── MAIN FETCHER ─────────────────────────────────────────────────────────────

export async function fetchTopics(trendSignals = [], publishedSlugs = [], blacklist = []) {
  console.log('[Fetcher] Querying AniList...');

  // Fetch from AniList — throws on failure so generate.js can catch it
  const data = await anilistQuery(TRENDING_QUERY);

  const trendingMedia = data?.trending?.media || [];
  const popularMedia  = data?.popular?.media  || [];

  console.log('[Fetcher] Raw results — trending:', trendingMedia.length, '| popular:', popularMedia.length);

  if (trendingMedia.length === 0 && popularMedia.length === 0) {
    throw new Error('AniList returned 0 media items in both trending and popular queries');
  }

  // Merge + deduplicate by AniList ID
  const seen    = new Set();
  const allMedia = [...trendingMedia, ...popularMedia].filter(m => {
    if (!m || !m.id) return false;
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  const excluded = new Set([...publishedSlugs, ...blacklist]);

  // Normalize all media
  const topics = allMedia
    .map(m => normalizeMedia(m, matchTrend(m, trendSignals)))
    .filter(t => !excluded.has(t.slug))
    // Very loose filter — only exclude clearly broken entries
    .filter(t => t.title && t.title !== 'Unknown Anime')
    .filter(t => ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'].includes(t.format));

  console.log('[Fetcher] After filter:', topics.length, 'valid topics');

  if (topics.length === 0) {
    console.warn('[Fetcher] All topics filtered out — format values were:', [...new Set(allMedia.map(m => m.format))].join(', '));
    // Return unfiltered as last resort
    const fallback = allMedia.map(m => normalizeMedia(m, null)).filter(t => t.title);
    console.log('[Fetcher] Fallback unfiltered:', fallback.length);
    return { all: fallback, trending: [], seasonal: fallback };
  }

  // Score topics
  const scored = topics.map(t => ({
    ...t,
    rankScore:
      (t.isTrending  ? t.trendRelevance * 3 : 0) +
      (t.trending    ? Math.min(t.trending / 10, 20) : 0) +
      (t.score       ? t.score / 10 : 0) +
      (t.status === 'RELEASING' ? 5 : 0) +
      (t.nextEpisode ? 8 : 0),
  }));

  scored.sort((a, b) => b.rankScore - a.rankScore);

  return {
    all:      scored,
    trending: scored.filter(t => t.isTrending),
    seasonal: scored.filter(t => !t.isTrending),
  };
}
