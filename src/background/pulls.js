import { api } from '../lib/links.js';
import { LANES, age, fetchLanes, mergeLanes } from '../lib/pulls.js';
import { paintAction } from './action.js';
import { hasUsableToken, now, readConfig } from './config.js';
import { PULLS_CACHE_KEY } from './keys.js';
import { readPullsCache, readPullsSettings } from './pulls-store.js';
import { loadTokens } from './tokens.js';

export const PULLS_ALARM = 'gitchop:pulls';
/**
 * How long a snapshot answers the menu without a request: the key pressed twice within a breath,
 * or an alarm that has just landed. Anything older is asked for again on every open — the point of
 * opening the menu after a review is to see the list as it stands, and a request in flight is
 * shared with whoever else asks.
 */
const PULLS_FRESH = 5 * 1000;
/** The alarm's own cadence, for the badge: right before the key is pressed, not only after. */
const PULLS_EVERY_MINUTES = 5;

/**
 * The pull requests — waiting for your review, yours that were reviewed, yours that were not — are a
 * snapshot in storage.local that the menu paints from instantly, and a refresh that runs behind it
 * on every open, and on an alarm so the toolbar badge is right before the key is ever pressed. The
 * menu paints the snapshot first and the answer after, so what left between the two is seen to
 * leave. Every token contributes, since a fine-grained one
 * sees a single owner; the answers are merged by URL.
 * @type {Promise<import('./pulls-store.js').PullsCache | null> | null}
 */
let pullsRefresh = null;

/** @param {import('./pulls-store.js').PullsCache | null} cache */
function pullsAreStale(cache) {
  if (!cache?.fetchedAt) return true;
  return Date.now() - new Date(cache.fetchedAt).valueOf() > PULLS_FRESH;
}

/**
 * One request in flight at a time, shared by whoever asked. A failure keeps the last good lanes
 * and records the sentence, so the menu shows what it knows and says the refresh did not land.
 */
export function refreshPulls() {
  if (pullsRefresh) return pullsRefresh;
  pullsRefresh = (async () => {
    const tokens = await loadTokens();
    if (tokens.length === 0) return null;
    const settings = await readPullsSettings();
    const previous = await readPullsCache();

    /** @type {import('../lib/pulls.js').Lanes[]} */
    const results = [];
    /** @type {string[]} */
    const failures = [];
    for (const entry of tokens) {
      try {
        results.push(await fetchLanes(entry.secret, settings));
      } catch (error) {
        failures.push(String(error.message ?? error));
      }
    }

    /** @type {import('./pulls-store.js').PullsCache} */
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
 * @param {import('./pulls-store.js').PullsCache | null} cache
 * @returns {PresentedLane[]}
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
 * One lane as the menu draws it: the lane's own description, how many GitHub says it holds, and its
 * pull requests each with its age — both null until a snapshot exists.
 * @typedef {(typeof LANES)[number] & {
 *   total: number | null,
 *   pulls: (import('../lib/pulls.js').Pull & { age: string })[] | null,
 * }} PresentedLane
 */

/**
 * The pull requests as the menu and the settings card are told of them.
 * @typedef {{
 *   settings: import('../lib/pulls.js').PullsSettings,
 *   hasToken: boolean,
 *   show: boolean,
 *   stale: boolean,
 *   fetchedAt: string | null,
 *   fetchedAgo: string,
 *   error: string | null,
 *   partial: string | null,
 *   lanes: PresentedLane[],
 * }} PullsState
 */

/**
 * Everything the menu and the settings card need in one answer. `show` is the whole decision for
 * the menu: no token or switched off means no column at all, not an empty one asking for a token.
 * @returns {Promise<PullsState>}
 */
export async function pullsState() {
  const [settings, config, cache] = await Promise.all([readPullsSettings(), readConfig(), readPullsCache()]);
  const hasToken = hasUsableToken(config);
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

export async function schedulePulls() {
  if (!api.alarms) return;
  try {
    const settings = await readPullsSettings();
    const config = await readConfig();
    if (settings.enabled === 1 && hasUsableToken(config)) {
      const existing = await api.alarms.get(PULLS_ALARM);
      if (!existing) await api.alarms.create(PULLS_ALARM, { periodInMinutes: PULLS_EVERY_MINUTES });
    } else {
      await api.alarms.clear(PULLS_ALARM);
    }
  } catch {
    /* no alarm means no badge until the menu asks; the menu still works */
  }
}

