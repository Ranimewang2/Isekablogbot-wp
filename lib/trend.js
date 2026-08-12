// lib/trend.js
// Real search-intent trending using Google Trends Daily RSS + ANN RSS
// No API key needed. Filters for anime-relevant rising search terms.

const TRENDS_RSS_URL = 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US';
const ANN_RSS_URL    = 'https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us';

// ─── ANIME KEYWORD SIGNALS ────────────────────────────────────────────────────
// Terms that indicate a trending search is anime-related

const ANIME_SIGNALS = [
  // Genre / format
  'anime', 'manga', 'isekai', 'shounen', 'seinen', 'shojo', 'mecha',
  // Studios
  'mappa', 'ufotable', 'bones', 'wit studio', 'madhouse', 'ghibli', 'trigger',
  // Currently airing Summer 2026 — highest priority
  'bleach', 'tybw', 'thousand year blood war',
  'jujutsu kaisen', 'jjk',
  'mushoku tensei', 'jobless reincarnation',
  'frieren', 'beyond journeys end',
  'dandadan', 're zero', 'rezero',
  'black clover', 'dragon ball', 'one piece', 'naruto', 'boruto',
  'attack on titan', 'aot', 'shingeki',
  'demon slayer', 'kimetsu', 'hashira',
  'chainsaw man', 'spy x family', 'vinland saga',
  'solo leveling', 'overlord', 'sword art online', 'sao',
  'my hero academia', 'mha', 'boku no hero',
  'one punch man', 'hunter x hunter', 'hxh',
  'fullmetal alchemist', 'fma', 'evangelion', 'nge',
  'death note', 'tokyo ghoul', 'tokyo revengers',
  'made in abyss', 'violet evergarden', 'your lie in april',
  'classroom of the elite', 'cote', 'oshi no ko',
  'blue lock', 'haikyuu', 'slam dunk',
  // Keywords people Google about anime
  'season 2', 'season 3', 'season 4', 'episode', 'finale', 'trailer',
  'release date', 'air date', 'dubbed', 'subbed', 'crunchyroll', 'netflix anime',
  'new anime', 'best anime', 'anime 2026', 'anime review',
];

// ─── PARSE RSS XML ────────────────────────────────────────────────────────────

function parseRSSItems(xml, titleTag = 'title') {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[1];

    // title — handle CDATA and plain
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is);
    const title = titleMatch?.[1]?.trim() || '';

    // traffic / approx_traffic (Google Trends specific)
    const trafficMatch = block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/i);
    const traffic = trafficMatch ? parseInt(trafficMatch[1].replace(/[^0-9]/g, '')) || 0 : 0;

    // related queries (Google Trends specific)
    const relatedMatches = [...block.matchAll(/<ht:query>(.*?)<\/ht:query>/gi)];
    const related = relatedMatches.map((m) => m[1].trim());

    // pub date
    const dateMatch = block.match(/<pubDate>(.*?)<\/pubDate>/i);
    const pubDate = dateMatch?.[1]?.trim() || '';

    if (title) items.push({ title, traffic, related, pubDate });
  }

  return items;
}

// ─── ANIME RELEVANCE SCORER ───────────────────────────────────────────────────

function animeRelevanceScore(text) {
  const lower = text.toLowerCase();
  let score = 0;
  let matchedSignals = [];

  for (const signal of ANIME_SIGNALS) {
    if (lower.includes(signal)) {
      score += signal.length > 6 ? 3 : 1; // longer = more specific = more points
      matchedSignals.push(signal);
    }
  }

  return { score, matchedSignals };
}

function isAnimeRelated(text, relatedTerms = []) {
  const fullText = [text, ...relatedTerms].join(' ');
  const { score } = animeRelevanceScore(fullText);
  return score > 0;
}

// ─── EXTRACT CLEAN ANIME TITLE ────────────────────────────────────────────────
// From a raw Google Trends title like "Bleach TYBW Episode 21 release date"
// extract the likely anime name for AniList search

function extractAnimeName(title) {
  return title
    .replace(/episode\s*\d+/gi, '')
    .replace(/season\s*\d+/gi, '')
    .replace(/release date/gi, '')
    .replace(/trailer/gi, '')
    .replace(/review/gi, '')
    .replace(/dubbed?/gi, '')
    .replace(/subbed?/gi, '')
    .replace(/\d{4}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── GOOGLE TRENDS RSS ────────────────────────────────────────────────────────

async function fetchGoogleTrends() {
  try {
    const res = await fetch(TRENDS_RSS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AnimeBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[Trend] Google Trends RSS returned ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const items = parseRSSItems(xml);

    const animeItems = items
      .filter((item) => isAnimeRelated(item.title, item.related))
      .map((item) => {
        const { score, matchedSignals } = animeRelevanceScore(
          [item.title, ...item.related].join(' ')
        );
        return {
          source: 'google_trends',
          rawTitle: item.title,
          animeName: extractAnimeName(item.title),
          searchVolume: item.traffic,
          relevanceScore: score,
          matchedSignals,
          related: item.related,
          pubDate: item.pubDate,
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log(`[Trend] Google Trends: ${items.length} total, ${animeItems.length} anime-related`);
    return animeItems;

  } catch (e) {
    console.error('[Trend] Google Trends fetch failed:', e.message);
    return [];
  }
}

// ─── ANN RSS (Anime News Network) ─────────────────────────────────────────────

async function fetchANNNews() {
  try {
    const res = await fetch(ANN_RSS_URL, {
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const items = parseRSSItems(xml);

    return items.slice(0, 15).map((item) => ({
      source: 'ann_news',
      rawTitle: item.title,
      animeName: extractAnimeName(item.title),
      searchVolume: 0,
      relevanceScore: 2, // ANN is always anime — baseline score
      matchedSignals: ['ann'],
      related: [],
      pubDate: item.pubDate,
    }));

  } catch (e) {
    console.error('[Trend] ANN RSS fetch failed:', e.message);
    return [];
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export async function getTrendingSignals() {
  console.log('[Trend] Fetching trending signals...');

  const [googleTrends, annNews] = await Promise.allSettled([
    fetchGoogleTrends(),
    fetchANNNews(),
  ]);

  const trends = [
    ...(googleTrends.status === 'fulfilled' ? googleTrends.value : []),
    ...(annNews.status    === 'fulfilled' ? annNews.value    : []),
  ];

  // Deduplicate by animeName similarity
  const seen = new Set();
  const deduped = trends.filter((t) => {
    const key = t.animeName.toLowerCase().slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[Trend] ${deduped.length} unique trending signals (${trends.filter(t => t.source === 'google_trends').length} from Google, ${trends.filter(t => t.source === 'ann_news').length} from ANN)`);

  return {
    all: deduped,
    googleTrending: deduped.filter((t) => t.source === 'google_trends'),
    annNews: deduped.filter((t) => t.source === 'ann_news'),
    // Top anime names for AniList search matching
    topNames: deduped.slice(0, 10).map((t) => t.animeName).filter(Boolean),
  };
}
