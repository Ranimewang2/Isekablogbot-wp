# AnimeReza WP Bot 🎌

Automated anime WordPress blog writer. CBR/ScreenRant-quality articles, SEO-first, trending-first. Fully free stack.

## Stack
- **Vercel** — bot API endpoints (free)
- **Supabase** — database + settings storage (free)
- **WordPress** — on InfinityFree hosting
- **InfinityFree cPanel** — 3× daily cron jobs
- **OpenRouter** — AI writing (free models)

## Setup Guide

### 1. Supabase
1. Create project at [supabase.com](https://supabase.com)
2. Go to Settings → API → copy **Project URL** and **anon public key**
3. In Supabase SQL editor, run these creates manually:
```sql
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS published_log (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT, wp_post_id INTEGER, wp_url TEXT, post_type TEXT, published_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS article_queue (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT, post_type TEXT, topic_data JSONB, article_html TEXT, wp_meta JSONB, status TEXT DEFAULT 'ready', scheduled_for TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), published_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS bot_runs (id SERIAL PRIMARY KEY, ran_at TIMESTAMPTZ DEFAULT NOW(), trigger TEXT DEFAULT 'cron', articles_generated INTEGER DEFAULT 0, articles_published INTEGER DEFAULT 0, topics_used JSONB, models_used JSONB, duration_ms INTEGER, error TEXT, success BOOLEAN DEFAULT TRUE);
```

### 2. Deploy to Vercel
```bash
npm install -g vercel
vercel login
vercel
```
When prompted, add these **two** environment variables:
- `SUPABASE_URL` → your Supabase project URL
- `SUPABASE_ANON_KEY` → your Supabase anon key

That's it. All other credentials go in the dashboard.

### 3. WordPress Setup
1. Install WordPress on InfinityFree
2. Install **RankMath SEO** plugin
3. Go to **Users → your profile → Application Passwords**
4. Generate a new app password — copy it

### 4. Dashboard Setup
1. Visit your Vercel deployment URL (e.g. `https://your-bot.vercel.app`)
2. Go to **Settings** tab
3. Fill in:
   - WP Site URL: `https://isekaiblogging.gt.tc`
   - WP Username: your WP admin username
   - WP App Password: the password you generated
   - OpenRouter API Key: same key from your blogger bot
   - Main Site URL: `https://animereza.xyz` (for CTAs)
4. Click **Test Connection** to verify WP works
5. Click **Save All Settings**

### 5. InfinityFree Cron Jobs
In InfinityFree cPanel → Cron Jobs, add 3 jobs:
```
Command: curl -s https://YOUR-BOT.vercel.app/api/generate > /dev/null 2>&1
Schedule 1: 0 7 * * *   (7 AM)
Schedule 2: 0 13 * * *  (1 PM)
Schedule 3: 0 19 * * *  (7 PM)
```
The cron command is shown pre-filled in the Settings tab of your dashboard.

### 6. Test Run
Click **Generate Now** in the dashboard. Watch the live log. First run should generate 2 articles — one publishes immediately, one schedules +4 hours.

## Workflow (7 Steps)
1. **Trend** — Google Trends Daily RSS + ANN RSS → anime keyword filtering
2. **Fetch** — AniList GraphQL + Jikan REST → topic pool, trend matching, scoring
3. **Plan** — Article type decision, keyword research, section structure, FAQ generation
4. **Images** — AniList CDN + Jikan promo + Safebooru character art + Waifu.im
5. **Write** — Two-pass OpenRouter writer (outline → full article)
6. **Validate** — Structure check, prompt leakage detection, word count verification
7. **Publish** — WP REST API, image upload, RankMath meta, scheduling

## OpenRouter Models (cleaned)
- `google/gemma-3-27b-it:free` (primary)
- `google/gemma-2-27b-it:free`
- `meta-llama/llama-3.3-70b-instruct:free`
- `mistralai/mistral-7b-instruct:free`

Nvidia nemotron models removed — they leak prompts into output.

## Image Sources
| Source | Used For | API Key |
|--------|----------|---------|
| AniList CDN | Featured image | None |
| Jikan /pictures | In-article promo shots | None |
| Safebooru | Character art (REVIEW posts) | None |
| Waifu.im | Illustration fills (TOP_LIST) | None |

## Article Types
- **REVIEW** — "Is X worth watching?" — targets informational searches
- **TOP_LIST** — "Best anime like X" — targets recommendation searches  
- **NEWS** — "X episode release date" — targets breaking searches
- **EXPLAINED** — "X ending explained" — targets breakdown searches
