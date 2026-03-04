#!/usr/bin/env node
/**
 * Fetches entry-level (0–2 yrs) software engineering jobs in Singapore
 * posted within the last 48 hours from:
 *
 *   1. MyCareersFuture  — free public REST API (gov.sg)
 *      https://api.mycareersfuture.gov.sg/v2/jobs
 *      No auth required. Filter: search + postingDate (server-side);
 *      experience + positionLevels enforced client-side (server-side
 *      positionLevels[] param causes 504 on their backend).
 *
 *   2. LinkedIn Jobs    — guest pagination endpoint (no auth)
 *      https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
 *      f_E=2 (Entry Level), f_TPR=r172800 (last 48 h).
 *      May be rate-limited by runner IP; failure is non-fatal.
 *
 * NOTE: Indeed's Publisher API was deprecated (~2022) and their RSS feed is
 * blocked (403). JobStreet also blocks automated access (403). Neither is
 * usable without a commercial agreement.
 *
 * Writes deduplicated results to docs/companies/README.md
 * No external dependencies — pure Node.js ESM with native fetch.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'docs/companies/README.md';

// 48 hours in ms
const POSTED_WITHIN_MS = 48 * 60 * 60 * 1000;
const CUTOFF = new Date(Date.now() - POSTED_WITHIN_MS);

// ---------------------------------------------------------------------------
// MyCareersFuture
//
// API docs: https://api.mycareersfuture.gov.sg  (no public Swagger found)
// Confirmed behaviour (March 2026):
//   - Search + postingDate params work correctly (server-side)
//   - positionLevels[] query param causes HTTP 504 on the backend — do NOT use
//   - Valid positionLevels.position strings in responses:
//       'Fresh/entry level', 'Junior Executive', 'Non-executive',
//       'Executive', 'Senior Executive', 'Professional'
//   - minimumYearsExperience is the most reliable experience filter field
//
// Strategy: fetch all SWE jobs posted in last 2 days, then apply two
// client-side guards:
//   1. minimumYearsExperience ≤ 2 (or null = fresh grad role)
//   2. If no experience field, exclude jobs where ALL position levels are
//      clearly senior ('Senior Executive', 'Professional')
// ---------------------------------------------------------------------------
const MCF_SENIOR_ONLY = new Set(['Senior Executive', 'Professional']);

async function fetchMyCareersFuture() {
  const results = [];
  let page = 0;
  const limit = 100;
  const MAX_EXPERIENCE = 2;

  while (true) {
    const url = new URL('https://api.mycareersfuture.gov.sg/v2/jobs');
    url.searchParams.set('search', 'software engineer');
    url.searchParams.set('postingDate', '2'); // last 2 days
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('page', String(page));

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; project-bot/1.0)',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MyCareersFuture API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const jobs = data?.results ?? [];

    for (const job of jobs) {
      const minExp = job.minimumYearsExperience;
      const hasExpData = minExp !== null && minExp !== undefined;

      // Guard 1: exclude roles requiring > 2 years experience
      if (hasExpData && minExp > MAX_EXPERIENCE) continue;

      // Guard 2: if no experience data, exclude roles tagged only as senior-level
      if (!hasExpData) {
        const levels = (job.positionLevels ?? []).map((pl) => pl.position);
        if (levels.length > 0 && levels.every((lv) => MCF_SENIOR_ONLY.has(lv))) continue;
      }

      const posted = new Date(job.metadata?.createdAt ?? job.postedDate ?? 0);
      if (posted < CUTOFF) continue;

      results.push({
        title: job.title ?? 'Software Engineer',
        company: job.postedCompany?.name ?? job.company?.name ?? 'Unknown',
        source: 'MyCareersFuture',
        postedAt: posted,
        url: `https://www.mycareersfuture.gov.sg/job/${job.uuid}`,
      });
    }

    if (jobs.length < limit) break;
    page += 1;
  }

  return results;
}

// ---------------------------------------------------------------------------
// LinkedIn Jobs – guest pagination endpoint
// ---------------------------------------------------------------------------
async function fetchLinkedIn() {
  const results = [];

  // f_E=2 = Entry Level; f_TPR=r172800 = posted in last 48h (172800 seconds)
  const url =
    'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search' +
    '?keywords=software+engineer&location=Singapore&f_E=2&f_TPR=r172800&start=0';

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`LinkedIn guest API error ${res.status}`);
  }

  const html = await res.text();

  // Parse job cards from the HTML response
  const cardRegex = /<li>([\s\S]*?)<\/li>/g;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const card = match[1];

    // Skip if no job title present
    if (!card.includes('base-search-card__title') && !card.includes('job-search-card__title')) continue;

    const title = extractHtmlText(card, ['base-search-card__title', 'job-search-card__title']);
    const company = extractHtmlText(card, ['base-search-card__subtitle', 'job-search-card__company-name']);
    const linkMatch = card.match(/href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"?]+)/);
    const searchQuery = encodeURIComponent([title, company].filter(Boolean).join(' ').trim());
    const fallbackLink = `https://www.linkedin.com/jobs/search/?keywords=${searchQuery}&location=Singapore`;
    const link = linkMatch ? linkMatch[1] : fallbackLink;

    // LinkedIn does not always include a parseable posted time in guest API HTML; use now as approximation
    const timeMatch = card.match(/datetime="([^"]+)"/);
    const postedAt = timeMatch ? new Date(timeMatch[1]) : new Date();

    if (!title) continue;

    results.push({
      title: decodeHtmlEntities(title.trim()),
      company: decodeHtmlEntities((company || 'Unknown').trim()),
      source: 'LinkedIn',
      postedAt,
      url: link,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Utility: HTML helpers
// ---------------------------------------------------------------------------
function extractHtmlText(html, classNames) {
  for (const cls of classNames) {
    const re = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<\\/`, 'i');
    const m = html.match(re);
    if (m) {
      return m[1].replace(/<[^>]+>/g, '').trim();
    }
  }
  return '';
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .trim();
}

// ---------------------------------------------------------------------------
// Deduplication: normalise "title + company" as key
// ---------------------------------------------------------------------------
function normaliseKey(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deduplicateJobs(jobs) {
  const seen = new Map();
  for (const job of jobs) {
    const key = `${normaliseKey(job.title)}|${normaliseKey(job.company)}`;
    if (!seen.has(key)) {
      seen.set(key, job);
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------
function formatDate(date) {
  if (!date || isNaN(date.getTime())) return 'N/A';
  return date.toISOString().slice(0, 10);
}

function formatMarkdown(jobs, counts) {
  const now = new Date().toISOString();
  const total = jobs.length;

  const rows = jobs
    .sort((a, b) => b.postedAt - a.postedAt)
    .map((j) => {
      const title = j.title.replace(/\|/g, '-');
      const company = j.company.replace(/\|/g, '-');
      return `| ${title} | ${company} | ${j.source} | ${formatDate(j.postedAt)} | [Apply](${j.url}) |`;
    })
    .join('\n');

  const sourceSummary = Object.entries(counts)
    .map(([src, n]) => `${src}: ${n}`)
    .join(' | ');

  return `# Singapore Entry-Level Software Engineering Jobs

> Entry-level / 0–2 years experience &nbsp;•&nbsp; Singapore &nbsp;•&nbsp; Posted within the last 48 hours
>
> *Last updated: ${now}*

**Total listings: ${total}** *(${sourceSummary})*

| Job Title | Company | Source | Posted | Apply |
|-----------|---------|--------|--------|-------|
${rows || '| — | — | — | — | — |'}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Fetching jobs… (cutoff: ${CUTOFF.toISOString()})`);

  const [mcfResult, linkedInResult] = await Promise.allSettled([
    fetchMyCareersFuture(),
    fetchLinkedIn(),
  ]);

  const counts = {};
  const allJobs = [];

  for (const [name, result] of [
    ['MyCareersFuture', mcfResult],
    ['LinkedIn', linkedInResult],
  ]) {
    if (result.status === 'fulfilled') {
      console.log(`  ${name}: fetched ${result.value.length} jobs`);
      counts[name] = result.value.length;
      allJobs.push(...result.value);
    } else {
      console.warn(`  ${name}: FAILED — ${result.reason?.message ?? result.reason}`);
      counts[name] = 0;
    }
  }

  if (allJobs.length === 0) {
    console.error('All sources failed or returned zero jobs. Aborting write.');
    process.exit(1);
  }

  const deduped = deduplicateJobs(allJobs);
  console.log(`  After dedup: ${deduped.length} unique listings`);

  const markdown = formatMarkdown(deduped, counts);

  // Ensure output directory exists
  const outDir = dirname(OUTPUT_PATH);
  await mkdir(outDir, { recursive: true });

  // Only write if content changed
  let current = '';
  try {
    current = await readFile(OUTPUT_PATH, 'utf8');
  } catch {
    // File doesn't exist yet — that's fine
  }

  if (current === markdown) {
    console.log('No changes — skipping write.');
  } else {
    await writeFile(OUTPUT_PATH, markdown, 'utf8');
    console.log(`Written → ${OUTPUT_PATH}`);
  }

  console.log(
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      total: deduped.length,
      sources: counts,
      output: OUTPUT_PATH,
    })
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
