const API = 'https://api.github.com';
const SLASHED = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * A repository as the search and the local index hold it — an entry of the index is one of these.
 * `owned` is whether it came from your own tokens or a favoured owner rather than all of GitHub.
 * @typedef {{ fullName: string, url: string, description: string, private: boolean, archived: boolean, owned: boolean }} Repo
 */

/**
 * How many repositories a search lists. It is the page each search asks for, not a count of
 * requests: a bare word is two searches whatever the number, an owner/repository one lookup, and
 * the index none — so ten costs GitHub nothing more than five did. The menu's slots match it.
 */
export const REPO_LIMIT = 10;
const OWNER_IN_URL = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)/i;

/** First path segments on github.com that are features, not accounts. */
export const NOT_OWNERS = new Set([
  'about', 'account', 'apps', 'codespaces', 'collections', 'contact', 'copilot', 'dashboard',
  'discussions', 'enterprise', 'events', 'explore', 'features', 'issues', 'login', 'logout',
  'marketplace', 'new', 'notifications', 'organizations', 'orgs', 'pricing', 'pulls', 'search',
  'security', 'sessions', 'settings', 'sponsors', 'stars', 'topics', 'trending', 'watching',
]);

/**
 * @param {any} repo
 * @param {boolean} owned
 * @returns {Repo}
 */
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

/**
 * @param {string} path
 * @param {string | null | undefined} token
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
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

/**
 * @param {string} term
 * @param {string | null | undefined} token
 * @param {number} limit
 * @param {boolean} [owned]
 * @returns {Promise<Repo[]>}
 */
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
 * What was typed, as a search reads it: trimmed, with a pasted github.com address and any trailing
 * slash taken off, so a URL and an owner/name ask the same thing.
 * @param {unknown} query
 * @returns {string}
 */
export function cleanQuery(query) {
  return String(query ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\/+$/, '');
}

/**
 * The owner a search names: the first half of `owner/name`, or the account a pasted github.com
 * address points into. A bare word names nobody, and neither does a feature page of GitHub's own.
 * @param {unknown} query
 * @returns {string | null}
 */
export function queryOwner(query) {
  const trimmed = cleanQuery(query);
  const owner = SLASHED.test(trimmed) ? trimmed.slice(0, trimmed.indexOf('/')) : OWNER_IN_URL.exec(String(query ?? '').trim())?.[1];
  return owner && !NOT_OWNERS.has(owner.toLowerCase()) ? owner : null;
}

/**
 * Whether a saved token can see an owner's private repositories, as far as gitchop knows. A classic
 * token reaches everything the account does. A sign-in reaches the accounts the app is installed on.
 * A fine-grained token reaches the one owner its private repositories said, or, until a listing has
 * said, the owner it was made for.
 * @param {{ kind?: string | null, owners?: string[] | null, target?: string | null, installations?: { owner: string }[] | null }} entry
 * @param {string} owner
 * @returns {boolean}
 */
export function reaches(entry, owner) {
  const wanted = String(owner ?? '').toLowerCase();
  if (!wanted) return false;
  if (entry?.kind === 'classic') return true;
  /** @type {(name: string | null | undefined) => boolean} */
  const same = (name) => String(name ?? '').toLowerCase() === wanted;
  if (entry?.kind === 'app') return (entry.installations ?? []).some((install) => same(install.owner));
  if (Array.isArray(entry?.owners) && entry.owners.length > 0) return entry.owners.some(same);
  return same(entry?.target);
}

/** Narrowest first: what the app reaches, then a token made for one owner, then the account-wide one. */
const REACH_ORDER = { app: 0, 'fine-grained': 1, unknown: 1, classic: 2 };

/**
 * The tokens to try for one owner, best first. Those that reach it come first, narrowest first, so
 * a classic token's budget is not spent on what a sign-in or a fine-grained token covers; the rest
 * follow in the order they were saved, since a public repository answers to any of them.
 * @template {{ kind?: string | null, owners?: string[] | null, target?: string | null, installations?: { owner: string }[] | null }} T
 * @param {T[]} tokens
 * @param {string | null | undefined} owner
 * @returns {T[]}
 */
export function rankForOwner(tokens, owner) {
  const list = [...(tokens ?? [])];
  if (!owner) return list;
  /** @type {(entry: T) => number} */
  const order = (entry) => REACH_ORDER[/** @type {keyof typeof REACH_ORDER} */ (entry.kind ?? 'unknown')] ?? 1;
  const reaching = list.filter((entry) => reaches(entry, owner)).sort((a, b) => order(a) - order(b));
  return [...reaching, ...list.filter((entry) => !reaching.includes(entry))];
}

/**
 * The one token a search goes out with. A search that names an owner goes with the widest reach
 * into that owner. A bare word goes with the widest reach overall — a classic token if there is
 * one, else the sign-in. Either way the results are only those the token may see, and GitHub says
 * nothing about the ones it leaves out, so this is the opposite of rankForOwner's narrowest first.
 * That order saves a classic token's budget where any token that reaches will do, but here it would
 * hide every repository outside an installation's selection that the classic token can see.
 * @template {{ kind?: string | null, owners?: string[] | null, target?: string | null, installations?: { owner: string, selection?: string }[] | null }} T
 * @param {T[]} tokens
 * @param {unknown} query
 * @returns {T | null}
 */
export function pickSearchToken(tokens, query) {
  const list = tokens ?? [];
  const owner = queryOwner(query);
  if (owner) {
    const reaching = list.filter((entry) => reaches(entry, owner));
    return [...reaching].sort((a, b) => searchReach(b, owner) - searchReach(a, owner))[0] ?? list[0] ?? null;
  }
  return list.find((entry) => entry.kind === 'classic') ?? list.find((entry) => entry.kind === 'app') ?? list[0] ?? null;
}

/**
 * How much of one owner a token that reaches it can search, widest highest. A classic token sees
 * all the account does. An installation on all of an owner's repositories sees as much of them as
 * the account does. A fine-grained token may have been made for a few repositories, and gitchop
 * cannot tell. An installation on selected repositories is known to see only some.
 * @param {{ kind?: string | null, installations?: { owner: string, selection?: string }[] | null }} entry
 * @param {string} owner
 * @returns {number}
 */
function searchReach(entry, owner) {
  if (entry.kind === 'classic') return 3;
  if (entry.kind !== 'app') return 1;
  const wanted = owner.toLowerCase();
  const install = (entry.installations ?? []).find((each) => String(each.owner ?? '').toLowerCase() === wanted);
  return install?.selection === 'selected' ? 0 : 2;
}

/**
 * Accounts worth favouring, read straight off the saved links: anything linked at
 * github.com/<owner> or github.com/<owner>/<repo>. Links kept in the menu are a good signal
 * of whose repositories matter, and the order is the order they were put in.
 * @param {({ url?: string } | null)[] | null | undefined} links
 * @returns {string[]}
 */
export function ownersFromLinks(links) {
  /** @type {string[]} */
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
 * @param {string} token
 * @param {number} [pages]
 * @param {number} [perPage]
 * @param {'all' | 'public' | 'private' | null} [visibility]
 * @returns {Promise<Repo[]>}
 */
export async function listAccessibleRepos(token, pages = 6, perPage = 100, visibility = null) {
  /** @type {Repo[]} */
  const all = [];
  for (let page = 1; page <= pages; page += 1) {
    const only = visibility ? `&visibility=${visibility}` : '';
    const query = `per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated${only}`;
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

/**
 * Whose private repositories these are, first seen first, in GitHub's own casing. Public ones say
 * nothing about a token: every token on GitHub can list those, whoever it was made for, so a token
 * an organisation has yet to approve lists the public half of every organisation the account belongs
 * to. The private repositories are the grant itself.
 * @param {({ private?: boolean, fullName?: string } | null)[] | null | undefined} repos
 * @returns {string[]}
 */
export function privateOwnersOf(repos) {
  /** @type {string[]} */
  const owners = [];
  for (const repo of repos ?? []) {
    if (!repo?.private) continue;
    const full = String(repo.fullName ?? '');
    const slash = full.indexOf('/');
    if (slash < 1) continue;
    const owner = full.slice(0, slash);
    if (!owners.some((seen) => seen.toLowerCase() === owner.toLowerCase())) owners.push(owner);
  }
  return owners;
}

/**
 * Who a token speaks for. A fine-grained token has exactly one resource owner and GitHub never says
 * which, so it is read off the private repositories the token lists; one page names it. An empty
 * answer is itself news: nothing selected, or an organisation that has yet to approve the token.
 * @param {string} token
 * @returns {Promise<string[]>}
 */
export async function ownersReachable(token) {
  return privateOwnersOf(await listAccessibleRepos(token, 1, 100, 'private'));
}

/**
 * Exact name, then prefix, then substring; shorter names win ties.
 * @template {{ fullName: string }} R
 * @param {R[] | null | undefined} index
 * @param {unknown} query
 * @param {number} [limit]
 * @returns {R[]}
 */
export function matchIndex(index, query, limit = REPO_LIMIT) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (needle.length < 2) return [];

  /** @type {[number, R][]} */
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

/**
 * @param {Repo[][]} groups
 * @param {number} limit
 */
function merge(groups, limit) {
  const seen = new Set();
  /** @type {Repo[]} */
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
 * @param {unknown} query
 * @param {string | null | undefined} token
 * @param {string[]} [owners]
 * @param {number} [limit]
 * @returns {Promise<Repo[]>}
 */
export async function findRepos(query, token, owners = [], limit = REPO_LIMIT) {
  const trimmed = cleanQuery(query);
  if (trimmed.length < 2) return [];

  /** @type {(name: string) => boolean} */
  const favoured = (name) => owners.some((owner) => owner.toLowerCase() === name.toLowerCase());

  if (SLASHED.test(trimmed)) {
    const [owner, name] = trimmed.split('/');
    const direct = await get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token);
    if (direct.ok) return [shape(direct.body, favoured(owner))];
    return search(name, token, limit);
  }

  const scope = owners.map((owner) => `user:${owner}`).join(' ');
  const [scoped, general] = await Promise.allSettled([
    scope ? search(`${trimmed} in:name ${scope}`, token, Math.ceil(limit / 2), true) : Promise.resolve([]),
    search(trimmed, token, limit),
  ]);

  if (scoped.status === 'rejected' && general.status === 'rejected') throw general.reason;

  return merge(
    [scoped.status === 'fulfilled' ? scoped.value : [], general.status === 'fulfilled' ? general.value : []],
    limit,
  );
}
