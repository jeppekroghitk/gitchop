import { api } from '../lib/links.js';
import { SETTINGS_KEY as PULLS_SETTINGS_KEY, sanitizeSettings as pullsSettings } from '../lib/pulls.js';
import { PULLS_CACHE_KEY } from './keys.js';

/**
 * The pull requests as last fetched. `lanes` is null until a refresh has landed; a refresh that
 * failed keeps the last good lanes and says why in `error`, and one where only some tokens
 * answered says why in `partial`. `drafts` is the switch the lanes were fetched under.
 * @typedef {{
 *   lanes: import('../lib/pulls.js').Lanes | null,
 *   fetchedAt: string | null,
 *   drafts?: number,
 *   error: string | null,
 *   failedAt: string | null,
 *   partial?: string | null,
 * }} PullsCache
 */

/**
 * The pull request switches and snapshot as they stand in storage, on their own beneath both the
 * pull requests and the toolbar icon: a refresh repaints the icon, and the icon reads the snapshot,
 * so neither of those two can be the one that holds these.
 */

/** @returns {Promise<import('../lib/pulls.js').PullsSettings>} */
export async function readPullsSettings() {
  try {
    const stored = await api.storage.sync.get(PULLS_SETTINGS_KEY);
    return pullsSettings(stored[PULLS_SETTINGS_KEY]);
  } catch {
    return pullsSettings();
  }
}

/** @returns {Promise<PullsCache | null>} */
export async function readPullsCache() {
  const stored = await api.storage.local.get(PULLS_CACHE_KEY);
  return stored[PULLS_CACHE_KEY] ?? null;
}
