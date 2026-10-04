import { api } from '../lib/links.js';
import { identify } from '../lib/gist.js';
import { INSTALL_URL, installUrlFor, listInstallations, pollToken, requestCode } from '../lib/signin.js';
import { seal } from '../lib/vault.js';
import { forgetRenewal, noteAppSecret } from './app-token.js';
import { ensureVaultKey, newId, readConfig, state, updateConfig } from './config.js';
import { INSTALL_TAB_KEY } from './keys.js';
import { rememberScope } from './rate.js';
import { SIGNIN_ALARM, clearSignIn, endSignIn, readSession, sessionGeneration, writeSession } from './signin-session.js';
import { loadTokens, updateTokens } from './tokens.js';

/** @import { SyncState, TokenEntry } from './config.js' */
/** @import { PollStatus } from '../lib/signin.js' */
/** @import { SignInSession } from './signin-session.js' */

export { SIGNIN_ALARM };

/**
 * Signing in, by GitHub's device flow, driven from the settings page. The page asks for a code on a
 * click and shows it; the user approves it on github.com; the page then asks here once per interval
 * whether GitHub has seen that yet. Each ask is a message, so a stopped background loses nothing:
 * it wakes for the message and finds the code in storage.session. An alarm asks once a minute as
 * well, so a flow finishes when the tab was closed before approving.
 *
 * The device code never leaves the background. With it, GitHub hands out the token, so the page is
 * shown only the code the user types, which is useless without the device code beside it.
 */

/**
 * The code as the page shows it: what to type, where, and until when.
 * @typedef {{ userCode: string, verificationUri: string, expiresAt: string, interval: number }} SignInCode
 */

/**
 * One poll's answer. `network` is GitHub out of reach, which is not the end of the code; `none` is
 * no flow under way here, because another tab finished it or it was cancelled. `state` comes with
 * the answers that change what the token card shows. `early` marks a `pending` that GitHub was not
 * asked for, because its interval had not run yet, so it says nothing about whether the user has
 * approved.
 * @typedef {{ status: PollStatus | 'network' | 'none', interval: number, error: string | null, state: SyncState | null, early?: boolean }} SignInPoll
 */

/** A code is handed back rather than replaced while it has at least this long left. */
const STILL_LIVE = 30 * 1000;

/**
 * @param {SignInSession} session
 * @returns {SignInCode}
 */
function view(session) {
  return {
    userCode: session.userCode,
    verificationUri: session.verificationUri,
    expiresAt: new Date(session.expiresAt).toISOString(),
    interval: session.interval,
  };
}

/** @type {Promise<SignInCode> | null} */
let starting = null;

/**
 * A code to show. A code still live is handed back instead of asking GitHub for another — a reload,
 * a second tab and a double click all land here — because the app may hand out 50 codes an hour
 * and that allowance is shared by everyone using gitchop. Only ever on a click, for the same reason.
 * @returns {Promise<SignInCode>}
 */
export function startSignIn() {
  if (starting) return starting;
  starting = (async () => {
    const generation = sessionGeneration();
    const at = Date.now();
    const live = await readSession();
    if (live && live.expiresAt > at + STILL_LIVE) return view(live);

    // The token endpoint answers only a request the host permission exempts from CORS.
    const allowed = await api.permissions.contains({ origins: ['https://github.com/*'] }).catch(() => true);
    if (!allowed) throw new Error('gitchop needs access to github.com to sign in. Grant it above.');

    const code = await requestCode(at);
    const config = await readConfig();
    const replaceId = config.tokens.find((entry) => entry.kind === 'app')?.id ?? null;
    /** @type {SignInSession} */
    const session = { ...code, nextPollAt: at + code.interval * 1000, replaceId };
    // Cancelled while GitHub was handing the code over: the code is never shown, and expires unused.
    if (sessionGeneration() !== generation) throw new Error('The sign-in was cancelled.');
    await writeSession(session);
    try {
      await api.alarms?.create(SIGNIN_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
    } catch {
      /* without the alarm, the flow finishes only while the page is open to drive it */
    }
    return view(session);
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/**
 * The code a reload or another tab left showing, if it is still live.
 * @returns {Promise<{ code: SignInCode | null }>}
 */
export async function pendingSignIn() {
  const session = await readSession();
  if (!session) return { code: null };
  if (session.expiresAt <= Date.now()) {
    await clearSignIn();
    return { code: null };
  }
  return { code: view(session) };
}

/** @returns {Promise<{}>} */
export async function cancelSignIn() {
  await endSignIn();
  return {};
}

/** @type {Promise<SignInPoll> | null} */
let polling = null;

/**
 * Asks GitHub once whether the code was approved, never sooner than the interval GitHub set: a
 * second tab and the alarm ask too, and asking early is what earns a slow_down. One poll at a time,
 * so two asks at once cannot both spend the code.
 * @returns {Promise<SignInPoll>}
 */
export function pollSignIn() {
  if (polling) return polling;
  polling = poll().finally(() => {
    polling = null;
  });
  return polling;
}

/** @returns {Promise<SignInPoll>} */
async function poll() {
  const generation = sessionGeneration();
  const session = await readSession();
  if (!session) {
    // The alarm outlived its flow, or a tab polled after another finished it.
    await clearSignIn();
    return { status: 'none', interval: 0, error: null, state: await state() };
  }
  const at = Date.now();
  if (at >= session.expiresAt) {
    await clearSignIn();
    return { status: 'expired', interval: session.interval, error: null, state: null };
  }
  if (at < session.nextPollAt) return { status: 'pending', interval: session.interval, error: null, state: null, early: true };

  /** @type {import('../lib/signin.js').PollOutcome} */
  let outcome;
  try {
    outcome = await pollToken(session.deviceCode, session.interval, at);
  } catch (error) {
    if (sessionGeneration() !== generation) return called();
    await writeSession({ ...session, nextPollAt: at + session.interval * 1000 });
    return { status: 'network', interval: session.interval, error: String(error.message ?? error), state: null };
  }

  // Cancelled, or signed out, while GitHub was answering: whatever it said, a code the user has
  // called off is not written back, and an approval of it is not kept.
  if (sessionGeneration() !== generation) return called();
  if (outcome.status === 'pending' || outcome.status === 'slow_down') {
    const interval = outcome.interval ?? session.interval;
    await writeSession({ ...session, interval, nextPollAt: at + interval * 1000 });
    return { status: outcome.status, interval, error: null, state: null };
  }
  if (outcome.status !== 'done' || !outcome.pair) {
    await clearSignIn();
    return { status: outcome.status, interval: session.interval, error: outcome.error ?? null, state: null };
  }

  // Not kept: called off meanwhile, and the session there now, if any, is a new flow's.
  if (!(await keepSignIn(outcome.pair, session.replaceId, generation))) return called();
  await clearSignIn();
  await leaveDevicePage(session);
  return { status: 'done', interval: session.interval, error: null, state: await state() };
}

/**
 * Opens GitHub's device page for the flow under way, from the tab that asked, and remembers the tab
 * so a finished sign-in can close it: GitHub's page ends on a "you're all set" the user would
 * otherwise have to close by hand. Opening a tab and later closing the one opened needs no
 * permission in either browser.
 * @param {number | undefined} openerTabId
 * @returns {Promise<{ opened: boolean }>}
 */
export async function openDevicePage(openerTabId) {
  const session = await readSession();
  if (!session) return { opened: false };
  const url = session.verificationUri;
  const tab = /** @type {WebExt.Tab | undefined} */ (await api.tabs.create(openerTabId === undefined ? { url } : { url, openerTabId }));
  const latest = await readSession();
  if (latest && latest.deviceCode === session.deviceCode) {
    await writeSession({ ...latest, deviceTabId: tab?.id, openerTabId });
  }
  return { opened: true };
}

/**
 * Back to where the sign-in started: that tab to the front, and GitHub's device page closed. Either
 * may be gone already — the user closed it, or never opened it through gitchop — which is fine.
 * @param {SignInSession} session
 */
async function leaveDevicePage(session) {
  if (session.deviceTabId === undefined) return;
  if (session.openerTabId !== undefined) await api.tabs.update(session.openerTabId, { active: true }).catch(() => {});
  await api.tabs.remove(session.deviceTabId).catch(() => {});
}

/** @returns {Promise<SignInPoll>} */
async function called() {
  return { status: 'none', interval: 0, error: null, state: await state() };
}

/**
 * Stores the new sign-in, then learns who it is and where the app is installed. Stored first: the
 * pair is the user's sign-in from GitHub's answer on, and a background stopped while asking /user
 * should not lose it. A sign-in that replaces another takes its place and its id, so the gist and
 * the news, which remember a token by id, keep using it; a new one goes first in the list, which
 * is the tiebreak for which token is tried first.
 *
 * Kept only if the flow was not called off since `generation`, checked in the same turn of the
 * config queue as the write. Resolves to whether it was kept.
 * @param {import('../lib/signin.js').TokenPair} pair
 * @param {string | null} replaceId
 * @param {number} generation
 * @returns {Promise<boolean>}
 */
async function keepSignIn(pair, replaceId, generation) {
  const vaultKey = await ensureVaultKey();
  const sealed = await seal(pair.access, vaultKey);
  const sealedRefresh = pair.refresh ? await seal(pair.refresh, vaultKey) : undefined;
  /** @type {string} */
  let id = newId();
  let kept = false;
  await updateConfig((config) => {
    if (sessionGeneration() !== generation) return config;
    kept = true;
    // A renewal of the pair this replaces, still waiting to be written, would land on this one.
    forgetRenewal();
    const existing = config.tokens.find((entry) => entry.id === replaceId) ?? config.tokens.find((entry) => entry.kind === 'app');
    if (existing) id = existing.id;
    /** @type {TokenEntry} */
    const entry = {
      id,
      kind: 'app',
      login: existing?.login ?? null,
      scopes: [],
      owners: existing?.owners ?? null,
      target: null,
      expiresAt: pair.expiresAt,
      sealed,
      ...(sealedRefresh ? { sealedRefresh } : {}),
      refreshExpiresAt: pair.refresh ? pair.refreshExpiresAt : null,
      installations: existing?.installations ?? null,
      needsSignIn: false,
      signInError: null,
    };
    const tokens = existing ? config.tokens.map((candidate) => (candidate === existing ? entry : candidate)) : [entry, ...config.tokens];
    return { ...config, vaultKey: config.vaultKey ?? vaultKey, tokens };
  });
  if (!kept) return false;
  noteAppSecret(pair.access);

  const who = await identify(pair.access).catch(() => null);
  const installations = await listInstallations(pair.access).catch(() => null);
  rememberScope(pair.access, { id, login: who?.login ?? null });
  await updateTokens((list) =>
    list.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            login: who?.login ?? entry.login,
            ...(installations ? { installations, owners: installations.map((install) => install.owner) } : {}),
          }
        : entry,
    ),
  );
  return true;
}

/**
 * In memory where storage.session is switched off, for as long as the background lasts.
 * @type {{ tabId?: number, openerTabId?: number } | null}
 */
let installTabFallback = null;

/**
 * Opens GitHub's page for installing the app, from the tab that asked, and remembers both tabs:
 * GitHub ends an install on the installation's settings, which the user would otherwise have to
 * leave by hand to get back.
 * For the user's own account it goes straight to that account's page, which GitHub addresses by
 * numeric id, so adding it there is one confirmation; anything that keeps the id out of reach
 * falls back to the page that lists the accounts to choose from.
 * @param {number | undefined} openerTabId
 * @param {boolean} [own]
 * @returns {Promise<{ opened: boolean }>}
 */
export async function openInstallPage(openerTabId, own = false) {
  let url = INSTALL_URL;
  if (own) url = (await ownInstallUrl().catch(() => null)) ?? INSTALL_URL;
  const tab = /** @type {WebExt.Tab | undefined} */ (await api.tabs.create(openerTabId === undefined ? { url } : { url, openerTabId }));
  const record = { tabId: tab?.id, openerTabId };
  if (api.storage.session) await api.storage.session.set({ [INSTALL_TAB_KEY]: record });
  else installTabFallback = record;
  return { opened: true };
}

/**
 * The install page for the signed-in user's own account, or null without a working sign-in.
 * @returns {Promise<string | null>}
 */
async function ownInstallUrl() {
  const app = (await loadTokens()).find((entry) => entry.kind === 'app' && !entry.needsSignIn);
  if (!app) return null;
  const response = await fetch('https://api.github.com/user', {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${app.secret}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) return null;
  const { id } = await response.json();
  return Number.isInteger(id) ? installUrlFor(id) : null;
}

/**
 * The content script, on the page GitHub ends an install on, says so. Only the tab gitchop opened
 * for it is acted on: the installations are asked again, the tab the user came from comes back to
 * the front, and the install page is closed. Any other visit to that page is left alone.
 * @param {number | undefined} tabId
 * @returns {Promise<{ closed: boolean }>}
 */
export async function installLanded(tabId) {
  const stored = api.storage.session ? (await api.storage.session.get(INSTALL_TAB_KEY))[INSTALL_TAB_KEY] : installTabFallback;
  if (!stored || tabId === undefined || stored.tabId !== tabId) return { closed: false };
  if (api.storage.session) await api.storage.session.remove(INSTALL_TAB_KEY);
  else installTabFallback = null;
  await refreshInstallations().catch(() => {});
  if (stored.openerTabId !== undefined) await api.tabs.update(stored.openerTabId, { active: true }).catch(() => {});
  await api.tabs.remove(tabId).catch(() => {});
  return { closed: true };
}

/**
 * Asks again where the app is installed: Settings does on opening, and on Check again after the
 * user has installed it somewhere. A token rejected on the way is renewed and asked again, by the
 * fetch beneath.
 * @returns {Promise<SyncState>}
 */
export async function refreshInstallations() {
  const app = (await loadTokens()).find((entry) => entry.kind === 'app');
  if (!app) return state();
  const installations = await listInstallations(app.secret);
  await updateTokens((list) =>
    list.map((entry) => (entry.id === app.id ? { ...entry, installations, owners: installations.map((install) => install.owner) } : entry)),
  );
  return state();
}
