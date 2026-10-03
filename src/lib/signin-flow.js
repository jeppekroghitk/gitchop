import { api } from './links.js';
import { reaches } from './repos.js';
import { missingInstalls } from './signin.js';

/** @import { Answer } from '../background/messages.js' */
/** @import { SignInCode } from '../background/signin.js' */
/** @import { SyncState, TokenView } from '../background/config.js' */
/** @import { Installation } from './signin.js' */

/**
 * The sign-in as a page shows it, shared by the two pages that offer it: the Sign-in card in
 * Settings and the welcome. Each draws it its own way, and each drives the polls itself, one
 * message per interval, since a background may be stopped between two asks and the page is what
 * is open while the user approves. What they share is here: asking for access inside the click,
 * what a poll's answer does to the flow, the words for how a flow ended, and who gitchop reaches.
 */

/**
 * The flow on screen. `starting` is waiting on GitHub for a code; `code` is showing one, with
 * `status` saying whether the last poll got through; the rest are how a flow ended without a
 * sign-in, each with its own way on.
 * @typedef {{
 *   phase: 'starting' | 'code' | 'expired' | 'denied' | 'disabled' | 'error',
 *   code?: SignInCode,
 *   interval: number,
 *   status?: 'waiting' | 'network',
 *   error?: string | null,
 * }} Flow
 */

/**
 * What a poll's answer means for the page: still waiting, with the status line to show; signed in;
 * nothing under way any more, because another tab finished it or it was cancelled; or ended
 * without a sign-in, with the flow that says how.
 * @typedef {'waiting' | 'signed-in' | 'gone' | 'ended'} PollVerdict
 */

/**
 * The hosts, and on Firefox the consent to hold a token, in one request. Firefox is told apart by
 * runtime.getBrowserInfo, which only it has; `browser` is no tell, since current Chrome defines it
 * too. Chrome refuses the Firefox-only data_collection key by throwing on the spot rather than by
 * rejecting, which is why the call sits inside a try. A browser that cannot ask is let through:
 * the background checks the host permission again before asking GitHub for anything. Firefox
 * grants a prompt only inside the click that asked for it, so this is the first thing a click awaits.
 * @returns {Promise<boolean>}
 */
export async function requestAccess() {
  const origins = ['https://github.com/*', 'https://api.github.com/*'];
  const firefox = typeof api.runtime.getBrowserInfo === 'function';
  try {
    return await api.permissions.request(firefox ? { origins, data_collection: ['authenticationInfo'] } : { origins });
  } catch {
    return true;
  }
}

/**
 * The flow after one poll's answer, and what that answer means.
 * @param {Flow} flow
 * @param {Answer<'gitchop:signin:poll'>} reply
 * @returns {{ flow: Flow | null, verdict: PollVerdict }}
 */
export function afterPoll(flow, reply) {
  switch (reply.status) {
    case 'pending':
    case 'slow_down':
      return { flow: { ...flow, interval: reply.interval || flow.interval, status: 'waiting' }, verdict: 'waiting' };
    case 'network':
      return { flow: { ...flow, interval: reply.interval || flow.interval, status: 'network' }, verdict: 'waiting' };
    case 'done':
      return { flow: null, verdict: 'signed-in' };
    case 'none':
      return { flow: null, verdict: 'gone' };
    case 'disabled':
    case 'expired':
    case 'denied':
      return { flow: { phase: reply.status, interval: flow.interval }, verdict: 'ended' };
    default:
      return { flow: { phase: 'error', interval: flow.interval, error: reply.error ?? 'GitHub would not finish the sign-in.' }, verdict: 'ended' };
  }
}

/**
 * The flow when the background did not answer a poll: it is woken by the next message, so the
 * page asks again, saying meanwhile that GitHub is out of touch.
 * @param {Flow} flow
 * @returns {Flow}
 */
export function afterLostPoll(flow) {
  return { ...flow, status: 'network' };
}

/**
 * @param {string} iso
 * @param {number} [now]
 */
export function countdown(iso, now = Date.now()) {
  const left = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, '0');
  return `Code expires in ${minutes}:${seconds}`;
}

/**
 * @param {string} iso
 * @param {number} [now]
 */
export function minutesLeft(iso, now = Date.now()) {
  const minutes = Math.max(1, Math.round((Date.parse(iso) - now) / 60000));
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}

/** @param {Flow | null} current */
export function statusLine(current) {
  return current?.status === 'network' ? 'Lost touch with GitHub, still trying.' : 'Waiting for you to approve on GitHub…';
}

/**
 * What each way a flow can end says, what its button says, and for an error, the reason given:
 * GitHub's own words, or gitchop's, said under a plain line rather than in place of one.
 * @param {Flow | null} current
 * @returns {{ line: string, again: string, reason?: string }}
 */
export function ending(current) {
  switch (current?.phase) {
    case 'expired':
      return { line: 'The code ran out before it was approved.', again: 'Get a new code' };
    case 'denied':
      return { line: 'Sign-in was declined on GitHub.', again: 'Try again' };
    case 'disabled':
      return { line: 'GitHub has sign-in by code switched off for gitchop. Use a personal access token for now.', again: 'Try again' };
    default:
      return { line: 'Sign-in did not finish.', again: 'Try again', reason: current?.error ?? undefined };
  }
}

/** @param {Flow | null} current */
export function endedLine(current) {
  const { line, reason } = ending(current);
  return reason ? `${line} ${reason}` : line;
}

/** @param {SyncState | null} sync */
export function appEntry(sync) {
  return sync?.tokens.find((entry) => entry.kind === 'app') ?? null;
}

/**
 * The saved tokens made for chosen owners. A classic token is left out: it reaches every owner,
 * and is the token signing in is most worth replacing, so it is not counted as covering anyone.
 * @param {SyncState | null} sync
 */
export function fineGrained(sync) {
  return (sync?.tokens ?? []).filter((entry) => entry.kind !== 'app' && entry.kind !== 'classic');
}

/**
 * The owners worth having the app on: the account itself, the owners the links name, and those the
 * saved fine-grained tokens were made for, which signing in might replace.
 * @param {SyncState | null} sync
 * @param {TokenView} app
 * @param {string[]} linkOwners
 */
export function candidates(sync, app, linkOwners) {
  /** @type {string[]} */
  const owners = [];
  if (app.login) owners.push(app.login);
  owners.push(...linkOwners);
  for (const entry of fineGrained(sync)) {
    owners.push(...(entry.owners ?? []));
    if (entry.target) owners.push(entry.target);
  }
  return owners;
}

/**
 * Who gitchop reaches with the sign-in, once it is known where the app is installed: the installs,
 * the owners without it that a saved fine-grained token reaches anyway, and the rest, which see
 * public repositories only — or everything, through a classic token, when there is one.
 * @param {SyncState | null} sync
 * @param {TokenView} app
 * @param {string[]} linkOwners
 * @returns {{ installs: Installation[], covered: string[], uncovered: string[], classic: boolean, total: number, reached: number }}
 */
export function ownerReach(sync, app, linkOwners) {
  const installs = app.installations ?? [];
  const missing = missingInstalls(installs, candidates(sync, app, linkOwners));
  const tokens = fineGrained(sync);
  const covered = missing.filter((owner) => tokens.some((entry) => reaches(entry, owner)));
  const uncovered = missing.filter((owner) => !covered.includes(owner));
  const classic = (sync?.tokens ?? []).some((entry) => entry.kind === 'classic');
  return { installs, covered, uncovered, classic, total: installs.length + missing.length, reached: installs.length + covered.length };
}
