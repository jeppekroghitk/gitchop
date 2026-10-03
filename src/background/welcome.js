import { api } from '../lib/links.js';
import { CONSENT_HASH, WELCOME_PAGE, opensWelcome, predatesWelcome, showsMenuHint } from '../lib/welcome.js';
import { readConfig } from './config.js';
import { HINT_KEY, WELCOMED_KEY } from './keys.js';

/** @import { WelcomeFacts } from '../lib/welcome.js' */

/**
 * Where the welcome is shown from. Nothing opens on install: the "." overlay shows it the first
 * time the key is pressed on GitHub, from what welcomeState says. Its page of its own opens from
 * the toolbar button until the user has signed in or put the welcome aside, and from the overlay,
 * at the browser's question alone, when signing in needs a prompt only an extension page can
 * show. tabs.create needs no permission in either browser when it only opens a page and reads
 * nothing back. What keeps the welcome away is a working sign-in or token, or the user saying no
 * to signing in; a sign-in that is removed or refused later brings it back, and a new sign-in
 * forgets an earlier no (see index.js), so that loss is not met by a decision made before it.
 */

/** @returns {Promise<WelcomeFacts>} */
export async function welcomeFacts() {
  const [config, stored] = await Promise.all([readConfig(), api.storage.local.get([WELCOMED_KEY, HINT_KEY])]);
  return {
    // Only tokens that still work: a sign-in GitHub has refused, or whose app was removed, is
    // no reason to keep the welcome away.
    tokens: config.tokens.filter((entry) => !entry.needsSignIn).length,
    welcomed: stored[WELCOMED_KEY] === true,
    hintDismissed: stored[HINT_KEY] === true,
  };
}

/**
 * What the content script is told: whether the next press shows the welcome in place of the
 * menu, and whether the menu ends in the sign-in row.
 * @returns {Promise<{ first: boolean, hint: boolean }>}
 */
export async function welcomeState() {
  const facts = await welcomeFacts();
  return { first: opensWelcome(facts), hint: showsMenuHint(facts) };
}

/**
 * The welcome's page. From the overlay it opens at the browser's question alone, as a child of
 * the GitHub tab that asked, so once it is answered the page can hand the user back to that tab,
 * where the sign-in carries on.
 * @param {{ at?: 'consent', openerTabId?: number }} [options]
 * @returns {Promise<{}>}
 */
export async function openWelcome({ at, openerTabId } = {}) {
  const url = api.runtime.getURL(WELCOME_PAGE) + (at === 'consent' ? CONSENT_HASH : '');
  await api.tabs.create(openerTabId === undefined ? { url } : { url, openerTabId });
  return {};
}

/** @returns {Promise<{}>} */
export async function markWelcomed() {
  await api.storage.local.set({ [WELCOMED_KEY]: true });
  return {};
}

/** A working sign-in or token arrived: an earlier no to signing in, and to the menu's row, no longer stands. */
export async function forgetWelcomeAnswers() {
  await api.storage.local.remove([WELCOMED_KEY, HINT_KEY]);
}

/** @returns {Promise<{}>} */
export async function dismissMenuHint() {
  await api.storage.local.set({ [HINT_KEY]: true });
  return {};
}

/**
 * Whether the overlay can sign in without a prompt: a content script cannot ask for permissions,
 * so the hosts — and on Firefox the consent to hold a token, which src/lib/signin-flow.js asks
 * for beside them — must be granted already. Otherwise the overlay hands the sign-in to the
 * welcome's page, where the click can ask. Firefox is told apart by runtime.getBrowserInfo, as
 * there. A Chrome that cannot answer is let through, since startSignIn checks the host again; a
 * Firefox that cannot is not, since nothing later checks the consent: the page asks, and if the
 * question cannot be answered there either, the page carries the sign-in out itself.
 * @returns {Promise<{ granted: boolean }>}
 */
export async function signInAccess() {
  const firefox = typeof api.runtime.getBrowserInfo === 'function';
  try {
    if (!(await api.permissions.contains({ origins: ['https://github.com/*', 'https://api.github.com/*'] }))) return { granted: false };
    if (!firefox) return { granted: true };
    return { granted: await api.permissions.contains({ data_collection: ['authenticationInfo'] }) };
  } catch {
    return { granted: !firefox };
  }
}

/**
 * Whoever updates from a version without the welcome is welcomed already: their next press stays
 * the menu they know. The sign-in row is left to show, the one new thing they see.
 * @param {string | undefined} previousVersion
 */
export async function welcomeOnUpdate(previousVersion) {
  if (predatesWelcome(previousVersion)) await markWelcomed();
}

/** The toolbar button: the welcome for someone who has not been through it, Settings otherwise. */
export async function openFromToolbar() {
  /** @type {WelcomeFacts | null} */
  let facts = null;
  try {
    facts = await welcomeFacts();
  } catch {
    /* storage out of reach: Settings, as before there was a welcome */
  }
  if (facts && opensWelcome(facts)) await openWelcome();
  else await api.runtime.openOptionsPage();
}
