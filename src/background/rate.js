import { api } from '../lib/links.js';
import { ANONYMOUS, noteRate, presentRate, readRate, scopeOf } from '../lib/rate.js';
import { readConfig } from './config.js';
import { RATE_KEY } from './keys.js';

/**
 * What is left of GitHub's budgets. Every answer from GitHub says, in its headers, how much of the
 * allowance for the budget it was charged to remains and when that allowance comes back — so the
 * budgets are read off the answers here, in the one place every request passes, rather than in
 * each of the modules that ask, and the gauge in the corner of the menu costs no request of its
 * own. GitHub meters by user, not by token, so readings are kept by the login a token belongs to,
 * and requests made with no token under a name of their own. The table is written to storage.local
 * so a menu that is up can follow it as its own requests land, and so it survives the background
 * being stopped. The modules that ask GitHub call the global fetch, and this is that fetch.
 *
 * Importing this module is what puts it in place, so it must be imported before anything asks.
 * @type {Map<string, string>}
 */
const rateScopes = new Map();
/** @type {import('../lib/rate.js').RateTable} */
let rateTable = {};
const rateReady = api.storage.local
  .get(RATE_KEY)
  .then((stored) => {
    const table = stored[RATE_KEY];
    rateTable = table && typeof table === 'object' ? table : {};
  })
  .catch(() => {});
/** @type {ReturnType<typeof setTimeout> | null} */
let rateWrite = null;

/**
 * Called as each token is opened, so its requests are metered under the login it belongs to.
 * @param {string} secret
 * @param {{ login?: string | null, id?: string }} entry
 */
export function rememberScope(secret, entry) {
  rateScopes.set(secret, scopeOf(entry));
}

/** The table emptied, once the last token is gone and its readings with it. */
export function forgetRates() {
  rateTable = {};
}

/** @param {RequestInit | undefined} init */
function rateScopeOf(init) {
  const auth = new Headers(init?.headers ?? {}).get('authorization') ?? '';
  const secret = auth.replace(/^(bearer|token)\s+/i, '').trim();
  return (secret && rateScopes.get(secret)) || ANONYMOUS;
}

/**
 * @param {RequestInfo | URL} input
 * @param {RequestInit | undefined} init
 * @param {Response} response
 */
async function noteAnswer(input, init, response) {
  let host = '';
  try {
    host = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url).host;
  } catch {
    return;
  }
  if (host !== 'api.github.com') return;
  const reading = readRate(response.headers);
  if (!reading) return;
  const scope = rateScopeOf(init);
  await rateReady;
  const next = noteRate(rateTable, scope, reading);
  if (next === rateTable) return;
  rateTable = next;
  // Written a beat behind, so an index build's hundreds of answers are a few writes, not hundreds.
  if (!rateWrite) {
    rateWrite = setTimeout(() => {
      rateWrite = null;
      api.storage.local.set({ [RATE_KEY]: rateTable }).catch(() => {});
    }, 250);
  }
}

const nativeFetch = globalThis.fetch.bind(globalThis);
/** @type {typeof fetch} */
globalThis.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  noteAnswer(input, init, response).catch(() => {});
  return response;
};

/**
 * The budgets as the menu paints them: this profile's tokens by login, in their order, and the nameless requests after.
 * @returns {Promise<{ scopes: import('../lib/rate.js').RateScope[] }>}
 */
export async function rateState() {
  await rateReady;
  const config = await readConfig();
  return { scopes: presentRate(rateTable, config.tokens) };
}
