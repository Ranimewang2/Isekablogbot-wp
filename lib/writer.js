// lib/writer.js
// Two-pass anime article writer using OpenRouter
// Pass 1: outline — Pass 2: full article
// Cleaned model list — no Nvidia/garbage models
// Validates output: structure, CTA, FAQ, word count, no prompt leakage

// ─── MODELS ───────────────────────────────────────────────────────────────────
// Ordered by quality. Writer tries each until one succeeds.
// Nvidia nemotron removed — leaks prompts into output.

const MODELS = [
  'google/gemma-2-9b-it:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
  'qwen/qwen-2-7b-instruct:free',
  'microsoft/phi-3-mini-128k-instruct:free',
];

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ─── OPENROUTER CALL ──────────────────────────────────────────────────────────

async function callOpenRouter(apiKey, model, messages, maxTokens = 2000) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${apiKey}`,
      'Content-Type':   'application/json',
      'HTTP-Referer':   'https://animereza.xyz',
      'X-Title':        'AnimeReza Blog Bot',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens:  maxTokens,
      temperature: 0.75,
      top_p:       0.9,
    }),
    signal: AbortSignal.timeout(45000),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Non-JSON response: ' + text.slice(0, 100)); }

  if (data.error) throw new Error(`API error: ${JSON.stringify(data.error)}`);

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty content in response: ' + JSON.stringify(data).slice(0, 200));

  return content;
}

async function callWithFallback(apiKey, messages, maxTokens = 2000) {
  const errs = [];
  for (const model of MODELS) {
    try {
      console.log(`[Writer] Trying: ${model}`);
      const result = await callOpenRouter(apiKey, model, messages, maxTokens);
      console.log(`[Writer] Success: ${model}`);
      return { result, model };
    } catch (e) {
      console.warn(`[Writer] ${model} failed: ${e.message.slice(0, 150)}`);
      errs.push(`${model}: ${e.message.slice(0, 100)}`);
    }
  }
  throw new Error('[Writer] All models failed:\n' + errs.join('\n'));
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior anime blog writer for AnimeReza, writing in the style of CBR and ScreenRant.

WRITING RULES — follow every rule strictly:
1. Output ONLY valid HTML. No markdown. No backticks. No preamble. No meta-commentary. Start directly with the first HTML tag.
2. Never include any instructions, prompts, or meta text in your output — only article content.
3. Write in a confident, engaging, direct tone — like a knowledgeable anime fan writing for other fans.
4. Every paragraph is maximum 3 sentences. Short paragraphs. Mobile-first.
5. Use <strong> for emphasis on key points — not random bolding.
6. Use <em> for anime titles when mentioned inline.
7. Use <blockquote> for impactful statements or notable quotes about the anime.
8. Use <ul> and <li> for lists inside TOP_LIST entries.
9. Never start two consecutive sentences with the same word.
10. Never use filler phrases: "In conclusion", "It goes without saying", "As an AI", "Certainly", "Absolutely".
11. Primary keyword appears in: first 100 words, one H2, and conclusion. Max 1.5% density.
12. Every H2 section is minimum 120 words.
13. Write as if the reader is deciding right now whether to watch this anime.`;

// ─── PASS 1: OUTLINE ──────────────────────────────────────────────────────────

function buildOutlinePrompt(plan) {
  const { topic, type, h1Title, primaryKeyword, sections, faqs, wordCountTarget } = plan;

  return `Create a detailed article OUTLINE for this anime blog post.

ARTICLE DETAILS:
- Title: ${h1Title}
- Type: ${type}
- Anime: ${topic.title} (${topic.year})
- Studio: ${topic.studio}
- Genres: ${topic.genres.join(', ')}
- MAL Score: ${topic.malScore || (topic.score / 10).toFixed(1)}/10
- Status: ${topic.status}
- Episodes: ${topic.episodes || 'Ongoing'}
- Description: ${topic.description}
- Primary Keyword: "${primaryKeyword}"
- Target Word Count: ${wordCountTarget}

SECTIONS TO OUTLINE:
${sections.map((s, i) => `${i + 1}. ${s.heading || 'Introduction'}${s.hasCTA ? ' [CTA HERE]' : ''}${s.hasImage ? ' [IMAGE HERE]' : ''}`).join('\n')}

FAQ QUESTIONS TO ANSWER:
${faqs.map((f, i) => `${i + 1}. ${f.q} (hint: ${f.hint})`).join('\n')}

OUTPUT FORMAT — respond with JSON only, no backticks:
{
  "intro_angle": "the specific hook/angle for the introduction",
  "section_bullets": { "section_id": ["bullet point 1", "bullet point 2", "bullet point 3"] },
  "faq_answers": { "0": "answer to FAQ 0", "1": "answer to FAQ 1" },
  "key_arguments": ["main argument 1", "main argument 2", "main argument 3"],
  "verdict": "the final verdict/conclusion sentence"
}`;
}

async function generateOutline(apiKey, plan) {
  const messages = [
    { role: 'system', content: 'You are an anime blog outline writer. Output only valid JSON. No backticks, no markdown, no extra text.' },
    { role: 'user',   content: buildOutlinePrompt(plan) },
  ];

  const { result, model } = await callWithFallback(apiKey, messages, 1200);

  try {
    const clean = result.replace(/```json|```/g, '').trim();
    return { outline: JSON.parse(clean), model };
  } catch {
    // If JSON parse fails, return a basic outline and continue
    console.warn('[Writer] Outline JSON parse failed, using basic outline');
    return {
      outline: {
        intro_angle: `A deep dive into ${plan.topic.title}`,
        section_bullets: {},
        faq_answers: {},
        key_arguments: [plan.topic.description?.slice(0, 100) || ''],
        verdict: `${plan.topic.title} is a must-watch for anime fans.`,
      },
      model,
    };
  }
}

// ─── PASS 2: FULL ARTICLE ─────────────────────────────────────────────────────

function buildArticlePrompt(plan, outline, imageSet) {
  const { topic, type, h1Title, primaryKeyword, secondaryKeywords, sections, faqs, ctas, wordCountTarget } = plan;

  const featuredImageHTML = imageSet?.featured
    ? `<!-- FEATURED_IMAGE: ${imageSet.featured.url} | ALT: ${imageSet.featured.alt} -->`
    : '';

  // Map in-article images to section positions
  const sectionImages = {};
  let imgIndex = 0;
  for (const section of sections) {
    if (section.hasImage && imageSet?.inArticle?.[imgIndex]) {
      sectionImages[section.id] = imageSet.inArticle[imgIndex];
      imgIndex++;
    }
  }

  const ctaHTML = (cta) =>
    `<div class="ar-cta-box">
  <p>${cta.text}</p>
  <a href="${cta.url}" class="ar-cta-button" target="_blank" rel="noopener">${cta.style}</a>
</div>`;

  const faqSchema = faqs.map((f, i) =>
    `<div class="ar-faq-item">
  <h3>${f.q}</h3>
  <p>${outline.faq_answers?.[String(i)] || f.hint}</p>
</div>`).join('\n');

  return `Write a complete, publish-ready anime blog article in HTML.

ARTICLE INFO:
- H1 Title: ${h1Title}
- Type: ${type}
- Anime: ${topic.title} | Studio: ${topic.studio} | Year: ${topic.year}
- Genres: ${topic.genres.join(', ')} | Score: ${topic.malScore || (topic.score / 10).toFixed(1)}/10
- Episodes: ${topic.episodes || 'Ongoing'} | Status: ${topic.status}
- Description: ${topic.description}
- Primary Keyword: "${primaryKeyword}" (use in intro, one H2, conclusion)
- Secondary Keywords: ${secondaryKeywords.join(', ')} (use naturally)
- Target: ${wordCountTarget} words minimum
- Site CTA URL: ${ctas.primary.url}

OUTLINE TO FOLLOW:
- Intro angle: ${outline.intro_angle}
- Key arguments: ${outline.key_arguments?.join(' | ')}
- Verdict: ${outline.verdict}

SECTIONS — write each one in order:
${sections.map((s, i) => {
  const img = sectionImages[s.id];
  const imgInstruction = img
    ? `\n  [INSERT IMAGE: <figure class="ar-article-image"><img src="${img.url}" alt="${img.alt}" loading="lazy" decoding="async" /></figure>]`
    : '';
  const ctaInstruction = s.hasCTA
    ? `\n  [INSERT CTA: ${ctaHTML(s.id === 'verdict' ? ctas.primary : ctas.secondary)}]`
    : '';
  return `${i + 1}. ${s.heading || 'Introduction (no H2 tag)'}${imgInstruction}${ctaInstruction}`;
}).join('\n')}

FAQ SECTION — use exactly this HTML:
${faqSchema}

FORMATTING RULES:
- Start with: <h1>${h1Title}</h1>
- Use <h2> for all section headings
- Use <h3> only inside FAQ
- Wrap every paragraph in <p> tags
- Use <strong> for key points (2-3 per section max)
- Use <em> for anime titles mentioned inline
- Use <blockquote> once per article for an impactful statement
- Use <ul><li> for any lists
- Every section minimum 120 words
- Output ONLY HTML — no markdown, no backticks, no comments outside image/CTA placeholders

${featuredImageHTML}

BEGIN ARTICLE HTML NOW:`;
}

// ─── VALIDATOR ────────────────────────────────────────────────────────────────

function validateArticle(html, plan) {
  const errors   = [];
  const warnings = [];

  if (!html || html.length < 2000) {
    errors.push('Article too short (under 2000 chars)');
  }

  // Check for prompt leakage
  const leakPhrases = [
    'as an ai', 'i cannot', 'certainly!', 'absolutely!',
    'sure!', 'of course!', 'insert image', 'insert cta',
    'html now:', 'begin article', '```', 'outline to follow',
    'article info:', 'sections —',
  ];
  for (const phrase of leakPhrases) {
    if (html.toLowerCase().includes(phrase)) {
      errors.push(`Prompt leakage detected: "${phrase}"`);
    }
  }

  // Check structure
  if (!html.includes('<h1>') && !html.includes('<H1>')) {
    errors.push('Missing H1 tag');
  }
  if (!html.includes('<h2>')) {
    errors.push('Missing H2 tags');
  }
  if (!html.includes('ar-cta')) {
    warnings.push('No CTA blocks found');
  }
  if (!html.includes('ar-faq')) {
    warnings.push('No FAQ section found');
  }

  // Check primary keyword presence
  const keyword = plan.primaryKeyword.toLowerCase();
  if (!html.toLowerCase().includes(keyword.split(' ')[0])) {
    warnings.push(`Primary keyword "${plan.primaryKeyword}" not found`);
  }

  // Estimate word count
  const wordCount = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  if (wordCount < plan.wordCountTarget * 0.7) {
    warnings.push(`Word count low: ~${wordCount} words (target: ${plan.wordCountTarget})`);
  }

  return {
    valid:    errors.length === 0,
    errors,
    warnings,
    wordCount,
  };
}

// ─── CLEANER ─────────────────────────────────────────────────────────────────

function cleanArticle(html) {
  return html
    // Remove markdown artifacts
    .replace(/```html?|```/g, '')
    // Remove any lines that look like instructions
    .replace(/^(BEGIN|OUTPUT|NOTE|RULE|ARTICLE INFO|SECTIONS).*$/gim, '')
    // Fix double blank lines
    .replace(/\n{3,}/g, '\n\n')
    // Ensure proper spacing around block elements
    .replace(/(<\/h[1-6]>)(<p>)/g, '$1\n$2')
    .trim();
}

// ─── MAIN WRITER ─────────────────────────────────────────────────────────────

export async function writeArticle(apiKey, plan, imageSet) {
  console.log(`[Writer] Writing article: "${plan.h1Title}"`);

  const startTime = Date.now();

  // Pass 1 — Outline
  console.log('[Writer] Pass 1: generating outline...');
  const { outline, model: outlineModel } = await generateOutline(apiKey, plan);

  // Pass 2 — Full Article
  console.log('[Writer] Pass 2: writing full article...');
  const articleMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: buildArticlePrompt(plan, outline, imageSet) },
  ];

  const { result: rawHtml, model: articleModel } = await callWithFallback(
    apiKey, articleMessages, 2500
  );

  const cleaned = cleanArticle(rawHtml);

  // Validate
  const validation = validateArticle(cleaned, plan);
  console.log(`[Writer] Validation: ${validation.valid ? '✓ PASS' : '✗ FAIL'} | ${validation.wordCount} words`);
  if (validation.errors.length)   console.error('[Writer] Errors:', validation.errors);
  if (validation.warnings.length) console.warn('[Writer] Warnings:', validation.warnings);

  // If hard errors and we have retries left — could retry here
  // For now: return result with validation info for logging

  const duration = Date.now() - startTime;
  console.log(`[Writer] Done in ${duration}ms | Models: outline=${outlineModel}, article=${articleModel}`);

  return {
    html:        cleaned,
    outline,
    validation,
    modelsUsed:  { outline: outlineModel, article: articleModel },
    duration,
    wordCount:   validation.wordCount,
  };
}
