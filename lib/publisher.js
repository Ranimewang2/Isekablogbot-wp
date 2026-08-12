// lib/publisher.js
// WordPress REST API publisher
// Handles: image download → WP Media upload, category/tag resolution,
// post creation with RankMath meta, scheduling, InfinityFree header bypass

// ─── WP REST HELPERS ──────────────────────────────────────────────────────────

function wpHeaders(settings) {
  // WP Application Passwords are valid with or without spaces — strip them for Basic auth
  const cleanPass = (settings.wpAppPassword || '').replace(/\s+/g, '');
  const token = Buffer.from(`${settings.wpUsername}:${cleanPass}`).toString('base64');
  return {
    'Authorization': `Basic ${token}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    // InfinityFree bot-block bypass — sends browser-like UA
    'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
}

async function wpFetch(settings, path, options = {}) {
  const url = `${settings.wpUrl.replace(/\/$/, '')}/wp-json/wp/v2${path}`;
  const res  = await fetch(url, {
    ...options,
    headers: { ...wpHeaders(settings), ...(options.headers || {}) },
    signal:  AbortSignal.timeout(30000),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.code || text.slice(0, 200);
    throw new Error(`WP API ${res.status} on ${path}: ${msg}`);
  }

  return data;
}

// ─── IMAGE UPLOAD ─────────────────────────────────────────────────────────────
// Downloads image from URL → uploads to WP Media Library → returns media ID

async function uploadFeaturedImage(settings, imageUrl, altText) {
  if (!imageUrl) return null;

  console.log(`[Publisher] Uploading featured image: ${imageUrl.slice(0, 60)}...`);

  // Download image
  let imageBuffer, contentType;
  try {
    const imgRes = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AnimeBot/1.0)' },
    });
    if (!imgRes.ok) throw new Error(`Image download failed: ${imgRes.status}`);

    contentType  = imgRes.headers.get('content-type') || 'image/jpeg';
    imageBuffer  = await imgRes.arrayBuffer();
  } catch (e) {
    console.warn(`[Publisher] Image download failed: ${e.message}`);
    return null;
  }

  // Detect extension
  const ext      = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const filename = `anime-${Date.now()}.${ext}`;

  // Upload to WP Media
  const url     = `${settings.wpUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`;
  const cleanPass2 = (settings.wpAppPassword || '').replace(/\s+/g, '');
  const token   = Buffer.from(`${settings.wpUsername}:${cleanPass2}`).toString('base64');

  const uploadRes = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization':        `Basic ${token}`,
      'Content-Disposition':  `attachment; filename="${filename}"`,
      'Content-Type':         contentType,
      'User-Agent':           'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body:   imageBuffer,
    signal: AbortSignal.timeout(30000),
  });

  const mediaData = await uploadRes.json();
  if (!uploadRes.ok) {
    console.warn(`[Publisher] Media upload failed: ${mediaData?.message}`);
    return null;
  }

  // Set alt text
  try {
    await fetch(`${url}/${mediaData.id}`, {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${token}`,
        'Content-Type':  'application/json',
        'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        alt_text: altText,
        caption:  altText,
        title:    altText,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Alt text set failure is non-fatal
  }

  console.log(`[Publisher] Image uploaded — media ID: ${mediaData.id}`);
  return mediaData.id;
}

// ─── CATEGORY RESOLVER ────────────────────────────────────────────────────────
// Gets WP category ID by slug, creates it if it doesn't exist

async function resolveCategoryId(settings, slug, name) {
  // Try to find existing
  try {
    const cats = await wpFetch(settings, `/categories?slug=${slug}&per_page=1`);
    if (Array.isArray(cats) && cats.length > 0) {
      return cats[0].id;
    }
  } catch (e) {
    console.warn(`[Publisher] Category search failed: ${e.message}`);
  }

  // Create new category
  try {
    const newCat = await wpFetch(settings, '/categories', {
      method: 'POST',
      body:   JSON.stringify({ name: name || slug, slug }),
    });
    console.log(`[Publisher] Created category: ${slug} (ID: ${newCat.id})`);
    return newCat.id;
  } catch (e) {
    console.warn(`[Publisher] Category create failed: ${e.message}`);
    return 1; // Fallback to uncategorized
  }
}

// ─── TAG RESOLVER ─────────────────────────────────────────────────────────────
// Gets or creates WP tags, returns array of IDs

async function resolveTagIds(settings, tagNames) {
  if (!tagNames || tagNames.length === 0) return [];

  const ids = [];
  for (const name of tagNames.slice(0, 10)) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-');
    try {
      // Search existing
      const found = await wpFetch(settings, `/tags?slug=${slug}&per_page=1`);
      if (Array.isArray(found) && found.length > 0) {
        ids.push(found[0].id);
        continue;
      }
      // Create new
      const newTag = await wpFetch(settings, '/tags', {
        method: 'POST',
        body:   JSON.stringify({ name, slug }),
      });
      ids.push(newTag.id);
    } catch {
      // Skip failed tags — non-fatal
    }
  }

  return ids;
}

// ─── CATEGORY NAME MAP ────────────────────────────────────────────────────────

const CATEGORY_NAMES = {
  'anime-reviews':   'Anime Reviews',
  'anime-lists':     'Anime Lists',
  'anime-news':      'Anime News',
  'anime-explained': 'Anime Explained',
  'anime-guides':    'Anime Guides',
};

// ─── MAIN PUBLISHER ───────────────────────────────────────────────────────────

export async function publishToWordPress(settings, formattedPost) {
  console.log(`[Publisher] Publishing: "${formattedPost.title}" (${formattedPost.status})`);

  // 1. Upload featured image
  const featuredMediaId = await uploadFeaturedImage(
    settings,
    formattedPost.featuredImageUrl,
    formattedPost.featuredImageAlt,
  );

  // 2. Resolve category ID
  const categoryId = await resolveCategoryId(
    settings,
    formattedPost.categorySlug,
    CATEGORY_NAMES[formattedPost.categorySlug] || formattedPost.categorySlug,
  );

  // 3. Resolve tag IDs
  const tagIds = await resolveTagIds(settings, formattedPost.tags);

  // 4. Build post meta (RankMath + custom)
  const postMeta = {
    ...formattedPost.meta,
    // Update OG image ID now that we have the media ID
    'rank_math_og_image_id': String(featuredMediaId || ''),
  };

  // 5. Publish post
  const postBody = {
    title:          formattedPost.title,
    content:        formattedPost.content,
    slug:           formattedPost.articleSlug,
    status:         formattedPost.status,      // 'publish' or 'future'
    date:           formattedPost.date,         // ISO 8601 — WP schedules future posts
    categories:     [categoryId],
    tags:           tagIds,
    featured_media: featuredMediaId || 0,
    comment_status: 'open',
    ping_status:    'open',
    meta:           postMeta,
    // RankMath also reads from excerpt as fallback for meta desc
    excerpt:        formattedPost.metaDesc,
  };

  const post = await wpFetch(settings, '/posts', {
    method: 'POST',
    body:   JSON.stringify(postBody),
  });

  console.log(`[Publisher] ✓ Post created — ID: ${post.id} | URL: ${post.link}`);

  return {
    wpPostId:   post.id,
    wpUrl:      post.link,
    wpStatus:   post.status,
    wpSlug:     post.slug,
    mediaId:    featuredMediaId,
    categoryId,
    tagIds,
  };
}

// ─── CONNECTION TEST ─────────────────────────────────────────────────────────

export async function testWPConnection(settings) {
  try {
    const data = await wpFetch(settings, '/users/me');
    return {
      ok:       true,
      username: data.name || data.slug || data.login || data.user_login || settings.wpUsername,
      roles:    data.roles || [],
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
