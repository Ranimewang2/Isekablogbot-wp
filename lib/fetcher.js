// lib/fetcher.js
// Fetches anime data from AniList GraphQL + Jikan REST
// Matches against trending signals, builds rich topic objects for the planner

const ANILIST_URL = 'https://graphql.anilist.co';
const JIKAN_URL   = 'https://api.jikan.moe/v4';

// ─── ANILIST GRAPHQL QUERIES ──────────────────────────────────────────────────

const TRENDING_QUERY = `
query($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
  trending: Page(page: $page, perPage: $perPage) {
    media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
      id malId title { romaji english native }
      description(asHtml: false)
      genres tags { name rank }
      averageScore popularity trending
      episodes status format
      startDate { year month day }
      endDate   { year month day }
      season seasonYear
      studios(isMain: true) { nodes { name } }
      coverImage { extraLarge large }
      bannerImage
      trailer { id site }
      siteUrl
      nextAiringEpisode { airingAt episode }
    }
  }
  seasonal: Page(page: 1, perPage: 20) {
    media(season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      id malId title { romaji english native }
      description(asHtml: false)
      genres tags { name rank }
      averageScore popularity trending
      episodes status format
      startDate { year month day }
      season seasonYear
      studios(isMain: true) { nodes { name } }
      coverImage { extraLarge large }
      bannerImage
      trailer { id site }
      siteUrl
      nextAiringEpisode { airingAt episode }
    }
  }
}`;

const SEARCH_QUERY = `
query($search: String) {
  Page(page: 1, perPage: 5) {
    media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
      id malId title { romaji english native }
      description(asHtml: false)
      genres tags { name rank }
      averageScore popularity trending
      episodes status format
      startDate { year month day }
      season seasonYear
      studios(isMain: true) { nodes { name } }
      coverImage { extraLarge large }
      bannerImage
      trailer { id site }
      siteUrl
      nextAiringEpisode { airingAt episode }
    }
  }
}`;

// ─── ANILIST FETCH ─────────────────────────────────────────────────────────────

async function anilistQuery(query, variables = {}) {
  try {
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message);
    return json.data;
  } catch (e) {
    console.error('[Fetcher] AniList error:', e.message);
    return null;
  }
}

// ─── JIKAN FETCH ──────────────────────────────────────────────────────────────

async function jikanGet(path) {
  try {
    const res = await fetch(`${JIKAN_URL}${path}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Jikan HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error('[Fetcher] Jikan error:', e.message);
    return null;
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  const year  = new Date().getFullYear();
  const season = month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL';
  return { season, year };
}

function buildSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function cleanDescription(desc) {
  if (!desc) return '';
  return desc
    .replace(/<[^>]+>/g, '')
    .replace(/\(Source:.*?\)/gi, '')
    .replace(/\[Written by.*?\]/gi, '')
    .trim()
    .slice(0, 600);
}

function getTitle(media) {
  return media.title?.english || media.title?.romaji || media.title?.native || 'Unknown';
}

function getStudio(media) {
  return media.studios?.nodes?.[0]?.name || 'Unknown Studio';
}

function getYear(media) {
  return media.startDate?.year || media.seasonYear || new Date().getFullYear();
}

// ─── NORMALIZE ANILIST MEDIA → TOPIC OBJECT ──────────────────────────────────

function normalizeMedia(media, trendSignal = null) {
  const title = getTitle(media);
  const slug  = buildSlug(title);

  return {
    // Identity
    slug,
    title,
    titleRomaji:  media.title?.romaji || title,
    titleNative:  media.title?.native || '',
    malId:        media.malId,
    anilistId:    media.id,
    anilistUrl:   media.siteUrl || '',

    // Metadata
    description:  cleanDescription(media.description),
    genres:       media.genres || [],
    tags:         (media.tags || []).slice(0, 8).map(t => t.name),
    studio:       getStudio(media),
    year:         getYear(media),
    season:       media.season || '',
    episodes:     media.episodes || null,
    status:       media.status || 'UNKNOWN',
    format:       media.format || 'TV',

    // Scores
    score:       media.averageScore || 0,
    popularity:  media.popularity   || 0,
    trending:    media.trending      || 0,

    // Images
    bannerImage: media.bannerImage || null,
    coverImage:  media.coverImage?.extraLarge || media.coverImage?.large || null,

    // Trailer
    trailerId:   media.trailer?.id   || null,
    trailerSite: media.trailer?.site || null,

    // Airing
    nextEpisode:      media.nextAiringEpisode?.episode    || null,
    nextAiringAt:     media.nextAiringEpisode?.airingAt   || null,

    // Trending signal match
    trendSignal:      trendSignal || null,
    isTrending:       !!trendSignal,
    trendSource:      trendSignal?.source || null,
    trendRelevance:   trendSignal?.relevanceScore || 0,
  };
}

// ─── TREND MATCHING ───────────────────────────────────────────────────────────

function matchTrend(media, trendSignals) {
  const title = getTitle(media).toLowerCase();
  const romaji = (media.title?.romaji || '').toLowerCase();

  for (const signal of trendSignals) {
    const name = signal.animeName.toLowerCase();
    if (!name || name.length < 3) continue;

    if (
      title.includes(name) ||
      romaji.includes(name) ||
      name.includes(title.slice(0, 10)) ||
      signal.related.some(r => title.includes(r.toLowerCase()))
    ) {
      return signal;
    }
  }
  return null;
}

// ─── JIKAN ENRICHMENT ─────────────────────────────────────────────────────────
// Adds extra promo images + MAL score to a topic

export async function enrichWithJikan(topic) {
  if (!topic.malId) return topic;

  const [pics, anime] = await Promise.allSettled([
    jikanGet(`/anime/${topic.malId}/pictures`),
    jikanGet(`/anime/${topic.malId}`),
  ]);

  const pictures = pics.status === 'fulfilled' && pics.value?.data
    ? pics.value.data.slice(0, 5).map(p => p.jpg?.large_image_url || p.jpg?.image_url).filter(Boolean)
    : [];

  const malScore = anime.status === 'fulfilled' && anime.value?.data
    ? anime.value.data.score
    : null;

  const malMembers = anime.status === 'fulfilled' && anime.value?.data
    ? anime.value.data.members
    : null;

  return {
    ...topic,
    promoImages: pictures,
    malScore:    malScore || topic.score / 10,
    malMembers:  malMembers || topic.popularity,
  };
}

// ─── MAIN FETCHER ─────────────────────────────────────────────────────────────

export async function fetchTopics(trendSignals = [], publishedSlugs = [], blacklist = []) {
  console.log('[Fetcher] Starting topic fetch...');

  const { season, year } = getCurrentSeason();
  const excluded = new Set([...publishedSlugs, ...blacklist]);

  // 1. AniList — trending + seasonal
  const data = await anilistQuery(TRENDING_QUERY, {
    page: 1, perPage: 25, season, seasonYear: year,
  });

  const allMedia = [
    ...(data?.trending?.media || []),
    ...(data?.seasonal?.media || []),
  ];

  // 2. If trending signals have names that didn't appear in AniList results,
  //    search for them directly
  const foundTitles = new Set(allMedia.map(m => getTitle(m).toLowerCase().slice(0, 15)));
  const unmatchedSignals = trendSignals.filter(
    s => s.animeName && !foundTitles.has(s.animeName.toLowerCase().slice(0, 15))
  );

  const searchResults = await Promise.allSettled(
    unmatchedSignals.slice(0, 3).map(s => anilistQuery(SEARCH_QUERY, { search: s.animeName }))
  );

  for (const result of searchResults) {
    if (result.status === 'fulfilled' && result.value?.Page?.media) {
      allMedia.push(...result.value.Page.media);
    }
  }

  // 3. Deduplicate by AniList ID
  const seenIds = new Set();
  const uniqueMedia = allMedia.filter(m => {
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  // 4. Normalize + match trends + filter excluded
  const topics = uniqueMedia
    .map(m => {
      const trendMatch = matchTrend(m, trendSignals);
      return normalizeMedia(m, trendMatch);
    })
    .filter(t => !excluded.has(t.slug))
    .filter(t => t.score > 50 || t.isTrending) // min quality bar
    .filter(t => t.format === 'TV' || t.format === 'MOVIE' || t.format === 'OVA');

  // 5. Score topics for ranking
  const scored = topics.map(t => ({
    ...t,
    rankScore:
      (t.isTrending   ? t.trendRelevance * 3 : 0) +
      (t.trending      ? Math.min(t.trending / 10, 20) : 0) +
      (t.score         ? t.score / 10 : 0) +
      (t.status === 'RELEASING' ? 5 : 0) +
      (t.nextEpisode   ? 8 : 0),
  }));

  scored.sort((a, b) => b.rankScore - a.rankScore);

  console.log(`[Fetcher] ${scored.length} valid topics (${scored.filter(t => t.isTrending).length} trending)`);

  return {
    all: scored,
    trending: scored.filter(t => t.isTrending),
    seasonal: scored.filter(t => !t.isTrending),
  };
}
