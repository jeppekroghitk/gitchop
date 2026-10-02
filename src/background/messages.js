import { PANEL_KEY, api, loadLinks, sanitizePanel } from '../lib/links.js';
import { REPO_LIMIT, findRepos, matchIndex, ownersFromLinks, pickSearchToken } from '../lib/repos.js';
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
import { cancelSignIn, pendingSignIn, pollSignIn, refreshInstallations, startSignIn } from './signin.js';
import { connectGist, pull, push, stopBackup } from './sync.js';
import { addToken, loadTokens, removeToken } from './tokens.js';

/** @import { Repo } from '../lib/repos.js' */
/** @import { SyncState } from './config.js' */
/** @import { SignInCode, SignInPoll } from './signin.js' */

/**
 * Every message the menu and the settings page send, by type, each answering with an object. This
 * table is the protocol: what a handler reads off its message, as its @param says, is what a
 * message of that type carries, and what it answers is the reply — see Message and Reply below.
 * Every answer is a declared type rather than one inferred from an object literal: a literal's
 * type in a JavaScript file stays open, so a reply field misspelled by the sender would read as
 * fine instead of as an error.
 */
const HANDLERS = {
  'gitchop:options': async () => {
    await api.runtime.openOptionsPage();
    return {};
  },
  /**
   * Instant, from the local index. No network, so the menu can call it on every settle.
   * @param {{ query: string }} message
   * @returns {Promise<{ results: Repo[] }>}
   */
  'gitchop:repos:mine': async (message) => {
    const index = await readIndex();
    return { results: matchIndex(index.repos, message.query, REPO_LIMIT) };
  },
  /**
   * @param {{ query: string }} message
   * @returns {Promise<{ results: Repo[], owners: string[] }>}
   */
  'gitchop:repos': async (message) => {
    // One token per search, chosen for what it asks: the widest reach into the owner it names, or
    // the widest reach overall for a bare word. Whatever was saved first would do for neither once a
    // sign-in that reaches two organisations sits beside a classic token that reaches all of them.
    const token = pickSearchToken(await loadTokens(), message.query);
    const owners = ownersFromLinks(await loadLinks());
    return { results: await findRepos(message.query, token?.secret, owners, REPO_LIMIT), owners };
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
  /** @param {{ patch?: Partial<import('../lib/pulls.js').PullsSettings> }} message */
  'gitchop:pulls:settings': async (message) => {
    const settings = pullsSettings({ ...(await readPullsSettings()), ...(message.patch ?? {}) });
    await api.storage.sync.set({ [PULLS_SETTINGS_KEY]: settings });
    await schedulePulls();
    await paintAction();
    return pullsState();
  },
  /** Instant: the edition as it stands, and whether it is worth asking for a fresh one. */
  'gitchop:news': () => newsState(),
  /**
   * Waits for GitHub. The menu calls it when the instant answer said stale; Settings forces it.
   * @param {{ force?: boolean }} message
   */
  'gitchop:news:refresh': async (message) => {
    await refreshNews({ force: Boolean(message.force) }).catch(() => {});
    return newsState();
  },
  /** @param {{ patch?: Partial<Omit<import('../lib/news.js').NewsSettings, 'repos'>> }} message */
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
  /** @param {{ repo: string }} message */
  'gitchop:news:subscribe': (message) => subscribeNews(message.repo, true),
  /** @param {{ repo: string }} message */
  'gitchop:news:unsubscribe': (message) => subscribeNews(message.repo, false),
  /** Instant: the year's count as it stands, and whether it is worth asking for a fresh one. */
  'gitchop:contributions': () => contributionsState(),
  /** Waits for GitHub. The menu calls it when the instant answer said stale; Settings on demand. */
  'gitchop:contributions:refresh': async () => {
    await refreshContributions().catch(() => {});
    return contributionsState();
  },
  /** @param {{ patch?: Partial<import('../lib/contributions.js').ContribSettings> }} message */
  'gitchop:contributions:settings': async (message) => {
    const settings = contribSettings({ ...(await readContribSettings()), ...(message.patch ?? {}) });
    await api.storage.sync.set({ [CONTRIB_SETTINGS_KEY]: settings });
    return contributionsState();
  },
  /** Instant: whether the panel rises with the menu. */
  'gitchop:panel': () => panelState(),
  /** @param {{ patch?: Partial<import('../lib/links.js').PanelSettings> }} message */
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
  /** @param {{ token: string, owner?: string }} message */
  'gitchop:token:save': (message) => addToken(message),
  /** @param {{ id: string }} message */
  'gitchop:token:remove': (message) => removeToken(message),
  /**
   * Click only: a code still live is handed back instead of asking GitHub for another.
   * @returns {Promise<SignInCode>}
   */
  'gitchop:signin:start': () => startSignIn(),
  /**
   * On page load: the code a reload or another tab left showing, if it is still live.
   * @returns {Promise<{ code: SignInCode | null }>}
   */
  'gitchop:signin:pending': () => pendingSignIn(),
  /**
   * One poll, never sooner than GitHub's interval.
   * @returns {Promise<SignInPoll>}
   */
  'gitchop:signin:poll': () => pollSignIn(),
  /** @returns {Promise<{}>} */
  'gitchop:signin:cancel': () => cancelSignIn(),
  /**
   * Where the app is installed; asked when Settings opens with a sign-in saved.
   * @returns {Promise<SyncState>}
   */
  'gitchop:signin:installations': () => refreshInstallations(),
  /** @param {{ gistId?: string }} message */
  'gitchop:sync:connect': (message) => connectGist(message),
  'gitchop:sync:stop': () => stopBackup(),
  /** @param {{ force?: boolean }} message */
  'gitchop:sync:pull': async (message) => ({ ...(await pull({ force: message.force })), ...(await state()) }),
  /** @param {{ force?: boolean }} message */
  'gitchop:sync:push': async (message) => ({ ...(await push({ force: message.force })), ...(await state()) }),
};

/** @typedef {typeof HANDLERS} Handlers */

/** @typedef {keyof Handlers} MessageType */

/**
 * What a handler reads off its message, besides the type: its first parameter, or nothing.
 * @template {MessageType} T
 * @typedef {Parameters<Handlers[T]> extends [infer Fields, ...unknown[]] ? Fields : {}} Fields
 */

/**
 * A message of one type: the type, and whatever its handler reads off it. Distributed over a
 * union of types, each type is paired with its own fields, so a message whose type is one of
 * several must carry the fields of whichever one it turns out to be.
 * @template {MessageType} T
 * @typedef {T extends MessageType ? { type: T } & Fields<T> : never} Message
 */

/**
 * What the background answers a message of one type with: its handler's answer, or the sentence
 * that says why there is none.
 * @template {MessageType} T
 * @typedef {Answer<T> | { ok: false, error: string }} Reply
 */

/**
 * The answer when there is one.
 * @template {MessageType} T
 * @typedef {{ ok: true } & Awaited<ReturnType<Handlers[T]>>} Answer
 */

/**
 * The runtime.onMessage listener. A message this does not know is left for someone else to answer;
 * one it does is answered asynchronously, which is what returning true tells the browser. Only
 * the table's own keys count: a type that merely names something every object inherits, such as
 * `constructor`, is not one of them.
 * @param {unknown} message
 * @param {WebExt.MessageSender} sender
 * @param {(reply: Reply<MessageType>) => void} respond
 * @returns {boolean}
 */
export function answer(message, sender, respond) {
  const type = /** @type {{ type?: unknown } | null | undefined} */ (message)?.type;
  if (typeof type !== 'string' || !Object.hasOwn(HANDLERS, type)) return false;
  /** @type {(message: any) => object | Promise<object>} */
  const handler = HANDLERS[/** @type {MessageType} */ (type)];
  Promise.resolve(handler(message))
    .then((result) => respond({ ok: true, ...result }))
    .catch((error) => respond({ ok: false, error: String(error.message ?? error) }));
  return true;
}
