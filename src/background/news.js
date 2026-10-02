import { api } from '../lib/links.js';
import {
  SETTINGS_KEY as NEWS_SETTINGS_KEY,
  describeSince,
  editionWindow,
  emptyDigest,
  fetchDigest,
  isCurrentEdition,
  isQuiet,
  nextEditionTime,
  proseFor,
  sanitizeSettings as newsSettings,
  toggleRepo,
} from '../lib/news.js';
import { now } from './config.js';
import { NEWS_CACHE_KEY } from './keys.js';
import { loadTokens } from './tokens.js';

export const NEWS_ALARM = 'gitchop:news';

/**
 * The news is an edition, not a feed: made up once a day at the hour set in Settings, covering
 * everything since the previous one — or as many days back as Settings asks, a week at most — and
 * shown unchanged until the next. It is a snapshot in
 * storage.local the menu paints from instantly. The refresh runs when the edition on file is not
 * the current one — on the alarm at the hour, when the menu asks, when a repository subscribed at
 * noon has no place in it yet — and a repository that failed is asked again after a while rather
 * than on every open. Each repository is fetched with the token that can see it, remembered from
 * last time, and anonymously when no token can: public repositories need none.
 */
let newsRefresh = null;
const NEWS_RETRY = 15 * 60 * 1000;

export async function readNewsSettings() {
  try {
    const stored = await api.storage.sync.get(NEWS_SETTINGS_KEY);
    return newsSettings(stored[NEWS_SETTINGS_KEY]);
  } catch {
    return newsSettings();
  }
}

export async function writeNewsSettings(settings) {
  await api.storage.sync.set({ [NEWS_SETTINGS_KEY]: newsSettings(settings) });
}

async function readNewsCache() {
  const stored = await api.storage.local.get(NEWS_CACHE_KEY);
  return stored[NEWS_CACHE_KEY] ?? null;
}

/** The edition on file is this morning's, covering what Settings asks, and every subscribed repository has a place in it. */
function newsIsStale(cache, settings, at = Date.now()) {
  if (!isCurrentEdition(cache, settings, at)) return true;
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
export function refreshNews({ force = false } = {}) {
  // One under way works from the settings it started with: a repository subscribed since, or a
  // span changed since, is not in it. An ask that finds one running therefore waits for it and
  // asks again — a look at what is still stale when nothing changed, a second round when it did —
  // and hands back that second answer, which is what is on file now. Joining the running one
  // instead left the menu on skeletons until its next open.
  if (newsRefresh) return newsRefresh.then(() => refreshNews({ force }));
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

    const window = editionWindow(at, settings.hour, previous, settings.days);
    const sameEdition = previous?.until === window.until && previous?.since === window.since;
    const tokens = await loadTokens();
    const repos = {};
    const edition = (parts) => ({ since: window.since, until: window.until, hour: settings.hour, days: settings.days, fetchedAt: now(), repos: parts });
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
      // Written as each repository lands, not once at the end. A menu that is up paints the
      // section the moment it is in, instead of skeletons until the last one is; and Firefox
      // ends an idle event page after half a minute, a request still waiting counting for
      // nothing, so what has landed must not go down with it — the next refresh then asks only
      // for what is missing. Inside one edition the parts already on file stay in the picture
      // until their replacements arrive, so a forced refresh never blanks the column.
      await api.storage.local.set({ [NEWS_CACHE_KEY]: edition({ ...(sameEdition ? previous.repos : {}), ...repos }) });
    }

    const next = edition(repos);
    await api.storage.local.set({ [NEWS_CACHE_KEY]: next });
    return next;
  })().finally(() => {
    newsRefresh = null;
  });
  return newsRefresh;
}

/**
 * The edition as the menu draws it: one section per subscribed repository, in the order they were
 * subscribed, each already told as prose — the background writes the edition, and the menu only
 * draws what it is handed. `prose` is null for a repository the edition has not reached yet,
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
export async function newsState() {
  const [settings, cache] = await Promise.all([readNewsSettings(), readNewsCache()]);
  const at = Date.now();
  const current = isCurrentEdition(cache, settings, at) ? cache : null;
  const window = current ? { since: current.since, until: current.until } : editionWindow(at, settings.hour, cache, settings.days);
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
export async function scheduleNews() {
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

export async function subscribeNews(repo, subscribe) {
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
