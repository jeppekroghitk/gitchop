import { DEFAULT_LINKS, PANEL_KEY, STORAGE_KEY as LINKS_KEY, api, isSafeUrl, sanitize, sanitizePanel, withIds } from '../lib/links.js';
import { createStore, findStores, readStore, writeStore } from '../lib/gist.js';
import { SETTINGS_KEY as PULLS_SETTINGS_KEY, sanitizeSettings as pullsSettings } from '../lib/pulls.js';
import { KEY as EFFECTS_KEY, sanitize as sanitizeEffects } from '../lib/effects.js';
import { SETTINGS_KEY as NEWS_SETTINGS_KEY, sanitizeSettings as newsSettings } from '../lib/news.js';
import { SETTINGS_KEY as CONTRIB_SETTINGS_KEY, sanitizeSettings as contribSettings } from '../lib/contributions.js';
import { now, readConfig, state, writeConfig } from './config.js';
import { loadTokens } from './tokens.js';

/**
 * The gist backup: storage.sync pushed out to it a beat after every change, and pulled back in on
 * the way into the browser. `inStep` is the snapshot last known to match the gist, so a pull
 * landing in storage.sync is recognised as such and not bounced straight back out as a push.
 */
const PUSH_DELAY = 1500;
const MAX_LINKS = 200;

/** @type {number | null} */
let pushTimer = null;
/** @type {string | null} */
let inStep = null;

/**
 * Only one of the tokens will hold the Gists permission, and a fine-grained token cannot be asked
 * what it can do. So try them, remember the one that worked, and start with it next time. A
 * sign-in comes next after that one: Gists is an account permission of the app's, granted on
 * signing in, with no installation needed, so it is the likeliest to hold it.
 * @template T
 * @param {(token: string) => Promise<T>} run
 * @returns {Promise<T>}
 */
async function withGistToken(run) {
  const config = await readConfig();
  const tokens = await loadTokens();
  if (tokens.length === 0) throw new Error(noTokenReason(config));

  const preferred = config.gistTokenId;
  /** @type {(entry: import('./tokens.js').OpenToken) => number} */
  const rank = (entry) => (entry.id === preferred ? 0 : entry.kind === 'app' ? 1 : 2);
  const ordered = [...tokens].sort((a, b) => rank(a) - rank(b));

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
 * Why there is no token to use: none saved, or only a sign-in GitHub has stopped accepting, which
 * the user fixes in a different way.
 * @param {import('./config.js').Config} config
 */
function noTokenReason(config) {
  if (config.tokens.some((entry) => entry.needsSignIn)) return 'Sign in to GitHub again under Settings → Sign-in.';
  return 'Sign in or add a token first.';
}

/** @param {unknown} raw */
function sanitizeLinks(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((link) => link && typeof link === 'object')
    .map(sanitize)
    .filter((link) => isSafeUrl(link.url))
    .slice(0, MAX_LINKS);
}

/**
 * What the gist holds: every key in storage.sync, each read through the feature that owns it. The
 * gist is the one input gitchop does not author — a secret gist is unlisted rather than private,
 * and an id can be adopted from anywhere — so what comes back is a stranger's until sanitized: a
 * link that is not http(s) is dropped rather than stored, the list is capped, a switch is on or
 * off, a slider of the chop's is a whole number on its own scale, a repository is a well-formed
 * name. The same functions read the local copy, so the two compare as equals when they are.
 * @type {Record<string, (raw: unknown) => unknown>}
 */
const BACKED_UP = {
  [LINKS_KEY]: sanitizeLinks,
  [PANEL_KEY]: sanitizePanel,
  [PULLS_SETTINGS_KEY]: pullsSettings,
  [NEWS_SETTINGS_KEY]: newsSettings,
  [CONTRIB_SETTINGS_KEY]: contribSettings,
  [EFFECTS_KEY]: sanitizeEffects,
};

/**
 * The local copy as the gist would hold it, keys in one fixed order so two snapshots compare as text.
 * @returns {Promise<Record<string, any>>}
 */
async function loadBackup() {
  const stored = await api.storage.sync.get(Object.keys(BACKED_UP));
  /** @type {Record<string, unknown>} */
  const backup = {};
  for (const [key, clean] of Object.entries(BACKED_UP)) backup[key] = clean(stored[key]);
  return backup;
}

/**
 * Writes the remote copy locally without the change bouncing straight back as a push. Only the keys
 * the remote carries are written — a gist from before the settings joined the links has only links,
 * and the settings here are left as they are — and only the keys the table knows, whatever else the
 * file says. What lands is the merged whole, remembered as the snapshot in step with the gist.
 * @param {Record<string, unknown>} remote
 * @returns {Promise<Record<string, any>>}
 */
async function applyRemote(remote) {
  /** @type {Record<string, unknown>} */
  const next = {};
  for (const [key, clean] of Object.entries(BACKED_UP)) {
    if (key in remote) next[key] = clean(remote[key]);
  }
  const merged = { ...(await loadBackup()), ...next };
  inStep = JSON.stringify(merged);
  await api.storage.sync.set(next);
  return merged;
}

/**
 * The gist as one flat object under storage keys, the links foremost, whatever shape the file had.
 * @param {import('../lib/gist.js').Store} store
 */
function flatten(store) {
  return { ...store.settings, [LINKS_KEY]: store.links };
}

/**
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ skipped?: boolean, changed?: boolean }>}
 */
export async function push({ force = false } = {}) {
  const config = await readConfig();
  if (config.tokens.length === 0 || !config.gistId) return { skipped: true };

  const backup = await loadBackup();
  const payload = JSON.stringify(backup);
  if (!force && payload === inStep) {
    await writeConfig({ dirty: false });
    return { changed: false };
  }

  try {
    const gistId = config.gistId;
    await withGistToken((token) => writeStore(token, gistId, backup));
  } catch (error) {
    await writeConfig({ lastError: String(error.message ?? error) });
    throw error;
  }
  inStep = payload;
  await writeConfig({ lastPushedAt: now(), dirty: false, lastError: null });
  return { changed: true };
}

/**
 * A gist written before the settings joined the links holds none. Once its links are in, the whole
 * is written back, so the next profile to pull gets the settings too — forced, because what is
 * local is exactly what was just applied and would otherwise count as already current.
 * @param {import('../lib/gist.js').Store} store
 */
function upgradeStore(store) {
  if (store.format < 2) push({ force: true }).catch(() => {});
}

/**
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ skipped?: boolean, pushedInstead?: boolean, changed?: boolean, count?: number }>}
 */
export async function pull({ force = false } = {}) {
  const config = await readConfig();
  if (config.tokens.length === 0 || !config.gistId) return { skipped: true };

  // Local edits that never made it out take priority over overwriting them.
  if (config.dirty && !force) {
    await push();
    return { pushedInstead: true };
  }

  let remote;
  try {
    const gistId = config.gistId;
    remote = await withGistToken((token) => readStore(token, gistId));
  } catch (error) {
    await writeConfig({ lastError: String(error.message ?? error) });
    throw error;
  }

  const before = JSON.stringify(await loadBackup());
  const applied = await applyRemote(flatten(remote));
  await writeConfig({ lastPulledAt: now(), lastError: null, dirty: false });
  upgradeStore(remote);
  return { changed: JSON.stringify(applied) !== before, count: applied[LINKS_KEY].length };
}

/**
 * The backups gitchop made before, in this account's gists, for turning backup on without a gist
 * id: whichever token can read the gists is asked.
 * @returns {Promise<{ found: import('../lib/gist.js').FoundStore[] }>}
 */
export async function findBackups() {
  return { found: await withGistToken((token) => findStores(token)) };
}

/** @param {{ gistId?: string }} request */
export async function connectGist({ gistId }) {
  const config = await readConfig();
  if (config.tokens.length === 0) throw new Error(noTokenReason(config));
  const wanted = String(gistId ?? '').trim();

  let id = wanted;
  /** @type {Record<string, any>} */
  let remote;
  /** @type {import('../lib/gist.js').Store | null} */
  let adopted = null;
  if (id) {
    adopted = await withGistToken((token) => readStore(token, id));
    remote = flatten(adopted);
  } else {
    remote = await loadBackup();
    if (remote[LINKS_KEY].length === 0) remote[LINKS_KEY] = withIds(DEFAULT_LINKS);
    id = (await withGistToken((token) => createStore(token, remote))).id;
  }

  await applyRemote(remote);
  await writeConfig({ gistId: id, lastPulledAt: now(), lastPushedAt: now(), dirty: false, lastError: null });
  if (adopted) upgradeStore(adopted);
  return state();
}

/** Stops backing up without touching the tokens, which private repository search still needs. */
export async function stopBackup() {
  await writeConfig({ gistId: null, gistTokenId: null, dirty: false, lastError: null });
  return state();
}

/**
 * The storage.onChanged half that belongs to the backup: mark the copy dirty and push a beat later.
 * @param {{ [key: string]: WebExt.StorageChange }} changes
 * @param {WebExt.AreaName} area
 */
export function noteBackedUpChange(changes, area) {
  // Any key the gist holds: a link edited, a switch flipped, a repository subscribed from the menu.
  // A pull landing reads back as the snapshot already in step, and is not bounced out again.
  if (area !== 'sync' || !Object.keys(BACKED_UP).some((key) => key in changes)) return;
  loadBackup()
    .then((backup) => {
      if (JSON.stringify(backup) === inStep) return;
      writeConfig({ dirty: true }).catch(() => {});
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => push().catch(() => {}), PUSH_DELAY);
    })
    .catch(() => {});
}
