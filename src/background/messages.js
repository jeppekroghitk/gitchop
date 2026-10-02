import { PANEL_KEY, api, loadLinks, sanitizePanel } from '../lib/links.js';
import { REPO_LIMIT, findRepos, matchIndex, ownersFromLinks } from '../lib/repos.js';
import { SETTINGS_KEY as PULLS_SETTINGS_KEY, sanitizeSettings as pullsSettings } from '../lib/pulls.js';
import { SETTINGS_KEY as CONTRIB_SETTINGS_KEY, sanitizeSettings as contribSettings } from '../lib/contributions.js';
import { paintAction } from './action.js';
import { state } from './config.js';
import { contributionsState, readContribSettings, refreshContributions } from './contributions.js';
import { INDEX_KEY } from './keys.js';
import { newsState, readNewsSettings, refreshNews, scheduleNews, subscribeNews, writeNewsSettings } from './news.js';
import { panelState, readPanel } from './panel.js';
import { pullsState, refreshPulls, schedulePulls } from './pulls.js';
import { readPullsSettings } from './pulls-store.js';
import { rateState } from './rate.js';
import { buildIndex, indexState, readIndex } from './repo-index.js';
import { connectGist, pull, push, stopBackup } from './sync.js';
import { addToken, loadTokens, removeToken } from './tokens.js';

/** Every message the menu and the settings page send, by type, each answering with an object. */
const HANDLERS = {
  'gitchop:options': async () => {
    await api.runtime.openOptionsPage();
    return {};
  },
  /** Instant, from the local index. No network, so the menu can call it on every settle. */
  'gitchop:repos:mine': async (message) => {
    const index = await readIndex();
    return { results: matchIndex(index.repos, message.query, REPO_LIMIT) };
  },
  'gitchop:repos': async (message) => {
    const [first] = await loadTokens();
    const owners = ownersFromLinks(await loadLinks());
    return { results: await findRepos(message.query, first?.secret, owners, REPO_LIMIT), owners };
  },
  'gitchop:index:state': async () => indexState(await readIndex()),
  /** Instant: the snapshot as it stands, and whether it is worth asking for a fresh one. */
  'gitchop:pulls': () => pullsState(),
  /** Instant: what is left of GitHub's budgets, as the last answers said. */
  'gitchop:rate': () => rateState(),
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
    // The switch, the hour and the span only; the list has its own two messages.
    const settings = await readNewsSettings();
    await writeNewsSettings({ ...settings, ...(message.patch ?? {}), repos: settings.repos });
    await scheduleNews();
    // A new span is a new edition; start on it now, so the menu's next open finds it made up
    // rather than skeletons.
    if ((await readNewsSettings()).days !== settings.days) refreshNews().catch(() => {});
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

/**
 * The runtime.onMessage listener. A message this does not know is left for someone else to answer;
 * one it does is answered asynchronously, which is what returning true tells the browser.
 */
export function answer(message, sender, respond) {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message))
    .then((result) => respond({ ok: true, ...result }))
    .catch((error) => respond({ ok: false, error: String(error.message ?? error) }));
  return true;
}
