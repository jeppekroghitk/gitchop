import { DEFAULT_LINKS, PANEL_KEY, api, isSafeUrl, loadLinks, sanitize, sanitizePanel, saveLinks, withIds } from './lib/links.js';
import { createStore, identify, readStore, scopesGrantWrite, tokenKind, tokenLabel, writeStore } from './lib/gist.js';
import { findRepos, listAccessibleRepos, matchIndex, ownersFromLinks, ownersReachable, privateOwnersOf } from './lib/repos.js';
import { newVaultKey, seal, unseal } from './lib/vault.js';
import {
  LANES,
  SETTINGS_KEY as PULLS_SETTINGS_KEY,
  age,
  fetchLanes,
  mergeLanes,
  sanitizeSettings as pullsSettings,
} from './lib/pulls.js';
import {
  SETTINGS_KEY as NEWS_SETTINGS_KEY,
  describeSince,
  editionTime,
  editionWindow,
  emptyDigest,
  fetchDigest,
  isQuiet,
  nextEditionTime,
  proseFor,
  sanitizeSettings as newsSettings,
  toggleRepo,
} from './lib/news.js';
import {
  SETTINGS_KEY as CONTRIB_SETTINGS_KEY,
  bestOf,
  fetchContributions,
  sanitizeSettings as contribSettings,
  yearWindow,
  yearWindows,
} from './lib/contributions.js';

const CONFIG_KEY = 'sync';
const INDEX_KEY = 'index';
const PULLS_CACHE_KEY = 'pullsCache';
const PULLS_ALARM = 'gitchop:pulls';
const NEWS_CACHE_KEY = 'newsCache';
const NEWS_ALARM = 'gitchop:news';
const CONTRIB_CACHE_KEY = 'contributionsCache';
/** How long the year's count answers the menu without a request; nothing but the menu shows it, so no alarm. */
const CONTRIB_FRESH = 5 * 60 * 1000;
/** How long a snapshot answers the menu without a request; the alarm keeps it about this fresh. */
const PULLS_FRESH = 60 * 1000;
const PULLS_EVERY_MINUTES = 5;
const PUSH_DELAY = 1500;
const MAX_LINKS = 200;

/**
 * The gist is the durable copy; storage.sync is the working copy the menu reads, so the menu opens
 * instantly and offline. Tokens live in storage.local — never in storage.sync, which would ship them
 * to Mozilla's servers — and every request to GitHub happens here in the background, so no page
 * context ever sees one.
 *
 * Tokens are a list because a fine-grained token has exactly one resource owner. Two organisations
 * and a personal account means three tokens. The single-token alternative is a classic token with
 * the repo scope, which has no read-only form and so buys that convenience with write access to
 * everything the account can reach.
 */
let pushTimer = null;
let inStep = null;

function now() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

async function readConfig() {
  const stored = await api.storage.local.get(CONFIG_KEY);
  const config = stored[CONFIG_KEY] ?? {};
  if (!Array.isArray(config.tokens)) {
    // Carried over from when a single token was all there was.
    config.tokens = config.token
      ? [
          {
            id: newId(),
            token: config.token,
            login: config.login ?? null,
            kind: config.tokenKind ?? tokenKind(config.token),
            scopes: config.scopes ?? [],
          },
        ]
      : [];
  }
  return config;
}

async function writeConfig(patch) {
  const next = { ...(await readConfig()), ...patch };
  for (const legacy of ['token', 'tokenKind', 'scopes', 'login']) delete next[legacy];
  await api.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

/**
 * Tokens come out of storage only here, and go back only through storeTokens, so a plain token
 * cannot survive a write. Entries still carrying a legacy `token` field are read as-is and sealed by
 * the migration below.
 */
async function loadTokens() {
  const config = await readConfig();
  const opened = [];
  for (const entry of config.tokens) {
    let secret = typeof entry.token === 'string' ? entry.token : null;
    if (entry.sealed && config.vaultKey) {
      try {
        secret = await unseal(entry.sealed, config.vaultKey);
      } catch {
        secret = null;
      }
    }
    if (secret) opened.push({ ...entry, secret });
  }
  return opened;
}

async function storeTokens(entries) {
  const config = await readConfig();
  const vaultKey = config.vaultKey ?? newVaultKey();
  const tokens = [];
  for (const entry of entries) {
    tokens.push({
      id: entry.id,
      login: entry.login ?? null,
      kind: entry.kind ?? null,
      scopes: entry.scopes ?? [],
      owners: Array.isArray(entry.owners) ? entry.owners : null,
      sealed: await seal(entry.secret, vaultKey),
    });
  }
  await writeConfig({ vaultKey, tokens });
}

/** Everything the settings page may know — deliberately never a token itself. */
async function state() {
  const config = await readConfig();
  return {
    tokens: config.tokens.map(({ id, login, kind, scopes, owners }) => ({
      id,
      login: login ?? null,
      kind: kind ?? null,
      scopes: scopes ?? [],
      owners: Array.isArray(owners) ? owners : null,
      broad: scopesGrantWrite(scopes),
    })),
    hasToken: config.tokens.length > 0,
    connected: config.tokens.length > 0 && Boolean(config.gistId),
    gistId: config.gistId ?? null,
    gistUrl: config.gistId ? `https://gist.github.com/${config.gistId}` : null,
    lastPulledAt: config.lastPulledAt ?? null,
    lastPushedAt: config.lastPushedAt ?? null,
    dirty: Boolean(config.dirty),
    lastError: config.lastError ?? null,
  };
}

/**
 * Only one of the tokens will hold the Gists permission, and a fine-grained token cannot be asked
 * what it can do. So try them, remember the one that worked, and start with it next time.
 */
async function withGistToken(run) {
  const config = await readConfig();
  const tokens = await loadTokens();
  if (tokens.length === 0) throw new Error('Add a token first.');

  const preferred = config.gistTokenId;
  const ordered = [...tokens].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));

  let failure = null;
  for (const entry of ordered) {
    try {
      const result = await run(entry.secret);
      if (entry.id !== preferred) await writeConfig({ gistTokenId: entry.id });
      return result;
    } catch (error) {
      failure = error;
    }
  }
  throw failure ?? new Error('No saved token could reach the gist.');
}

/**
 * Writes the remote list locally without the change bouncing straight back as a push.
 *
 * The gist is the one input gitchop does not author. A secret gist is unlisted rather than private,
 * and an id can be adopted from anywhere, so what comes back is treated as untrusted: anything that
 * is not an http(s) URL is dropped rather than stored, and the list is capped.
 */
async function applyRemote(links) {
  const clean = links
    .filter((link) => link && typeof link === 'object')
    .map(sanitize)
    .filter((link) => isSafeUrl(link.url))
    .slice(0, MAX_LINKS);
  inStep = JSON.stringify(clean);
  await api.storage.sync.set({ links: clean });
  return clean;
}

async function push({ force = false } = {}) {
  const config = await readConfig();
  if (config.tokens.length === 0 || !config.gistId) return { skipped: true };

  const links = await loadLinks();
  const payload = JSON.stringify(links);
  if (!force && payload === inStep) {
    await writeConfig({ dirty: false });
    return { changed: false };
  }

  try {
    await withGistToken((token) => writeStore(token, config.gistId, links));
  } catch (error) {
    await writeConfig({ lastError: String(error.message ?? error) });
    throw error;
  }
  inStep = payload;
  await writeConfig({ lastPushedAt: now(), dirty: false, lastError: null });
  return { changed: true };
}

async function pull({ force = false } = {}) {
  const config = await readConfig();
  if (config.tokens.length === 0 || !config.gistId) return { skipped: true };

  // Local edits that never made it out take priority over overwriting them.
  if (config.dirty && !force) {
    await push();
    return { pushedInstead: true };
  }

  let remote;
  try {
    remote = await withGistToken((token) => readStore(token, config.gistId));
  } catch (error) {
    await writeConfig({ lastError: String(error.message ?? error) });
    throw error;
  }

  const before = JSON.stringify(await loadLinks());
  const applied = await applyRemote(remote.links);
  await writeConfig({ lastPulledAt: now(), lastError: null, dirty: false });
  return { changed: JSON.stringify(applied) !== before, count: applied.length };
}

async function addToken({ token }) {
  const trimmed = String(token ?? '').trim();
  if (!trimmed) throw new Error('A token is required.');

  const saved = await loadTokens();
  if (saved.some((entry) => entry.secret === trimmed)) throw new Error('That token is already saved.');

  // Only for labelling, so never let it block saving — a fine-grained token may decline /user while
  // working perfectly for repositories.
  const who = await identify(trimmed).catch(() => ({ login: null, scopes: [], kind: tokenKind(trimmed) }));
  // The owner a fine-grained token speaks for shows only in the private repositories it lists. Not
  // knowing is no reason to refuse the token either; building the index asks again and fills it in.
  const owners = await ownersReachable(trimmed).catch(() => null);
  const entry = {
    id: newId(),
    secret: trimmed,
    login: who.login ?? null,
    kind: who.kind ?? tokenKind(trimmed),
    scopes: who.scopes ?? [],
    owners,
  };
  await storeTokens([...saved, entry]);
  await writeConfig({ lastError: null });
  return state();
}

async function removeToken({ id }) {
  const config = await readConfig();
  const kept = (await loadTokens()).filter((entry) => entry.id !== id);
  await storeTokens(kept);
  const patch = {};

  if (kept.length === 0) {
    // Nothing left to reach GitHub with, so stop claiming to sync and drop the index. The edition
    // and the year's count go too: what a token saw of a private repository should not outlive it.
    patch.gistId = null;
    patch.gistTokenId = null;
    patch.dirty = false;
    await api.storage.local.remove([INDEX_KEY, PULLS_CACHE_KEY, NEWS_CACHE_KEY, CONTRIB_CACHE_KEY]);
  } else if (config.gistTokenId === id) {
    patch.gistTokenId = null;
  }

  if (Object.keys(patch).length > 0) await writeConfig(patch);
  return state();
}

async function connectGist({ gistId }) {
  const config = await readConfig();
  if (config.tokens.length === 0) throw new Error('Add a token first.');
  const wanted = String(gistId ?? '').trim();

  let id = wanted;
  let links;
  if (id) {
    links = (await withGistToken((token) => readStore(token, id))).links;
  } else {
    const existing = await loadLinks();
    links = existing.length > 0 ? existing : withIds(DEFAULT_LINKS);
    id = (await withGistToken((token) => createStore(token, links))).id;
  }

  await applyRemote(links);
  await writeConfig({ gistId: id, lastPulledAt: now(), lastPushedAt: now(), dirty: false, lastError: null });
  return state();
}

/** Stops backing up without touching the tokens, which private repository search still needs. */
async function stopBackup() {
  await writeConfig({ gistId: null, gistTokenId: null, dirty: false, lastError: null });
  return state();
}

async function readIndex() {
  const stored = await api.storage.local.get(INDEX_KEY);
  return stored[INDEX_KEY] ?? { repos: [], builtAt: null, failures: [] };
}

/**
 * Every token contributes, because each one can only speak for its own resource owner. The full
 * listing also settles which owners each token reaches, so the token rows in Settings stay true.
 */
async function buildIndex() {
  const tokens = await loadTokens();
  if (tokens.length === 0) throw new Error('Add a token first.');

  const seen = new Map();
  const failures = [];
  for (const entry of tokens) {
    try {
      const repos = await listAccessibleRepos(entry.secret);
      entry.owners = privateOwnersOf(repos);
      for (const repo of repos) {
        const key = repo.fullName.toLowerCase();
        if (seen.has(key)) continue;
        seen.set(key, {
          fullName: repo.fullName,
          url: repo.url,
          description: repo.description,
          private: repo.private,
          archived: repo.archived,
          owned: true,
        });
      }
    } catch (error) {
      failures.push(`${tokenLabel(entry)}: ${String(error.message ?? error)}`);
    }
  }

  if (seen.size === 0 && failures.length > 0) throw new Error(failures.join(' · '));

  const index = { repos: [...seen.values()], builtAt: now(), failures };
  await api.storage.local.set({ [INDEX_KEY]: index });
  await storeTokens(tokens);
  return indexState(index);
}

function indexState(index) {
  const tally = new Map();
  for (const repo of index.repos) {
    const owner = repo.fullName.slice(0, repo.fullName.indexOf('/'));
    tally.set(owner, (tally.get(owner) ?? 0) + 1);
  }
  const owners = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([owner, count]) => ({ owner, count }));

  return {
    count: index.repos.length,
    privateCount: index.repos.filter((repo) => repo.private).length,
    owners: owners.slice(0, 12),
    failures: index.failures ?? [],
    builtAt: index.builtAt,
  };
}

/**
 * The pull requests — waiting for your review, yours that were reviewed, yours that were not — are a
 * snapshot in storage.local that the menu paints from instantly, and a refresh that runs when the
 * snapshot is older than a minute: on demand when the menu asks, and on an alarm so the toolbar
 * badge is right before the key is ever pressed. Every token contributes, since a fine-grained one
 * sees a single owner; the answers are merged by URL.
 */
let pullsRefresh = null;

async function readPullsSettings() {
  try {
    const stored = await api.storage.sync.get(PULLS_SETTINGS_KEY);
    return pullsSettings(stored[PULLS_SETTINGS_KEY]);
  } catch {
    return pullsSettings();
  }
}

async function readPullsCache() {
  const stored = await api.storage.local.get(PULLS_CACHE_KEY);
  return stored[PULLS_CACHE_KEY] ?? null;
}

function pullsAreStale(cache) {
  if (!cache?.fetchedAt) return true;
  return Date.now() - new Date(cache.fetchedAt).valueOf() > PULLS_FRESH;
}

/**
 * One request in flight at a time, shared by whoever asked. A failure keeps the last good lanes
 * and records the sentence, so the menu shows what it knows and says the refresh did not land.
 */
function refreshPulls() {
  if (pullsRefresh) return pullsRefresh;
  pullsRefresh = (async () => {
    const tokens = await loadTokens();
    if (tokens.length === 0) return null;
    const settings = await readPullsSettings();
    const previous = await readPullsCache();

    const results = [];
    const failures = [];
    for (const entry of tokens) {
      try {
        results.push(await fetchLanes(entry.secret, settings));
      } catch (error) {
        failures.push(String(error.message ?? error));
      }
    }

    let next;
    if (results.length === 0) {
      next = { ...(previous ?? { lanes: null, fetchedAt: null }), error: failures[0] ?? 'GitHub did not answer.', failedAt: now() };
    } else {
      next = {
        lanes: mergeLanes(results),
        fetchedAt: now(),
        drafts: settings.drafts,
        error: null,
        failedAt: null,
        partial: failures.length > 0 ? failures[0] : null,
      };
    }
    await api.storage.local.set({ [PULLS_CACHE_KEY]: next });
    await paintAction();
    return next;
  })().finally(() => {
    pullsRefresh = null;
  });
  return pullsRefresh;
}

/**
 * Lanes as the menu draws them, in order, each carrying its own title and slot count — the menu is
 * a classic content script and cannot import the module that defines them. `pulls` is null until a
 * snapshot exists, which is the menu's cue to draw skeletons. Ages are worked out here, the one
 * place that knows the clock.
 */
function presentLanes(cache) {
  const at = Date.now();
  return LANES.map((lane) => {
    const part = cache?.lanes?.[lane.id];
    return {
      ...lane,
      total: part ? part.total ?? part.pulls.length : null,
      pulls: part ? part.pulls.map((pull) => ({ ...pull, age: age(pull.updatedAt, at) })) : null,
    };
  });
}

/**
 * Everything the menu and the settings card need in one answer. `show` is the whole decision for
 * the menu: no token or switched off means no column at all, not an empty one asking for a token.
 */
async function pullsState() {
  const [settings, config, cache] = await Promise.all([readPullsSettings(), readConfig(), readPullsCache()]);
  const hasToken = config.tokens.length > 0;
  // Drafts switched since the snapshot was taken means the snapshot no longer matches the setting.
  const stale = pullsAreStale(cache) || (cache?.lanes && cache.drafts !== settings.drafts);
  return {
    settings,
    hasToken,
    show: hasToken && settings.enabled === 1,
    stale: Boolean(stale),
    fetchedAt: cache?.fetchedAt ?? null,
    fetchedAgo: cache?.fetchedAt ? age(cache.fetchedAt) : '',
    error: cache?.error ?? null,
    partial: cache?.partial ?? null,
    lanes: presentLanes(cache),
  };
}

async function schedulePulls() {
  if (!api.alarms) return;
  try {
    const settings = await readPullsSettings();
    const config = await readConfig();
    if (settings.enabled === 1 && config.tokens.length > 0) {
      const existing = await api.alarms.get(PULLS_ALARM);
      if (!existing) await api.alarms.create(PULLS_ALARM, { periodInMinutes: PULLS_EVERY_MINUTES });
    } else {
      await api.alarms.clear(PULLS_ALARM);
    }
  } catch {
    /* no alarm means no badge until the menu asks; the menu still works */
  }
}

/**
 * The news is an edition, not a feed: made up once a day at the hour set in Settings, covering
 * everything since the previous one, and shown unchanged until the next. It is a snapshot in
 * storage.local the menu paints from instantly. The refresh runs when the edition on file is not
 * the current one — on the alarm at the hour, when the menu asks, when a repository subscribed at
 * noon has no place in it yet — and a repository that failed is asked again after a while rather
 * than on every open. Each repository is fetched with the token that can see it, remembered from
 * last time, and anonymously when no token can: public repositories need none.
 */
let newsRefresh = null;
const NEWS_RETRY = 15 * 60 * 1000;

async function readNewsSettings() {
  try {
    const stored = await api.storage.sync.get(NEWS_SETTINGS_KEY);
    return newsSettings(stored[NEWS_SETTINGS_KEY]);
  } catch {
    return newsSettings();
  }
}

async function writeNewsSettings(settings) {
  await api.storage.sync.set({ [NEWS_SETTINGS_KEY]: newsSettings(settings) });
}

async function readNewsCache() {
  const stored = await api.storage.local.get(NEWS_CACHE_KEY);
  return stored[NEWS_CACHE_KEY] ?? null;
}

/** The edition on file is this morning's, and every subscribed repository has a place in it. */
function newsIsStale(cache, settings, at = Date.now()) {
  if (!cache?.until || Date.parse(cache.until) !== editionTime(at, settings.hour)) return true;
  return settings.repos.some((repo) => {
    const part = cache.repos?.[repo.toLowerCase()];
    if (!part) return true;
    if (!part.error) return false;
    const failedAt = Date.parse(part.failedAt ?? '');
    return Number.isNaN(failedAt) || at - failedAt > NEWS_RETRY;
  });
}

/**
 * A fine-grained token sees one owner, a classic one sees everything, and a public repository
 * needs none. So the token that worked for this repository last time goes first, the others
 * follow, and anonymous comes last — the lowest rate limit, and blind to private repositories.
 * A rejection or a not-found moves on to the next; anything else is the answer. When every try
 * fails, the first token's reason is the one reported — "the token cannot see it" says more than
 * the anonymous not-found that follows it.
 */
async function withRepoToken(tokens, preferredId, run) {
  const ordered = [...tokens].sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
  let first = null;
  for (const entry of [...ordered, null]) {
    try {
      return { result: await run(entry?.secret ?? null), tokenId: entry?.id ?? null };
    } catch (error) {
      first = first ?? error;
      if (![401, 403, 404].includes(error?.status)) throw error;
    }
  }
  throw first ?? new Error('GitHub did not answer.');
}

/**
 * One refresh in flight at a time, shared by whoever asked. Inside one edition a repository that
 * already answered is not asked again; a forced refresh — the button in Settings — asks everyone.
 * A repository that fails keeps whatever it had and records the sentence.
 */
function refreshNews({ force = false } = {}) {
  if (newsRefresh) return newsRefresh;
  newsRefresh = (async () => {
    const settings = await readNewsSettings();
    const previous = await readNewsCache();
    if (settings.repos.length === 0) {
      if (previous) await api.storage.local.remove(NEWS_CACHE_KEY);
      return null;
    }
    const at = Date.now();
    // Switched off, nothing is looking: the start-of-browser refresh spends no requests on it.
    if (!force && (settings.enabled !== 1 || !newsIsStale(previous, settings, at))) return previous;

    const window = editionWindow(at, settings.hour, previous);
    const sameEdition = previous?.until === window.until && previous?.since === window.since;
    const tokens = await loadTokens();
    const repos = {};
    for (const repo of settings.repos) {
      const key = repo.toLowerCase();
      const before = previous?.repos?.[key] ?? null;
      const kept = sameEdition ? before : null;
      if (kept && !kept.error && !force) {
        repos[key] = kept;
        continue;
      }
      try {
        const { result, tokenId } = await withRepoToken(tokens, before?.tokenId ?? null, (token) => fetchDigest(repo, window, token));
        repos[key] = { ...result, tokenId, error: null, failedAt: null };
      } catch (error) {
        repos[key] = { ...(kept ?? emptyDigest(repo)), error: String(error.message ?? error), failedAt: now() };
      }
    }

    const next = { since: window.since, until: window.until, hour: settings.hour, fetchedAt: now(), repos };
    await api.storage.local.set({ [NEWS_CACHE_KEY]: next });
    return next;
  })().finally(() => {
    newsRefresh = null;
  });
  return newsRefresh;
}

/**
 * The edition as the menu draws it: one section per subscribed repository, in the order they were
 * subscribed, each already told as prose — the menu is a classic content script and cannot import
 * the module that writes it. `prose` is null for a repository the edition has not reached yet,
 * which is the menu's cue to draw skeletons; empty prose is a quiet day, or the failure that
 * stands where the day would be.
 */
function presentNews(cache, settings) {
  const window = cache?.since && cache?.until ? { since: cache.since, until: cache.until } : null;
  return settings.repos.map((repo) => {
    const part = window ? cache.repos?.[repo.toLowerCase()] : null;
    if (!part) return { repo, url: `https://github.com/${repo}`, private: false, prose: null, quiet: false, error: null };
    return {
      repo: part.repo || repo,
      url: part.url || `https://github.com/${repo}`,
      private: Boolean(part.private),
      prose: proseFor(part, window),
      quiet: !part.error && isQuiet(part),
      error: part.error ?? null,
    };
  });
}

/**
 * Everything the menu and the settings card need in one answer. Only this morning's edition is
 * presented: yesterday's, still on file at nine, is skeletons and a refresh, not a stale page
 * under a header that says otherwise. `show` is the whole decision for the menu — off means no
 * column; on with nothing subscribed means a column the moment something is.
 */
async function newsState() {
  const [settings, cache] = await Promise.all([readNewsSettings(), readNewsCache()]);
  const at = Date.now();
  const current = cache && Date.parse(cache.until) === editionTime(at, settings.hour) ? cache : null;
  const window = current ? { since: current.since, until: current.until } : editionWindow(at, settings.hour, cache);
  return {
    settings,
    show: settings.enabled === 1,
    stale: settings.repos.length > 0 && newsIsStale(cache, settings, at),
    since: window.since,
    until: window.until,
    sinceLabel: describeSince(window.since, at),
    fetchedAt: current?.fetchedAt ?? null,
    repos: presentNews(current, settings),
  };
}

/** One alarm, at the next edition hour; re-armed when it fires, and on every start since Firefox forgets them. */
async function scheduleNews() {
  if (!api.alarms) return;
  try {
    const settings = await readNewsSettings();
    if (settings.enabled === 1 && settings.repos.length > 0) {
      await api.alarms.create(NEWS_ALARM, { when: nextEditionTime(Date.now(), settings.hour) });
    } else {
      await api.alarms.clear(NEWS_ALARM);
    }
  } catch {
    /* no alarm means the edition is made up when the menu next opens; the menu still works */
  }
}

async function subscribeNews(repo, subscribe) {
  const settings = await readNewsSettings();
  const repos = toggleRepo(settings, repo, subscribe);
  if (repos !== settings.repos) {
    await writeNewsSettings({ ...settings, repos });
    // The new repository has no place in the edition yet; start on it now so the menu's follow-up
    // request joins a fetch already under way.
    if (subscribe) refreshNews().catch(() => {});
  }
  return newsState();
}

/**
 * The year's contributions — the number the profile prints — and the three whole years before it
 * are a snapshot in storage.local that the menu paints from instantly, and a refresh that runs when
 * the menu asks with a snapshot older than five minutes, or one from another year. No alarm:
 * nothing outside the menu shows them, so nothing needs them fresh before the key is pressed.
 * Every token is asked, since a fine-grained one sees a single owner's repositories and counts
 * accordingly, and the highest count for this year is kept, its past years with it.
 */
let contribRefresh = null;

async function readContribSettings() {
  try {
    const stored = await api.storage.sync.get(CONTRIB_SETTINGS_KEY);
    return contribSettings(stored[CONTRIB_SETTINGS_KEY]);
  } catch {
    return contribSettings();
  }
}

async function readContribCache() {
  const stored = await api.storage.local.get(CONTRIB_CACHE_KEY);
  return stored[CONTRIB_CACHE_KEY] ?? null;
}

function contribIsStale(cache, at = Date.now()) {
  if (!cache?.fetchedAt || cache.year !== yearWindow(at).year) return true;
  return at - new Date(cache.fetchedAt).valueOf() > CONTRIB_FRESH;
}

/**
 * One request in flight at a time, shared by whoever asked. A failure keeps the last good count and
 * records the sentence, so the menu shows what it knows and the settings page says why the refresh
 * did not land.
 */
function refreshContributions() {
  if (contribRefresh) return contribRefresh;
  contribRefresh = (async () => {
    const tokens = await loadTokens();
    if (tokens.length === 0) return null;
    const previous = await readContribCache();
    const windows = yearWindows();

    const results = [];
    const failures = [];
    for (const entry of tokens) {
      try {
        results.push(await fetchContributions(entry.secret, windows));
      } catch (error) {
        failures.push(String(error.message ?? error));
      }
    }

    const best = bestOf(results);
    let next;
    if (!best) {
      next = {
        ...(previous ?? { year: windows[0].year, total: null, login: null, years: [], fetchedAt: null }),
        error: failures[0] ?? 'GitHub did not answer.',
        failedAt: now(),
      };
    } else {
      next = {
        year: windows[0].year,
        total: best.total,
        login: best.login || null,
        years: best.years ?? [],
        fetchedAt: now(),
        error: null,
        failedAt: null,
        partial: failures.length > 0 ? failures[0] : null,
      };
    }
    await api.storage.local.set({ [CONTRIB_CACHE_KEY]: next });
    return next;
  })().finally(() => {
    contribRefresh = null;
  });
  return contribRefresh;
}

/**
 * Everything the menu and the settings card need in one answer. `show` is the whole decision for
 * the menu: no token or switched off means no number, not a shimmer asking for a token. Only a
 * snapshot of this year is presented — last year's count under this year's label would be wrong,
 * so on New Year's Day it is a shimmer and a refresh. `past` is the whole years before this one,
 * newest first, for the hover.
 */
async function contributionsState() {
  const [settings, config, cache] = await Promise.all([readContribSettings(), readConfig(), readContribCache()]);
  const hasToken = config.tokens.length > 0;
  const at = Date.now();
  const { year } = yearWindow(at);
  const current = cache && cache.year === year ? cache : null;
  return {
    settings,
    hasToken,
    show: hasToken && settings.enabled === 1,
    stale: contribIsStale(cache, at),
    year,
    total: Number.isFinite(current?.total) ? current.total : null,
    past: (current?.years ?? [])
      .filter((entry) => Number.isFinite(entry?.total) && Number.isInteger(entry?.year) && entry.year < year)
      .map((entry) => ({ year: entry.year, total: entry.total })),
    login: current?.login ?? null,
    fetchedAt: current?.fetchedAt ?? null,
    fetchedAgo: current?.fetchedAt ? age(current.fetchedAt, at) : '',
    error: cache?.error ?? null,
    partial: cache?.partial ?? null,
  };
}

/**
 * Whether the panel itself — the links and the search — rises with the menu. Off, the columns stand
 * on their own; the menu decides for itself that with no column to stand, the panel stays.
 */
async function readPanel() {
  try {
    const stored = await api.storage.sync.get(PANEL_KEY);
    return sanitizePanel(stored[PANEL_KEY]);
  } catch {
    return sanitizePanel();
  }
}

async function panelState() {
  const settings = await readPanel();
  return { settings, show: settings.enabled === 1 };
}

const HANDLERS = {
  'gitchop:options': async () => {
    await api.runtime.openOptionsPage();
    return {};
  },
  /** Instant, from the local index. No network, so the menu can call it on every settle. */
  'gitchop:repos:mine': async (message) => {
    const index = await readIndex();
    return { results: matchIndex(index.repos, message.query) };
  },
  'gitchop:repos': async (message) => {
    const [first] = await loadTokens();
    const owners = ownersFromLinks(await loadLinks());
    return { results: await findRepos(message.query, first?.secret, owners), owners };
  },
  'gitchop:index:state': async () => indexState(await readIndex()),
  /** Instant: the snapshot as it stands, and whether it is worth asking for a fresh one. */
  'gitchop:pulls': () => pullsState(),
  /** Waits for GitHub. The menu calls it when the instant answer said stale. */
  'gitchop:pulls:refresh': async () => {
    await refreshPulls().catch(() => {});
    return pullsState();
  },
  'gitchop:pulls:settings': async (message) => {
    const settings = pullsSettings({ ...(await readPullsSettings()), ...(message.patch ?? {}) });
    await api.storage.sync.set({ [PULLS_SETTINGS_KEY]: settings });
    await schedulePulls();
    await paintAction();
    return pullsState();
  },
  /** Instant: the edition as it stands, and whether it is worth asking for a fresh one. */
  'gitchop:news': () => newsState(),
  /** Waits for GitHub. The menu calls it when the instant answer said stale; Settings forces it. */
  'gitchop:news:refresh': async (message) => {
    await refreshNews({ force: Boolean(message.force) }).catch(() => {});
    return newsState();
  },
  'gitchop:news:settings': async (message) => {
    // The switch and the hour only; the list has its own two messages.
    const settings = await readNewsSettings();
    await writeNewsSettings({ ...settings, ...(message.patch ?? {}), repos: settings.repos });
    await scheduleNews();
    return newsState();
  },
  'gitchop:news:subscribe': (message) => subscribeNews(message.repo, true),
  'gitchop:news:unsubscribe': (message) => subscribeNews(message.repo, false),
  /** Instant: the year's count as it stands, and whether it is worth asking for a fresh one. */
  'gitchop:contributions': () => contributionsState(),
  /** Waits for GitHub. The menu calls it when the instant answer said stale; Settings on demand. */
  'gitchop:contributions:refresh': async () => {
    await refreshContributions().catch(() => {});
    return contributionsState();
  },
  'gitchop:contributions:settings': async (message) => {
    const settings = contribSettings({ ...(await readContribSettings()), ...(message.patch ?? {}) });
    await api.storage.sync.set({ [CONTRIB_SETTINGS_KEY]: settings });
    return contributionsState();
  },
  /** Instant: whether the panel rises with the menu. */
  'gitchop:panel': () => panelState(),
  'gitchop:panel:settings': async (message) => {
    const settings = sanitizePanel({ ...(await readPanel()), ...(message.patch ?? {}) });
    await api.storage.sync.set({ [PANEL_KEY]: settings });
    return panelState();
  },
  'gitchop:index:build': () => buildIndex(),
  'gitchop:index:clear': async () => {
    await api.storage.local.remove(INDEX_KEY);
    return indexState({ repos: [], builtAt: null, failures: [] });
  },
  'gitchop:sync:state': () => state(),
  'gitchop:token:save': (message) => addToken(message),
  'gitchop:token:remove': (message) => removeToken(message),
  'gitchop:sync:connect': (message) => connectGist(message),
  'gitchop:sync:stop': () => stopBackup(),
  'gitchop:sync:pull': async (message) => ({ ...(await pull({ force: message.force })), ...(await state()) }),
  'gitchop:sync:push': async (message) => ({ ...(await push({ force: message.force })), ...(await state()) }),
};

api.runtime.onMessage.addListener((message, sender, respond) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message))
    .then((result) => respond({ ok: true, ...result }))
    .catch((error) => respond({ ok: false, error: String(error.message ?? error) }));
  return true;
});

api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const existing = await loadLinks();
    if (existing.length === 0) await saveLinks(withIds(DEFAULT_LINKS));
  }
  pull().catch(() => {});
  schedulePulls();
  scheduleNews();
  refreshNews().catch(() => {});
});

// The browser was shut at the edition hour more often than not; the edition is made up on the
// way in, so it is there before the key is pressed.
api.runtime.onStartup?.addListener(() => {
  pull().catch(() => {});
  schedulePulls();
  scheduleNews();
  refreshNews().catch(() => {});
});

api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === PULLS_ALARM) refreshPulls().catch(() => {});
  if (alarm.name === NEWS_ALARM) {
    refreshNews()
      .catch(() => {})
      .finally(() => scheduleNews());
  }
});

api.action.onClicked.addListener(() => {
  api.runtime.openOptionsPage();
});

/**
 * The toolbar icon carries one of two things. Firefox hands out host permissions on request rather
 * than at install, and Chrome lets them be narrowed to "on click" afterwards; either way the content
 * script then never runs and the "." key simply does nothing, so a missing grant is a red "!" that
 * points at the page that fixes it, and it wins over everything else. Otherwise, with the badge
 * switched on, it is the number of pull requests that need your review — before the key is
 * pressed.
 */
async function paintAction() {
  let granted = true;
  try {
    granted = await api.permissions.contains({ origins: ['https://github.com/*'] });
  } catch {
    return;
  }

  let text = '';
  let title = 'gitchop — settings';
  let color = '#c0473b';
  if (!granted) {
    text = '!';
    title = 'gitchop — needs access to github.com; click to fix';
  } else {
    const [settings, cache] = await Promise.all([readPullsSettings(), readPullsCache().catch(() => null)]);
    const waiting = cache?.lanes?.needsReview?.total ?? 0;
    if (settings.badge === 1 && settings.enabled === 1 && waiting > 0) {
      text = waiting > 99 ? '99+' : String(waiting);
      title = `gitchop — ${waiting} waiting on you`;
      color = '#3b4249';
    }
  }

  try {
    await api.action.setBadgeText({ text });
    await api.action.setBadgeBackgroundColor?.({ color });
    await api.action.setBadgeTextColor?.({ color: '#ffffff' });
    await api.action.setTitle({ title });
  } catch {
    /* older browsers may not offer badges on the action */
  }
}

(async () => {
  const config = await readConfig();
  if (config.tokens.some((entry) => typeof entry.token === 'string')) {
    await storeTokens(await loadTokens());
  }
})().catch(() => {});

api.permissions.onAdded?.addListener(() => paintAction());
api.permissions.onRemoved?.addListener(() => paintAction());
api.runtime.onStartup?.addListener(() => paintAction());
paintAction();

api.storage.onChanged.addListener((changes, area) => {
  // The pull request switches live in sync storage so they travel with the profile; a token arriving or
  // leaving is a local change. Either way the alarm and the badge follow.
  const tokensChanged =
    area === 'local' &&
    changes[CONFIG_KEY] &&
    (changes[CONFIG_KEY].oldValue?.tokens?.length ?? 0) !== (changes[CONFIG_KEY].newValue?.tokens?.length ?? 0);
  if ((area === 'sync' && changes[PULLS_SETTINGS_KEY]) || tokensChanged) {
    schedulePulls().then(() => paintAction()).catch(() => {});
  }
  // The subscriptions and the hour travel with the profile too, so an edit on another machine
  // re-arms the alarm here.
  if (area === 'sync' && changes[NEWS_SETTINGS_KEY]) scheduleNews().catch(() => {});
  if (area !== 'sync' || !changes.links) return;
  if (JSON.stringify(changes.links.newValue ?? []) === inStep) return;

  writeConfig({ dirty: true }).catch(() => {});
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push().catch(() => {}), PUSH_DELAY);
});
