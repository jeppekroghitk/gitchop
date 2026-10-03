import { api } from '../lib/links.js';
import { WELCOME_PAGE, opensWelcome, showsMenuHint } from '../lib/welcome.js';
import { readConfig } from './config.js';
import { HINT_KEY, WELCOMED_KEY } from './keys.js';

/** @import { WelcomeFacts } from '../lib/welcome.js' */

/**
 * Where the welcome is opened from: a new tab on install, the toolbar button until the user has
 * signed in or put the welcome aside, and the menu's quiet sign-in row, which cannot open an
 * extension page itself from a content script in every browser. tabs.create needs no permission
 * in either browser when it only opens a page and reads nothing back.
 */

/** @returns {Promise<WelcomeFacts>} */
export async function welcomeFacts() {
  const [config, stored] = await Promise.all([readConfig(), api.storage.local.get([WELCOMED_KEY, HINT_KEY])]);
  return {
    tokens: config.tokens.length,
    welcomed: stored[WELCOMED_KEY] === true,
    hintDismissed: stored[HINT_KEY] === true,
  };
}

/**
 * What the menu is told: whether to end in the sign-in row.
 * @returns {Promise<{ hint: boolean }>}
 */
export async function welcomeState() {
  return { hint: showsMenuHint(await welcomeFacts()) };
}

/** @returns {Promise<{}>} */
export async function openWelcome() {
  await api.tabs.create({ url: api.runtime.getURL(WELCOME_PAGE) });
  return {};
}

/** @returns {Promise<{}>} */
export async function markWelcomed() {
  await api.storage.local.set({ [WELCOMED_KEY]: true });
  return {};
}

/** @returns {Promise<{}>} */
export async function dismissMenuHint() {
  await api.storage.local.set({ [HINT_KEY]: true });
  return {};
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
