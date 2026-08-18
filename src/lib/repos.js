const API = 'https://api.github.com';
const SLASHED = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const OWNER_IN_URL = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)/i;

/** First path segments on github.com that are features, not accounts. */
const NOT_OWNERS = new Set([
  'about', 'account', 'apps', 'codespaces', 'collections', 'contact', 'copilot', 'dashboard',
  'discussions', 'enterprise', 'events', 'explore', 'features', 'issues', 'login', 'logout',
  'marketplace', 'new', 'notifications', 'organizations', 'orgs', 'pricing', 'pulls', 'search',
  'security', 'sessions', 'settings', 'sponsors', 'stars', 'topics', 'trending', 'watching',
]);

function shape(repo, owned) {
  return {
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description ?? '',
    private: Boolean(repo.private),
    archived: Boolean(repo.archived),
    owned,
  };
}

async function get(path, token) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { ok: response.ok, status: response.status, body: response.ok ? await response.json() : null };
}

async function search(term, token, limit, owned = false) {
  const found = await get(`/search/repositories?q=${encodeURIComponent(term)}&per_page=${limit}`, token);
  if (found.ok) return (found.body.items ?? []).map((repo) => shape(repo, owned));
  if (found.status === 403 || found.status === 429) {
    throw new Error(
      token
        ? 'GitHub rate-limited the search. Try again shortly.'
        : 'GitHub rate-limited the search. Connecting a token raises the limit.',
    );
  }
  throw new Error(`GitHub returned ${found.status} for the search.`);
}

/**
 * Accounts worth favouring, read straight off the saved links: anything linked at
 * github.com/<owner> or github.com/<owner>/<repo>. Links kept in the menu are a good signal
 * of whose repositories matter, and the order is the order they were put in.
 */
export function ownersFromLinks(links) {
  const owners = [];
  for (const link of links ?? []) {
    const match = OWNER_IN_URL.exec(link?.url ?? '');
    if (!match) continue;
    const owner = match[1];
    if (NOT_OWNERS.has(owner.toLowerCase())) continue;
    if (!owners.some((seen) => seen.toLowerCase() === owner.toLowerCase())) owners.push(owner);
  }
  return owners.slice(0, 5);
}

/**
 * Every repository the token can see, private ones included. Kept locally so that the repos you
 * actually work in match instantly and without a request — GitHub's search cannot be relied on to
 * surface private repositories, and asking it on every keystroke is a poor trade when the list of
 * repositories you care about changes a few times a month.
 */
export async function listAccessibleRepos(token, pages = 6, perPage = 100) {
  const all = [];
  for (let page = 1; page <= pages; page += 1) {
    const query = `per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`;
    const result = await get(`/user/repos?${query}`, token);
    if (!result.ok) {
      if (page === 1) {
        if (result.status === 401) throw new Error('GitHub rejected the token.');
        if (result.status === 403) throw new Error('The token is not allowed to list repositories.');
        throw new Error(`GitHub returned ${result.status} listing repositories.`);
      }
      break;
    }
    const batch = Array.isArray(result.body) ? result.body : [];
    all.push(...batch.map((repo) => shape(repo, true)));
    if (batch.length < perPage) break;
  }
  return all;
}

/** Exact name, then prefix, then substring; shorter names win ties. */
export function matchIndex(index, query, limit = 5) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (needle.length < 2) return [];

  const ranked = [];
  for (const repo of index ?? []) {
    const full = repo.fullName.toLowerCase();
    const name = full.slice(full.indexOf('/') + 1);
    let rank = -1;
    if (full === needle) rank = 0;
    else if (name === needle) rank = 1;
    else if (name.startsWith(needle)) rank = 2;
    else if (full.startsWith(needle)) rank = 3;
    else if (name.includes(needle)) rank = 4;
    else if (full.includes(needle)) rank = 5;
    if (rank >= 0) ranked.push([rank, repo]);
  }

  ranked.sort((a, b) => a[0] - b[0] || a[1].fullName.length - b[1].fullName.length);
  return ranked.slice(0, limit).map(([, repo]) => repo);
}

function merge(groups, limit) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const repo of group) {
      const key = repo.fullName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(repo);
    }
  }
  return merged.slice(0, limit);
}

/**
 * `owner/repo` is looked up directly, so the canonical casing comes back — typing
 * leantime/leantime lands on Leantime/leantime. A bare term runs two searches at once: one
 * restricted to the favoured owners, one across GitHub, with the restricted hits kept first.
 * Searching "economics" while itk-dev is in the links should not bury itk-dev/economics under
 * every other project of that name.
 */
export async function findRepos(query, token, owners = [], limit = 5) {
  const trimmed = String(query ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\/+$/, '');
  if (trimmed.length < 2) return [];

  const favoured = (name) => owners.some((owner) => owner.toLowerCase() === name.toLowerCase());

  if (SLASHED.test(trimmed)) {
    const [owner, name] = trimmed.split('/');
    const direct = await get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token);
    if (direct.ok) return [shape(direct.body, favoured(owner))];
    return search(name, token, limit);
  }

  const scope = owners.map((owner) => `user:${owner}`).join(' ');
  const [scoped, general] = await Promise.allSettled([
    scope ? search(`${trimmed} in:name ${scope}`, token, 3, true) : Promise.resolve([]),
    search(trimmed, token, limit),
  ]);

  if (scoped.status === 'rejected' && general.status === 'rejected') throw general.reason;

  return merge(
    [scoped.status === 'fulfilled' ? scoped.value : [], general.status === 'fulfilled' ? general.value : []],
    limit,
  );
}
