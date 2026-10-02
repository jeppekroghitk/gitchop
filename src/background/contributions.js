import { api } from '../lib/links.js';
import { age } from '../lib/pulls.js';
import { SETTINGS_KEY as CONTRIB_SETTINGS_KEY, bestOf, fetchContributions, sanitizeSettings as contribSettings, yearWindow, yearWindows } from '../lib/contributions.js';
import { now, readConfig } from './config.js';
import { CONTRIB_CACHE_KEY } from './keys.js';
import { loadTokens } from './tokens.js';

/** How long the year's count answers the menu without a request; nothing but the menu shows it, so no alarm. */
const CONTRIB_FRESH = 5 * 60 * 1000;

/**
 * The year's contributions — the number the profile prints — and the three whole years before it
 * are a snapshot in storage.local that the menu paints from instantly, and a refresh that runs when
 * the menu asks with a snapshot older than five minutes, or one from another year. No alarm:
 * nothing outside the menu shows them, so nothing needs them fresh before the key is pressed.
 * Every token is asked, since a fine-grained one sees a single owner's repositories and counts
 * accordingly, and the highest count for this year is kept, its past years with it.
 */
let contribRefresh = null;

export async function readContribSettings() {
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
export function refreshContributions() {
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
export async function contributionsState() {
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
