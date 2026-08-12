// lib/images.js
// Multi-source anime image pipeline
// Sources: AniList CDN, Jikan promo pics, Safebooru character art, Waifu.im illustrations
// Returns structured image sets per article type — ready to inject into article HTML

const SAFEBOORU_URL = 'https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1';
const WAIFUIM_URL   = 'https://api.waifu.im/search';
const JIKAN_URL     = 'https://api.jikan.moe/v4';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function buildAlt(animeName, context = '') {
  return `${animeName}${context ? ' — ' + context : ''} anime`;
}

async function safeFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AnimeBot/1.0)' },
      ...options,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── SOURCE 1: ANILIST CDN ────────────────────────────────────────────────────
// Already in topic object — highest quality, 1280px+ wide
// Used as featured image on every post

function getAniListImages(topic) {
  const images = [];

  if (topic.bannerImage) {
    images.push({
      url:     topic.bannerImage,
      alt:     buildAlt(topic.title, 'banner'),
      source:  'anilist',
      type:    'banner',
      width:   1280,
      quality: 'high',
    });
  }

  if (topic.coverImage) {
    images.push({
      url:     topic.coverImage,
      alt:     buildAlt(topic.title, 'cover poster'),
      source:  'anilist',
      type:    'cover',
      width:   460,
      quality: 'high',
    });
  }

  return images;
}

// ─── SOURCE 2: JIKAN PROMO PICTURES ──────────────────────────────────────────
// Multiple official promo/key visual images per anime
// Used as in-article section images — same way CBR uses promo shots

async function getJikanPromoImages(topic) {
  if (!topic.malId) return [];

  const data = await safeFetch(`${JIKAN_URL}/anime/${topic.malId}/pictures`);
  if (!data?.data) return [];

  return data.data
    .slice(0, 6)
    .map((pic, i) => {
      const url = pic.jpg?.large_image_url || pic.jpg?.image_url || pic.webp?.large_image_url;
      if (!url) return null;
      return {
        url,
        alt:     buildAlt(topic.title, `official promo image ${i + 1}`),
        source:  'jikan',
        type:    'promo',
        width:   800,
        quality: 'medium',
      };
    })
    .filter(Boolean);
}

// ─── SOURCE 3: SAFEBOORU CHARACTER ART ───────────────────────────────────────
// SFW character artwork — no API key needed
// Used in REVIEW posts for character sections

async function getSafebooruImages(topic, limit = 3) {
  // Build tag query from anime title — normalize for booru tag format
  const tag = topic.titleRomaji
    ? topic.titleRomaji.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')
    : topic.title.toLowerCase().replace(/[^a-z0-9]/g, '_');

  const url = `${SAFEBOORU_URL}&tags=${encodeURIComponent(tag)}&limit=${limit}`;
  const data = await safeFetch(url);

  if (!Array.isArray(data) || data.length === 0) return [];

  return data
    .filter(post => post.file_url && (post.file_url.endsWith('.jpg') || post.file_url.endsWith('.png')))
    .map((post, i) => ({
      url:     post.file_url.startsWith('http') ? post.file_url : `https://safebooru.org${post.file_url}`,
      alt:     buildAlt(topic.title, `character art ${i + 1}`),
      source:  'safebooru',
      type:    'character',
      width:   post.width || 700,
      quality: 'medium',
    }));
}

// ─── SOURCE 4: WAIFU.IM ───────────────────────────────────────────────────────
// High quality SFW anime illustrations — 200 req/min free, no signup
// Used in TOP_LIST posts as visual breaks between entries

async function getWaifuImImages(limit = 3) {
  const tags = ['waifu', 'maid', 'uniform', 'school'];
  const tag  = tags[Math.floor(Math.random() * tags.length)];

  const data = await safeFetch(`${WAIFUIM_URL}?included_tags=${tag}&is_nsfw=false&many=true`);
  if (!data?.images) return [];

  return data.images
    .slice(0, limit)
    .map((img, i) => ({
      url:     img.url,
      alt:     `anime illustration ${i + 1}`,
      source:  'waifuim',
      type:    'illustration',
      width:   img.width || 700,
      quality: 'high',
    }));
}

// ─── MAIN IMAGE FETCHER ───────────────────────────────────────────────────────

export async function fetchImages(topic, articleType) {
  console.log(`[Images] Fetching images for "${topic.title}" (${articleType})`);

  // Always get AniList images (already in topic, instant)
  const anilistImages = getAniListImages(topic);

  // Fetch Jikan promo images (most useful for in-article)
  const [jikanImages, safebooruImages, waifuImages] = await Promise.allSettled([
    getJikanPromoImages(topic),
    articleType === 'REVIEW' || articleType === 'EXPLAINED'
      ? getSafebooruImages(topic, 2)
      : Promise.resolve([]),
    articleType === 'TOP_LIST'
      ? getWaifuImImages(2)
      : Promise.resolve([]),
  ]);

  const promo     = jikanImages.status     === 'fulfilled' ? jikanImages.value     : [];
  const character = safebooruImages.status === 'fulfilled' ? safebooruImages.value : [];
  const illust    = waifuImages.status     === 'fulfilled' ? waifuImages.value     : [];

  // Build structured image set
  const imageSet = {
    // Featured image — best available, priority: banner > cover > first promo
    featured: anilistImages.find(i => i.type === 'banner')
           || anilistImages.find(i => i.type === 'cover')
           || promo[0]
           || null,

    // Cover poster (used in "What Is X?" section)
    cover: anilistImages.find(i => i.type === 'cover') || promo[0] || null,

    // In-article promo shots — injected at section[hasImage] positions
    inArticle: [
      ...promo.slice(0, 3),
      ...character.slice(0, 2),
    ].filter(Boolean),

    // Illustration fills — TOP_LIST only
    illustrations: illust,

    // All images flat list
    all: [...anilistImages, ...promo, ...character, ...illust],
  };

  const total = imageSet.all.length;
  console.log(`[Images] Found ${total} images (${anilistImages.length} AniList, ${promo.length} Jikan, ${character.length} Safebooru, ${illust.length} Waifu.im)`);

  return imageSet;
}

// ─── IMAGE HTML BUILDER ───────────────────────────────────────────────────────
// Builds WP-ready <figure> HTML for injecting into article sections

export function buildImageHTML(image, caption = '') {
  if (!image?.url) return '';

  return `<figure class="ar-article-image">
  <img src="${image.url}" alt="${image.alt}" loading="lazy" decoding="async" />
  ${caption ? `<figcaption>${caption}</figcaption>` : ''}
</figure>`;
}
