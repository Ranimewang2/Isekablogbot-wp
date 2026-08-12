// api/generate.js
// Main bot endpoint — full 7-step workflow orchestrator
// Step 1: Trending → Step 2: Topics → Step 3: Plan → Step 4: Images
// → Step 5: Write → Step 6: Validate → Step 7: Publish to WP
// Generates 2 articles per run: #1 publishes immediately, #2 schedules +4hrs

import { initDB, logRun, wasPublished, markPublished, addToQueue, isBlacklisted, getBlacklist } from '../lib/supabase.js';
import { loadSettings, validateSettings }                                                          from '../lib/settings.js';
import { getTrendingSignals }                                                                       from '../lib/trend.js';
import { fetchTopics, enrichWithJikan }                                                             from '../lib/fetcher.js';
import { planArticles }                                                                             from '../lib/planner.js';
import { fetchImages }                                                                              from '../lib/images.js';
import { writeArticle }                                                                             from '../lib/writer.js';
import { formatPost }                                                                               from '../lib/formatter.js';
import { publishToWordPress }                                                                       from '../lib/publisher.js';

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Allow GET (cron) and POST (manual dashboard trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const trigger  = req.method === 'POST' ? 'manual' : 'cron';
  const startTime = Date.now();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[Bot] Run started — trigger: ${trigger} | ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(60)}`);

  // ── INIT ────────────────────────────────────────────────────────────────────
  let db, settings;
  try {
    db       = initDB();
    settings = await loadSettings(db);
  } catch (e) {
    console.error('[Bot] Init failed:', e.message);
    return res.status(500).json({ error: 'Database init failed', detail: e.message });
  }

  // Validate credentials
  const { valid, missing } = validateSettings(settings);
  if (!valid) {
    return res.status(400).json({
      error:   'Missing required settings',
      missing,
      hint:    'Configure credentials in the dashboard settings panel',
    });
  }

  const runResults = {
    trigger,
    articlesGenerated: 0,
    articlesPublished: 0,
    topicsUsed:        [],
    modelsUsed:        [],
    posts:             [],
    errors:            [],
  };

  try {
    // ── STEP 1: TRENDING SIGNALS ────────────────────────────────────────────
    console.log('\n[Step 1] Fetching trending signals...');
    const trendData = await getTrendingSignals();
    console.log(`[Step 1] ✓ ${trendData.all.length} signals (${trendData.googleTrending.length} Google, ${trendData.annNews.length} ANN)`);

    // ── STEP 2: FETCH + SCORE TOPICS ───────────────────────────────────────
    console.log('\n[Step 2] Fetching and scoring anime topics...');
    const blacklist      = await getBlacklist(db);
    const recentSlugs    = []; // Dedup is handled per-topic below via wasPublished()

    const topics = await fetchTopics(trendData.all, recentSlugs, blacklist);
    console.log(`[Step 2] ✓ ${topics.all.length} topics (${topics.trending.length} trending)`);

    // ── STEP 3: PLAN ARTICLES ───────────────────────────────────────────────
    console.log('\n[Step 3] Planning articles...');
    const articlesPerRun = settings.articlesPerRun || 2;
    const effectiveSiteUrl = settings.siteUrl || 'https://animereza.xyz';
    const rawPlans = planArticles(topics, effectiveSiteUrl, articlesPerRun + 3);
    console.log(`[Step 3] Raw plans generated: ${rawPlans.length}`);

    // Filter out already published slugs
    const plans = [];
    for (const plan of rawPlans) {
      if (plans.length >= articlesPerRun) break;
      const slug = plan.articleSlug;
      const alreadyDone = await wasPublished(db, slug);
      const blacklisted = await isBlacklisted(db, slug);
      if (alreadyDone)  { console.log(`[Step 3] Skip (published): ${slug}`);   continue; }
      if (blacklisted)  { console.log(`[Step 3] Skip (blacklisted): ${slug}`); continue; }
      plans.push(plan);
    }

    if (plans.length === 0) {
      // If topics exist but plans are 0 — force pick from all topics ignoring dedup
      console.warn('[Step 3] No plans from filtered topics — forcing from full pool');
      const forced = planArticles(topics, effectiveSiteUrl, articlesPerRun);
      plans.push(...forced.slice(0, articlesPerRun));
    }

    if (plans.length === 0) {
      const msg = `No topics available. Trending: ${topics.trending.length}, Seasonal: ${topics.seasonal.length}`;
      console.warn('[Step 3]', msg);
      const duration = Date.now() - startTime;
      return res.status(200).json({ ok: true, message: msg, duration: `${(duration/1000).toFixed(1)}s`, ...runResults });
    }

    console.log(`[Step 3] ✓ ${plans.length} articles planned`);
    plans.forEach((p, i) => console.log(`  ${i + 1}. [${p.type}] "${p.h1Title}"`));

    // ── PROCESS EACH ARTICLE ────────────────────────────────────────────────
    for (let i = 0; i < plans.length; i++) {
      const plan         = plans[i];
      const isScheduled  = i > 0; // First article publishes now, rest are scheduled
      const scheduleGap  = settings.scheduleGapHrs || 4;
      const scheduledFor = isScheduled
        ? new Date(Date.now() + i * scheduleGap * 60 * 60 * 1000).toISOString()
        : null;

      console.log(`\n${'─'.repeat(50)}`);
      console.log(`[Bot] Processing article ${i + 1}/${plans.length}: "${plan.h1Title}"`);
      console.log(`[Bot] Type: ${plan.type} | ${isScheduled ? `Scheduled: ${scheduledFor}` : 'Publishing NOW'}`);

      try {
        // ── STEP 4: IMAGES ────────────────────────────────────────────────
        console.log('\n[Step 4] Fetching images...');
        const enrichedTopic = await enrichWithJikan(plan.topic);
        plan.topic          = enrichedTopic;
        const imageSet      = await fetchImages(enrichedTopic, plan.type);
        console.log(`[Step 4] ✓ Featured: ${imageSet.featured ? 'yes' : 'no'} | In-article: ${imageSet.inArticle.length}`);

        // ── STEP 5: WRITE ARTICLE ─────────────────────────────────────────
        console.log('\n[Step 5] Writing article...');
        const written = await writeArticle(settings.openrouterKey, plan, imageSet);
        console.log(`[Step 5] ✓ ${written.wordCount} words | Models: ${written.modelsUsed.article}`);

        runResults.articlesGenerated++;
        runResults.modelsUsed.push(written.modelsUsed.article);

        // ── STEP 6: VALIDATE + FORMAT ─────────────────────────────────────
        console.log('\n[Step 6] Validating and formatting...');
        if (!written.validation.valid) {
          const errMsg = `Validation failed: ${written.validation.errors.join(', ')}`;
          console.error('[Step 6]', errMsg);
          runResults.errors.push({ article: plan.h1Title, error: errMsg });
          continue; // Skip to next article
        }

        const formattedPost = formatPost(written.html, plan, imageSet, settings, scheduledFor);
        console.log(`[Step 6] ✓ Formatted | Category: ${formattedPost.categorySlug} | Tags: ${formattedPost.tags.length}`);

        // Save to queue regardless (for dashboard visibility)
        await addToQueue(db, {
          slug:        plan.articleSlug,
          title:       formattedPost.title,
          postType:    plan.type,
          topicData:   plan.topic,
          articleHtml: written.html,
          wpMeta:      formattedPost.meta,
          scheduledFor,
        });

        // ── STEP 7: PUBLISH TO WORDPRESS ──────────────────────────────────
        console.log('\n[Step 7] Publishing to WordPress...');
        const published = await publishToWordPress(settings, formattedPost);
        console.log(`[Step 7] ✓ Published — ID: ${published.wpPostId} | URL: ${published.wpUrl}`);

        // Mark as published in dedup log
        await markPublished(db, {
          slug:      plan.articleSlug,
          title:     formattedPost.title,
          wpPostId:  published.wpPostId,
          wpUrl:     published.wpUrl,
          postType:  plan.type,
        });

        runResults.articlesPublished++;
        runResults.topicsUsed.push(plan.topic.title);
        runResults.posts.push({
          title:    formattedPost.title,
          url:      published.wpUrl,
          type:     plan.type,
          status:   published.wpStatus,
          wordCount: written.wordCount,
          scheduled: isScheduled ? scheduledFor : null,
        });

      } catch (articleError) {
        console.error(`[Bot] Article ${i + 1} failed:`, articleError.message);
        runResults.errors.push({ article: plan.h1Title, error: articleError.message });
      }
    }

  } catch (fatalError) {
    console.error('[Bot] Fatal error:', fatalError.message);
    runResults.errors.push({ article: 'global', error: fatalError.message });
    await logRun(db, {
      ...runResults,
      error:      fatalError.message,
      success:    false,
      durationMs: Date.now() - startTime,
    });
    return res.status(500).json({ ok: false, error: fatalError.message, ...runResults });
  }

  // ── LOG RUN ────────────────────────────────────────────────────────────────
  const duration = Date.now() - startTime;
  await logRun(db, {
    ...runResults,
    success:    runResults.errors.length === 0,
    durationMs: duration,
  });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[Bot] Run complete in ${(duration / 1000).toFixed(1)}s`);
  console.log(`[Bot] Generated: ${runResults.articlesGenerated} | Published: ${runResults.articlesPublished} | Errors: ${runResults.errors.length}`);
  console.log(`${'═'.repeat(60)}\n`);

  return res.status(200).json({
    ok:        true,
    duration:  `${(duration / 1000).toFixed(1)}s`,
    ...runResults,
  });
}
