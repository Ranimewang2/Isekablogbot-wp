// lib/planner.js
// Takes scored topics and builds complete article plans.
// Decides article type, target keywords, structure, CTA placements, FAQ questions.
// This is "Step 3" in the workflow — the brain that tells the writer exactly what to write.

// ─── ARTICLE TYPES ────────────────────────────────────────────────────────────

export const ARTICLE_TYPES = {
  REVIEW:     'REVIEW',     // "Is X worth watching?" — review + verdict
  TOP_LIST:   'TOP_LIST',   // "Top 10 anime like X" — list post
  NEWS:       'NEWS',       // "X Season 2 confirmed" — news post
  EXPLAINED:  'EXPLAINED',  // "X ending explained" — breakdown post
  GUIDE:      'GUIDE',      // "Where to watch X" — utility post
};

// ─── ARTICLE TYPE DECISION ────────────────────────────────────────────────────
// Pairs of REVIEW + TOP_LIST work best for traffic:
// REVIEW captures "is X worth watching" searches
// TOP_LIST captures "anime like X" searches

function decideArticleType(topic, existingType = null) {
  // News: airing anime with a new episode very recently
  if (topic.nextEpisode && topic.status === 'RELEASING' && topic.isTrending) {
    if (!existingType) return ARTICLE_TYPES.NEWS;
  }

  // Explained: if the trend signal mentions "ending" or "explained"
  const trendTitle = topic.trendSignal?.rawTitle?.toLowerCase() || '';
  if (trendTitle.includes('ending') || trendTitle.includes('explained') || trendTitle.includes('finale')) {
    return ARTICLE_TYPES.EXPLAINED;
  }

  // Default pair logic — avoid two of the same type in one run
  if (existingType === ARTICLE_TYPES.REVIEW)   return ARTICLE_TYPES.TOP_LIST;
  if (existingType === ARTICLE_TYPES.TOP_LIST) return ARTICLE_TYPES.REVIEW;
  if (existingType === ARTICLE_TYPES.NEWS)     return ARTICLE_TYPES.REVIEW;

  // First pick: trending → REVIEW, non-trending → TOP_LIST
  return topic.isTrending ? ARTICLE_TYPES.REVIEW : ARTICLE_TYPES.TOP_LIST;
}

// ─── KEYWORD BUILDER ─────────────────────────────────────────────────────────

function buildKeywords(topic, type) {
  const title = topic.title;
  const year  = topic.year || new Date().getFullYear();

  const kw = {
    [ARTICLE_TYPES.REVIEW]: {
      primary:   `is ${title} worth watching`,
      secondary: [`${title} review`, `${title} anime review ${year}`, `should i watch ${title}`, `${title} explained`, `${title} rating`],
      slug:      `is-${buildSlug(title)}-worth-watching`,
    },
    [ARTICLE_TYPES.TOP_LIST]: {
      primary:   `anime like ${title}`,
      secondary: [`best anime similar to ${title}`, `${title} recommendations`, `if you liked ${title}`, `anime like ${title} ${year}`],
      slug:      `best-anime-like-${buildSlug(title)}`,
    },
    [ARTICLE_TYPES.NEWS]: {
      primary:   `${title} episode ${topic.nextEpisode || ''} release date`,
      secondary: [`${title} new episode`, `${title} schedule`, `when does ${title} air`, `${title} ${year}`],
      slug:      `${buildSlug(title)}-episode-${topic.nextEpisode || 'latest'}-release-date`,
    },
    [ARTICLE_TYPES.EXPLAINED]: {
      primary:   `${title} ending explained`,
      secondary: [`${title} finale explained`, `${title} plot explained`, `${title} what happened`, `${title} story breakdown`],
      slug:      `${buildSlug(title)}-ending-explained`,
    },
    [ARTICLE_TYPES.GUIDE]: {
      primary:   `where to watch ${title}`,
      secondary: [`${title} streaming`, `watch ${title} online`, `${title} dubbed`, `${title} crunchyroll`],
      slug:      `where-to-watch-${buildSlug(title)}`,
    },
  };

  return kw[type] || kw[ARTICLE_TYPES.REVIEW];
}

function buildSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
}

// ─── SECTION BUILDER ─────────────────────────────────────────────────────────

function buildSections(topic, type) {
  const title = topic.title;
  const studio = topic.studio;
  const score  = topic.malScore ? topic.malScore.toFixed(1) : (topic.score / 10).toFixed(1);

  const sections = {
    [ARTICLE_TYPES.REVIEW]: [
      { id: 'intro',      heading: null,                                              hasCTA: false, hasImage: false },
      { id: 'what',       heading: `What Is ${title}?`,                              hasCTA: false, hasImage: true  },
      { id: 'story',      heading: `Story and Plot Overview`,                         hasCTA: false, hasImage: false },
      { id: 'why',        heading: `Why ${title} Stands Out`,                        hasCTA: true,  hasImage: true  },
      { id: 'characters', heading: `Characters Worth Caring About`,                   hasCTA: false, hasImage: false },
      { id: 'animation',  heading: `Animation and Sound Quality`,                     hasCTA: false, hasImage: false },
      { id: 'who',        heading: `Who Should Watch ${title}?`,                     hasCTA: false, hasImage: false },
      { id: 'similar',    heading: `Similar Anime You Might Enjoy`,                   hasCTA: true,  hasImage: false },
      { id: 'faq',        heading: `Frequently Asked Questions`,                      hasCTA: false, hasImage: false },
      { id: 'verdict',    heading: `Final Verdict: Is ${title} Worth Watching?`,     hasCTA: true,  hasImage: false },
    ],
    [ARTICLE_TYPES.TOP_LIST]: [
      { id: 'intro',      heading: null,                                              hasCTA: false, hasImage: false },
      { id: 'why',        heading: `Why ${title} Fans Need More Anime`,               hasCTA: false, hasImage: true  },
      { id: 'list',       heading: `Best Anime Like ${title}`,                        hasCTA: true,  hasImage: true  },
      { id: 'honorable',  heading: `Honorable Mentions`,                              hasCTA: false, hasImage: false },
      { id: 'faq',        heading: `Frequently Asked Questions`,                      hasCTA: false, hasImage: false },
      { id: 'conclusion', heading: `Final Thoughts`,                                  hasCTA: true,  hasImage: false },
    ],
    [ARTICLE_TYPES.NEWS]: [
      { id: 'intro',      heading: null,                                              hasCTA: false, hasImage: false },
      { id: 'what',       heading: `What We Know So Far`,                             hasCTA: false, hasImage: true  },
      { id: 'release',    heading: `Release Date and Schedule`,                       hasCTA: false, hasImage: false },
      { id: 'story',      heading: `What to Expect`,                                  hasCTA: true,  hasImage: false },
      { id: 'background', heading: `About ${title}`,                                  hasCTA: false, hasImage: false },
      { id: 'faq',        heading: `Frequently Asked Questions`,                      hasCTA: false, hasImage: false },
      { id: 'conclusion', heading: `Final Thoughts`,                                  hasCTA: true,  hasImage: false },
    ],
    [ARTICLE_TYPES.EXPLAINED]: [
      { id: 'intro',      heading: null,                                              hasCTA: false, hasImage: false },
      { id: 'recap',      heading: `Quick Story Recap`,                               hasCTA: false, hasImage: true  },
      { id: 'explained',  heading: `The Ending Explained`,                            hasCTA: false, hasImage: false },
      { id: 'meaning',    heading: `What It All Means`,                               hasCTA: true,  hasImage: false },
      { id: 'theories',   heading: `Fan Theories and Hidden Details`,                 hasCTA: false, hasImage: false },
      { id: 'faq',        heading: `Frequently Asked Questions`,                      hasCTA: false, hasImage: false },
      { id: 'conclusion', heading: `Final Thoughts`,                                  hasCTA: true,  hasImage: false },
    ],
  };

  return sections[type] || sections[ARTICLE_TYPES.REVIEW];
}

// ─── FAQ BUILDER ─────────────────────────────────────────────────────────────
// Real Google-style questions people actually search

function buildFAQs(topic, type) {
  const title = topic.title;
  const score = topic.malScore ? topic.malScore.toFixed(1) : (topic.score / 10).toFixed(1);
  const eps   = topic.episodes ? `${topic.episodes} episodes` : 'an ongoing series';
  const year  = topic.year || new Date().getFullYear();

  const faqs = {
    [ARTICLE_TYPES.REVIEW]: [
      { q: `Is ${title} worth watching in ${year}?`,          hint: `Direct yes/no + 2 reasons. MAL score: ${score}/10.` },
      { q: `How many episodes does ${title} have?`,           hint: `${eps}. Mention if ongoing.` },
      { q: `Is ${title} appropriate for younger audiences?`,  hint: `Based on genres: ${topic.genres.join(', ')}.` },
      { q: `Is ${title} dubbed in English?`,                  hint: `Mention Crunchyroll/streaming availability.` },
      { q: `What genre is ${title}?`,                         hint: `Use genres: ${topic.genres.slice(0,3).join(', ')}.` },
    ],
    [ARTICLE_TYPES.TOP_LIST]: [
      { q: `What anime is most similar to ${title}?`,         hint: `Name the top 2 picks from the list.` },
      { q: `Is there a Season 2 of ${title}?`,               hint: `Status: ${topic.status}. Answer directly.` },
      { q: `Where can I watch ${title}?`,                     hint: `Crunchyroll, Netflix, streaming platforms.` },
      { q: `Why do fans love ${title} so much?`,              hint: `Based on score ${score}/10 and genres.` },
      { q: `Is ${title} finished or still airing?`,           hint: `Status: ${topic.status}.` },
    ],
    [ARTICLE_TYPES.NEWS]: [
      { q: `When does the new ${title} episode air?`,         hint: `Give specific day/time if known.` },
      { q: `Where can I watch ${title}?`,                     hint: `Crunchyroll/streaming platforms.` },
      { q: `Is ${title} on a break this week?`,               hint: `Answer based on schedule data.` },
      { q: `How many episodes will ${title} have?`,           hint: `${eps}.` },
      { q: `Will there be a Season 2 of ${title}?`,          hint: `Status: ${topic.status}.` },
    ],
    [ARTICLE_TYPES.EXPLAINED]: [
      { q: `What happens at the end of ${title}?`,            hint: `Brief spoiler-free summary first, then full.` },
      { q: `Is there a post-credits scene in ${title}?`,     hint: `Answer directly.` },
      { q: `What does the ending of ${title} mean?`,         hint: `Thematic explanation.` },
      { q: `Will ${title} have a continuation?`,              hint: `Status: ${topic.status}.` },
      { q: `Is ${title} based on a manga?`,                   hint: `Based on format: ${topic.format}.` },
    ],
  };

  return faqs[type] || faqs[ARTICLE_TYPES.REVIEW];
}

// ─── CTA BUILDER ─────────────────────────────────────────────────────────────

function buildCTAs(topic, siteUrl) {
  const title = topic.title;
  const slug  = topic.slug;

  return {
    primary: {
      text:  `Watch ${title} on AnimeReza`,
      url:   `${siteUrl}/anime/${slug}`,
      style: 'Watch Now →',
    },
    secondary: {
      text:  `Browse More Anime Like ${title}`,
      url:   `${siteUrl}/genre/${(topic.genres[0] || 'action').toLowerCase()}`,
      style: 'Explore More →',
    },
    newsletter: {
      text:  `Get Weekly Anime Picks — Free`,
      url:   `${siteUrl}/newsletter`,
      style: 'Subscribe Free →',
    },
  };
}

// ─── TITLE BUILDER ────────────────────────────────────────────────────────────

function buildTitle(topic, type, keywords) {
  const title = topic.title;
  const year  = topic.year || new Date().getFullYear();
  const score = topic.malScore ? topic.malScore.toFixed(1) : null;

  const titles = {
    [ARTICLE_TYPES.REVIEW]: [
      `Is ${title} Worth Watching? Honest Review (${year})`,
      `${title} Review: Everything You Need to Know Before Watching`,
      `${title} — Is It Really Worth the Hype? (${year} Review)`,
    ],
    [ARTICLE_TYPES.TOP_LIST]: [
      `10 Best Anime Like ${title} You Need to Watch`,
      `If You Loved ${title}, Watch These 10 Anime Next`,
      `Best Anime Similar to ${title}: Top Picks for Fans`,
    ],
    [ARTICLE_TYPES.NEWS]: [
      `${title} Episode ${topic.nextEpisode} Release Date, Time, and Where to Watch`,
      `${title} New Episode: Release Schedule and What to Expect`,
      `When Does ${title} Episode ${topic.nextEpisode} Air? Everything We Know`,
    ],
    [ARTICLE_TYPES.EXPLAINED]: [
      `${title} Ending Explained: What Really Happened and What It Means`,
      `${title} Finale Breakdown: The Ending Explained`,
      `${title}: The Ending Explained (Spoilers)`,
    ],
  };

  const options = titles[type] || titles[ARTICLE_TYPES.REVIEW];
  return options[0]; // First is most SEO-optimized
}

// ─── META DESCRIPTION BUILDER ────────────────────────────────────────────────

function buildMetaDesc(topic, type, title) {
  const animTitle = topic.title;
  const score     = topic.malScore ? topic.malScore.toFixed(1) : (topic.score / 10).toFixed(1);
  const genres    = topic.genres.slice(0, 2).join(' and ');

  const metas = {
    [ARTICLE_TYPES.REVIEW]:    `Wondering if ${animTitle} is worth watching? Our honest review covers story, animation, characters, and more. MAL score: ${score}/10.`,
    [ARTICLE_TYPES.TOP_LIST]:  `Loved ${animTitle}? Here are the 10 best anime similar to ${animTitle} that every fan needs to watch — ranked and reviewed.`,
    [ARTICLE_TYPES.NEWS]:      `${animTitle} Episode ${topic.nextEpisode} release date, air time, and streaming info. Everything you need to know.`,
    [ARTICLE_TYPES.EXPLAINED]: `${animTitle}'s ending explained in full detail — what happened, what it means, and what comes next. Full breakdown inside.`,
  };

  return (metas[type] || metas[ARTICLE_TYPES.REVIEW]).slice(0, 155);
}

// ─── MAIN PLANNER ─────────────────────────────────────────────────────────────

export function planArticles(topics, siteUrl = 'https://animereza.xyz', count = 2) {
  const plans = [];
  let lastType = null;

  const candidates = [
    ...topics.trending.slice(0, 5),
    ...topics.seasonal.slice(0, 10),
  ];

  // Deduplicate candidates by slug
  const seenSlugs = new Set();
  const unique = candidates.filter(t => {
    if (seenSlugs.has(t.slug)) return false;
    seenSlugs.add(t.slug);
    return true;
  });

  for (const topic of unique) {
    if (plans.length >= count) break;

    const type     = decideArticleType(topic, lastType);
    const keywords = buildKeywords(topic, type);
    const sections = buildSections(topic, type);
    const faqs     = buildFAQs(topic, type);
    const ctas     = buildCTAs(topic, siteUrl);
    const h1Title  = buildTitle(topic, type, keywords);
    const metaDesc = buildMetaDesc(topic, type, h1Title);

    plans.push({
      // Topic
      topic,
      type,

      // SEO
      h1Title,
      primaryKeyword:   keywords.primary,
      secondaryKeywords: keywords.secondary,
      articleSlug:      keywords.slug,
      metaDesc,
      seoTitle:         `${h1Title} | AnimeReza`,

      // Structure
      sections,
      faqs,
      ctas,

      // Writing targets
      wordCountTarget: type === ARTICLE_TYPES.TOP_LIST ? 1800 : 1400,
      ctaCount:        sections.filter(s => s.hasCTA).length,
      imageCount:      sections.filter(s => s.hasImage).length,

      // WP meta
      wpCategory: type === ARTICLE_TYPES.NEWS ? 'anime-news' :
                  type === ARTICLE_TYPES.TOP_LIST ? 'anime-lists' : 'anime-reviews',
      wpTags: [
        topic.title,
        ...topic.genres.slice(0, 3),
        topic.studio,
        String(topic.year),
        type === ARTICLE_TYPES.TOP_LIST ? 'anime recommendations' : 'anime review',
      ].filter(Boolean),

      // Scheduling
      publishIndex: plans.length, // 0 = publish now, 1+ = schedule
    });

    lastType = type;
  }

  return plans;
}
