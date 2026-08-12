// api/generate.js — Full 7-step workflow orchestrator

import { initDB, logRun, wasPublished, markPublished, addToQueue, isBlacklisted, getBlacklist } from '../lib/supabase.js';
import { loadSettings, validateSettings }   from '../lib/settings.js';
import { getTrendingSignals }               from '../lib/trend.js';
import { fetchTopics, enrichWithJikan }     from '../lib/fetcher.js';
import { planArticles }                     from '../lib/planner.js';
import { fetchImages }                      from '../lib/images.js';
import { writeArticle }                     from '../lib/writer.js';
import { formatPost }                       from '../lib/formatter.js';
import { publishToWordPress }               from '../lib/publisher.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const trigger   = req.method === 'POST' ? 'manual' : 'cron';
  const startTime = Date.now();

  const elapsed = () => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  console.log('[Bot] Run started —', trigger, new Date().toISOString());

  // ── INIT ──────────────────────────────────────────────────────────────────
  let settings;
  try {
    settings = await loadSettings({});
    console.log('[Bot] Settings loaded — wpUrl:', settings.wpUrl, '| hasKey:', !!settings.openrouterKey);
  } catch (e) {
    console.error('[Bot] Settings load failed:', e.message);
    return res.status(500).json({ ok: false, error: 'Settings load failed: ' + e.message, duration: elapsed() });
  }

  const { valid, missing } = validateSettings(settings);
  if (!valid) {
    console.error('[Bot] Missing settings:', missing);
    return res.status(400).json({ ok: false, error: 'Missing settings: ' + missing.join(', '), duration: elapsed() });
  }

  const runResults = {
    trigger,
    articlesGenerated: 0,
    articlesPublished: 0,
    topicsUsed:  [],
    modelsUsed:  [],
    posts:       [],
    errors:      [],
  };

  // ── STEP 1: TRENDING ──────────────────────────────────────────────────────
  console.log('[Step 1] Fetching trending signals...');
  let trendData = { all: [], googleTrending: [], annNews: [], topNames: [] };
  try {
    trendData = await getTrendingSignals();
    console.log('[Step 1] Signals:', trendData.all.length, '(Google:', trendData.googleTrending.length, ', ANN:', trendData.annNews.length + ')');
  } catch (e) {
    console.warn('[Step 1] Trend fetch failed (continuing without):', e.message);
    runResults.errors.push({ step: 1, error: e.message });
  }

  // ── STEP 2: FETCH TOPICS ──────────────────────────────────────────────────
  console.log('[Step 2] Fetching anime topics from AniList + Jikan...');
  let topics = { all: [], trending: [], seasonal: [] };
  try {
    topics = await fetchTopics(trendData.all, [], []);
    console.log('[Step 2] Topics:', topics.all.length, '(trending:', topics.trending.length + ')');
  } catch (e) {
    console.error('[Step 2] Topic fetch failed:', e.message);
    runResults.errors.push({ step: 2, error: e.message });
    const duration = elapsed();
    return res.status(500).json({ ok: false, error: 'Topic fetch failed: ' + e.message, duration, ...runResults });
  }

  if (topics.all.length === 0) {
    const duration = elapsed();
    console.warn('[Step 2] Zero topics returned from AniList');
    return res.status(200).json({ ok: false, error: 'No topics from AniList — API may be down', duration, ...runResults });
  }

  // ── STEP 3: PLAN ──────────────────────────────────────────────────────────
  console.log('[Step 3] Planning articles...');
  let plans = [];
  try {
    const articlesPerRun   = settings.articlesPerRun || 2;
    const effectiveSiteUrl = settings.siteUrl || 'https://animereza.xyz';
    plans = planArticles(topics, effectiveSiteUrl, articlesPerRun + 3);
    console.log('[Step 3] Plans generated:', plans.length);

    // Deduplicate
    const filtered = [];
    for (const plan of plans) {
      if (filtered.length >= articlesPerRun) break;
      const done = await wasPublished({}, plan.articleSlug);
      const bad  = await isBlacklisted({}, plan.articleSlug);
      if (!done && !bad) filtered.push(plan);
    }

    plans = filtered.length > 0 ? filtered : plans.slice(0, articlesPerRun);
    console.log('[Step 3] Final plans after filter:', plans.length);

  } catch (e) {
    console.error('[Step 3] Planning failed:', e.message);
    const duration = elapsed();
    return res.status(500).json({ ok: false, error: 'Planning failed: ' + e.message, duration, ...runResults });
  }

  if (plans.length === 0) {
    const duration = elapsed();
    return res.status(200).json({ ok: true, message: 'No topics to write — try again later', duration, ...runResults });
  }

  plans.forEach((p, i) => console.log(`  Plan ${i+1}: [${p.type}] "${p.h1Title}"`));

  // ── PROCESS EACH ARTICLE ──────────────────────────────────────────────────
  for (let i = 0; i < plans.length; i++) {
    const plan        = plans[i];
    const isScheduled = i > 0;
    const scheduleGap = settings.scheduleGapHrs || 4;
    const scheduledFor = isScheduled
      ? new Date(Date.now() + i * scheduleGap * 60 * 60 * 1000).toISOString()
      : null;

    console.log(`\n[Article ${i+1}/${plans.length}] "${plan.h1Title}" | ${isScheduled ? 'Scheduled +' + (i * scheduleGap) + 'hrs' : 'Publishing NOW'}`);

    try {
      // STEP 4: Images
      console.log('[Step 4] Fetching images...');
      let imageSet = { featured: null, cover: null, inArticle: [], illustrations: [], all: [] };
      try {
        const enriched = await enrichWithJikan(plan.topic);
        plan.topic     = enriched;
        imageSet       = await fetchImages(enriched, plan.type);
        console.log('[Step 4] Images — featured:', !!imageSet.featured, '| in-article:', imageSet.inArticle.length);
      } catch (e) {
        console.warn('[Step 4] Image fetch failed (continuing):', e.message);
      }

      // STEP 5: Write
      console.log('[Step 5] Writing article with OpenRouter...');
      const written = await writeArticle(settings.openrouterKey, plan, imageSet);
      console.log('[Step 5] Written —', written.wordCount, 'words | model:', written.modelsUsed?.article);

      runResults.articlesGenerated++;
      if (written.modelsUsed?.article) runResults.modelsUsed.push(written.modelsUsed.article);

      // STEP 6: Validate + Format
      console.log('[Step 6] Validating...');
      if (!written.validation.valid) {
        const err = 'Validation failed: ' + written.validation.errors.join(', ');
        console.error('[Step 6]', err);
        runResults.errors.push({ article: plan.h1Title, error: err });
        continue;
      }

      const formattedPost = formatPost(written.html, plan, imageSet, settings, scheduledFor);
      console.log('[Step 6] Formatted — category:', formattedPost.categorySlug, '| tags:', formattedPost.tags.length);

      // STEP 7: Publish
      console.log('[Step 7] Publishing to WordPress...');
      const published = await publishToWordPress(settings, formattedPost);
      console.log('[Step 7] Published — ID:', published.wpPostId, '| URL:', published.wpUrl);

      await markPublished({}, {
        slug:     plan.articleSlug,
        title:    formattedPost.title,
        wpPostId: published.wpPostId,
        wpUrl:    published.wpUrl,
        postType: plan.type,
      });

      runResults.articlesPublished++;
      runResults.topicsUsed.push(plan.topic.title);
      runResults.posts.push({
        title:     formattedPost.title,
        url:       published.wpUrl,
        type:      plan.type,
        status:    published.wpStatus,
        wordCount: written.wordCount,
        scheduled: isScheduled ? scheduledFor : null,
      });

    } catch (articleError) {
      console.error(`[Article ${i+1}] Failed:`, articleError.message);
      runResults.errors.push({ article: plan.h1Title, error: articleError.message });
    }
  }

  const duration = elapsed();
  console.log('[Bot] Done in', duration, '| Generated:', runResults.articlesGenerated, '| Published:', runResults.articlesPublished);

  return res.status(200).json({
    ok:       true,
    duration,
    ...runResults,
  });
}
