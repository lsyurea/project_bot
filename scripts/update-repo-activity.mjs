#!/usr/bin/env node

const GITHUB_TOKEN = process.env.GH_ACTIVITY_TOKEN || process.env.GITHUB_TOKEN;
const GITHUB_USER = process.env.GITHUB_USER;
const DAYS_ACTIVE = Number(process.env.ACTIVE_DAYS ?? 90);
const README_PATH = process.env.README_PATH ?? 'README.md';
const START_MARKER = '<!-- REPO_ACTIVITY:START -->';
const END_MARKER = '<!-- REPO_ACTIVITY:END -->';

if (!GITHUB_TOKEN) {
  console.error('Missing GitHub token. Set GH_ACTIVITY_TOKEN (preferred) or GITHUB_TOKEN.');
  process.exit(1);
}

if (!GITHUB_USER) {
  console.error('Missing GITHUB_USER. Set it to your GitHub username.');
  process.exit(1);
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
};

async function fetchRepos() {
  const repos = [];
  let page = 1;

  while (true) {
    const url = new URL('https://api.github.com/user/repos');
    url.searchParams.set('visibility', 'all');
    url.searchParams.set('affiliation', 'owner');
    url.searchParams.set('sort', 'pushed');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${text}`);
    }

    const pageData = await res.json();
    if (!Array.isArray(pageData) || pageData.length === 0) {
      break;
    }

    repos.push(...pageData);
    page += 1;
  }

  return repos;
}

function buildActivitySection({ activeRepos, inactiveRepos, total, cutoffDate }) {
  const generatedAt = new Date().toISOString();

  const activeLines = activeRepos.length
    ? activeRepos.map(
        (repo) => `- ${repo.private ? '🔒' : '🌐'} [${repo.full_name}](${repo.html_url}) — last push: ${repo.pushed_at ? repo.pushed_at.slice(0, 10) : 'n/a'}`,
      )
    : ['- None'];

  const inactiveLines = inactiveRepos.length
    ? inactiveRepos.map(
        (repo) => `- ${repo.private ? '🔒' : '🌐'} [${repo.full_name}](${repo.html_url}) — last push: ${repo.pushed_at ? repo.pushed_at.slice(0, 10) : 'n/a'}`,
      )
    : ['- None'];

  return [
    START_MARKER,
    `Generated: ${generatedAt}`,
    '',
    `Active window: last ${DAYS_ACTIVE} days (cutoff: ${cutoffDate.toISOString().slice(0, 10)})`,
    `Total repositories analyzed: ${total}`,
    `Active: ${activeRepos.length}`,
    `Inactive: ${inactiveRepos.length}`,
    '',
    '### Active Repositories',
    ...activeLines,
    '',
    '### Inactive Repositories',
    ...inactiveLines,
    END_MARKER,
  ].join('\n');
}

async function main() {
  const fs = await import('node:fs/promises');

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - DAYS_ACTIVE * 24 * 60 * 60 * 1000);

  const repos = await fetchRepos();

  const ownedByUser = repos.filter((repo) => repo.owner?.login?.toLowerCase() === GITHUB_USER.toLowerCase());
  const filtered = ownedByUser.filter((repo) => !repo.archived && !repo.disabled);

  const activeRepos = [];
  const inactiveRepos = [];

  for (const repo of filtered) {
    const pushedAt = repo.pushed_at ? new Date(repo.pushed_at) : null;
    if (pushedAt && pushedAt >= cutoffDate) {
      activeRepos.push(repo);
    } else {
      inactiveRepos.push(repo);
    }
  }

  activeRepos.sort((a, b) => (a.pushed_at < b.pushed_at ? 1 : -1));
  inactiveRepos.sort((a, b) => {
    const aDate = a.pushed_at ?? '';
    const bDate = b.pushed_at ?? '';
    return aDate < bDate ? 1 : -1;
  });

  const readme = await fs.readFile(README_PATH, 'utf8');
  const start = readme.indexOf(START_MARKER);
  const end = readme.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find markers in ${README_PATH}. Expected ${START_MARKER} ... ${END_MARKER}`);
  }

  const section = buildActivitySection({
    activeRepos,
    inactiveRepos,
    total: filtered.length,
    cutoffDate,
  });

  const updated = `${readme.slice(0, start)}${section}${readme.slice(end + END_MARKER.length)}`;

  if (updated !== readme) {
    await fs.writeFile(README_PATH, updated, 'utf8');
    console.log(`Updated ${README_PATH}`);
  } else {
    console.log(`${README_PATH} is already up to date`);
  }

  console.log(
    JSON.stringify(
      {
        total: filtered.length,
        active: activeRepos.length,
        inactive: inactiveRepos.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
