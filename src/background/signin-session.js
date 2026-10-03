import { api } from '../lib/links.js';
import { SIGNIN_KEY } from './keys.js';

/**
 * The code a sign-in is waiting on, kept where a stopped background finds it again and nowhere
 * else. storage.session lives in memory, is gone when the browser closes, and is not readable by
 * content scripts (Chrome's default access level is trusted contexts only), which is right for a
 * device code: whoever holds one while it is live can be handed the user's token by GitHub. It is
 * there from Firefox 115 and Chrome 102, both below gitchop's minimums; the fallback below is for
 * a browser that has it switched off, and lasts as long as the background does.
 *
 * This is its own module, below both the token store and the sign-in, so removing the sign-in
 * token can clear a flow in progress without the two importing each other.
 */

export const SIGNIN_ALARM = 'gitchop-signin';

/**
 * The flow in progress. `expiresAt` and `nextPollAt` are epoch milliseconds; `interval` is seconds.
 * `replaceId` is the sign-in this one replaces, so a second sign-in keeps the first one's id and
 * whatever was remembered against it.
 * @typedef {{
 *   deviceCode: string,
 *   userCode: string,
 *   verificationUri: string,
 *   expiresAt: number,
 *   interval: number,
 *   nextPollAt: number,
 *   replaceId: string | null,
 * }} SignInSession
 */

/** @type {SignInSession | null} */
let fallback = null;

/** @returns {Promise<SignInSession | null>} */
export async function readSession() {
  const area = api.storage.session;
  if (!area) return fallback;
  const stored = await area.get(SIGNIN_KEY);
  const session = stored[SIGNIN_KEY];
  return session && typeof session === 'object' && typeof session.deviceCode === 'string' ? session : null;
}

/** @param {SignInSession} session */
export async function writeSession(session) {
  const area = api.storage.session;
  if (!area) {
    fallback = session;
    return;
  }
  await area.set({ [SIGNIN_KEY]: session });
}

/**
 * Counts the flows the user called off. A poll or a start reads the session, waits on GitHub, and
 * then writes; a Cancel or a Sign out that came in while it waited must win, or the poll would
 * bring a cancelled code back, or keep a sign-in the user had just said no to. Each compares the
 * count it started with right before it writes, with nothing awaited in between, so a Cancel lands
 * either before the check or after the write was sent, and its own removal then comes last.
 */
let generation = 0;

/** The count a write that started now must still find, to go ahead. */
export function sessionGeneration() {
  return generation;
}

/** Calls the flow off: forgets it, and makes any poll or start still waiting on GitHub drop its answer. */
export function endSignIn() {
  generation += 1;
  return clearSignIn();
}

/** Forgets the flow in progress, and the alarm that would have asked about it with the tab closed. */
export async function clearSignIn() {
  fallback = null;
  await api.storage.session?.remove(SIGNIN_KEY).catch(() => {});
  try {
    await api.alarms?.clear(SIGNIN_ALARM);
  } catch {
    /* an alarm that cannot be cleared finds no session when it fires, and clears itself then */
  }
}
