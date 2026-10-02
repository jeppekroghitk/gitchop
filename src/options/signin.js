import { api, loadLinks } from '../lib/links.js';
import { ownersFromLinks, reaches } from '../lib/repos.js';
import { INSTALL_URL, REVOKE_URL, missingInstalls } from '../lib/signin.js';

/** @import { Answer, Message, MessageType } from '../background/messages.js' */
/** @import { SignInCode } from '../background/signin.js' */
/** @import { SyncState, TokenView } from '../background/config.js' */

/**
 * The sign-in block at the top of the token card. The card is redrawn from scratch whenever the
 * configuration in storage changes, and a renewal or another tab's sign-in changes it, so a code on
 * screen cannot live in the card's nodes: the flow lives here, in the module, and every drawing of
 * the block draws it from that. The block redraws itself when the flow changes phase, without
 * redrawing the card, which would wipe a token half typed into the form below. Within a phase — the
 * countdown, a poll's answer — it changes text in place instead, so a control the user has tabbed
 * to keeps its focus.
 *
 * What a screen reader is told goes through one live region in the page head, there since the page
 * loaded: a region drawn together with its text is generally not announced, and every node in the
 * block is drawn anew.
 *
 * The page drives the polling, one message per interval, because a background may be stopped
 * between two asks and the page is what is open while the user is approving.
 */

/**
 * What the card hands the block: how to ask the background, the card's own busy guard and status
 * corner, how to redraw the whole card from a fresh state, and how to open the token recipe for an
 * owner the app is not installed on.
 * @typedef {{
 *   ask: <T extends MessageType>(message: Message<T>) => Promise<Answer<T>>,
 *   guard: (node: HTMLElement, card: 'token', work: (flash: (text: string) => void) => Promise<void>) => Promise<void>,
 *   flash: (text: string) => void,
 *   rerender: (sync: SyncState) => void,
 *   openAdvanced: (owner?: string) => void,
 * }} Hooks
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

/** @type {Flow | null} */
let flow = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let pollTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let tickTimer = null;
/** The block as last drawn, which a poll's answer or the countdown redraws in place. */
/** @type {HTMLElement | null} */
let host = null;
/** @type {SyncState | null} */
let lastSync = null;
/** @type {Hooks | null} */
let lastHooks = null;
/** The owners the links name, read once on load: whose installs are worth asking for. */
/** @type {string[]} */
let linkOwners = [];
/** Why the last ask for the installations failed, shown in place of the list. */
/** @type {string | null} */
let installError = null;
/** Whether an ask for the installations is under way, so the block can say it is asking. */
let checking = false;
/** The control to hand focus to once the block next draws, after a change of phase. */
/** @type {string | null} */
let focusNext = null;

/**
 * Tells a screen reader what changed. Setting the same text twice is not news, so it is cleared
 * first and set a moment later, which reads a repeat out again.
 * @param {string} text
 */
function announce(text) {
  const region = document.getElementById('signin-announce');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => {
    region.textContent = text;
  }, 50);
}

/**
 * Moves focus to the control a change of phase put in the block — but only when focus was in the
 * block, or was lost with the node it was on. Someone typing in the token form below while the
 * alarm finished a sign-in keeps their place.
 */
function settleFocus() {
  const selector = focusNext;
  focusNext = null;
  if (!selector || !host) return;
  const active = document.activeElement;
  const lost = !active || active === document.body || !active.isConnected;
  if (!lost && !host.contains(active)) return;
  const target = /** @type {HTMLElement | null} */ (host.querySelector(selector));
  target?.focus();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, { primary = false } = {}) {
  const node = element('button', `btn${primary ? ' btn-primary' : ''}`, label);
  node.type = 'button';
  return node;
}

function link(text, href) {
  const node = element('a', 'link', text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noreferrer';
  return node;
}

/** @param {SyncState | null} sync */
function appEntry(sync) {
  return sync?.tokens.find((entry) => entry.kind === 'app') ?? null;
}

function stopTimers() {
  clearTimeout(pollTimer);
  pollTimer = null;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

/** Stops asking: the tab is going, and an alarm in the background finishes the flow if it can. */
export function stopSignIn() {
  stopTimers();
}

/** @param {number} seconds */
function schedule(seconds) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollOnce, Math.max(1, seconds) * 1000);
}

function startTick() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (flow?.phase !== 'code' || !flow.code) return;
    const count = host?.querySelector('.signin-count');
    if (count) count.textContent = countdown(flow.code.expiresAt);
    // Run out on screen: ask now rather than at the next tick, and the background says so.
    if (Date.parse(flow.code.expiresAt) <= Date.now() && pollTimer) {
      clearTimeout(pollTimer);
      pollOnce();
    }
  }, 1000);
}

/** @param {string} iso */
function countdown(iso) {
  const left = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000));
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, '0');
  return `Code expires in ${minutes}:${seconds}`;
}

/** Redraws the block for a change of phase, and hands focus on as the change asked. */
function redraw() {
  if (!host || !lastHooks) return;
  host.replaceChildren(...contents(lastSync, lastHooks));
  settleFocus();
}

/** @param {Flow | null} current */
function statusLine(current) {
  return current?.status === 'network' ? 'Lost touch with GitHub, still trying.' : 'Waiting for you to approve on GitHub…';
}

/** A poll's answer within the code phase: the status line changes in place, and is announced if it changed. */
function updateStatus() {
  const line = host?.querySelector('.signin-status');
  const text = statusLine(flow);
  if (!line || line.textContent === text) return;
  line.textContent = text;
  announce(text);
}

/** @param {string} iso */
function minutesLeft(iso) {
  const minutes = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 60000));
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}

/**
 * Shows a code that has come back from the background, and starts asking about it.
 * @param {SignInCode} code
 */
function showCode(code) {
  flow = { phase: 'code', code, interval: code.interval, status: 'waiting' };
  focusNext = '.signin-copy';
  announce(`Your sign-in code is ${code.userCode.split('').join(' ')}. It expires in ${minutesLeft(code.expiresAt)}. Type it on GitHub’s device page.`);
  schedule(code.interval);
  startTick();
}

/**
 * The page came back from the back-forward cache: pagehide stopped the asking, so a code still on
 * screen is asked about again, now.
 */
export function resumeAfterCache() {
  if (flow?.phase !== 'code' || !flow.code) return;
  startTick();
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollOnce, 0);
}

async function pollOnce() {
  pollTimer = null;
  if (flow?.phase !== 'code' || !lastHooks) return;
  const hooks = lastHooks;
  /** @type {Answer<'gitchop:signin:poll'>} */
  let reply;
  try {
    reply = await hooks.ask({ type: 'gitchop:signin:poll' });
  } catch {
    // The background did not answer; it is woken by the next message, so ask again.
    if (flow?.phase !== 'code') return;
    flow = { ...flow, status: 'network' };
    schedule(flow.interval);
    updateStatus();
    return;
  }
  if (flow?.phase !== 'code') return;
  switch (reply.status) {
    // Still waiting: same phase, so only the status line changes, and focus stays where it is.
    case 'pending':
    case 'slow_down':
      flow = { ...flow, interval: reply.interval || flow.interval, status: 'waiting' };
      schedule(flow.interval);
      updateStatus();
      return;
    case 'network':
      flow = { ...flow, interval: reply.interval || flow.interval, status: 'network' };
      schedule(flow.interval);
      updateStatus();
      return;
    case 'done':
    case 'none':
      // Signed in, here or in another tab, or cancelled there: the card says which, from the state.
      flow = null;
      stopTimers();
      focusNext = 'button';
      if (reply.status === 'done') {
        hooks.flash('signed in');
        announce('Signed in with GitHub.');
      }
      if (reply.state) hooks.rerender(reply.state);
      else redraw();
      if (reply.status === 'done') checkInstallations(hooks, appEntry(reply.state));
      return;
    case 'disabled':
      flow = { phase: 'disabled', interval: flow.interval };
      stopTimers();
      hooks.openAdvanced();
      break;
    case 'expired':
    case 'denied':
      flow = { phase: reply.status, interval: flow.interval };
      stopTimers();
      break;
    default:
      flow = { phase: 'error', interval: flow.interval, error: reply.error ?? 'GitHub would not finish the sign-in.' };
      stopTimers();
  }
  focusNext = '.btn-primary';
  announce(endedLine(flow));
  redraw();
}

/**
 * Asks where the app is installed, once, when the background could not say on signing in: it lists
 * the installations as it stores the sign-in, but a failure there is left for the page to say.
 * @param {Hooks} hooks
 * @param {TokenView | null} app
 */
async function checkInstallations(hooks, app) {
  if (!app || app.installations !== null || checking) return;
  checking = true;
  installError = null;
  redraw();
  try {
    const result = await hooks.ask({ type: 'gitchop:signin:installations' });
    checking = false;
    hooks.rerender(result);
  } catch (error) {
    checking = false;
    installError = String(error.message ?? error);
    redraw();
  }
}

/**
 * The hosts, and on Firefox the consent to hold a token, in one request. Firefox is told apart by
 * runtime.getBrowserInfo, which only it has; `browser` is no tell, since current Chrome defines it
 * too. Chrome refuses the Firefox-only data_collection key by throwing on the spot rather than by
 * rejecting, which is why the call sits inside a try. A browser that cannot ask is let through:
 * the background checks the host permission again before asking GitHub for anything.
 * @returns {Promise<boolean>}
 */
async function requestAccess() {
  const origins = ['https://github.com/*', 'https://api.github.com/*'];
  const firefox = typeof api.runtime.getBrowserInfo === 'function';
  try {
    return await api.permissions.request(firefox ? { origins, data_collection: ['authenticationInfo'] } : { origins });
  } catch {
    return true;
  }
}

/**
 * Asks for a code. The permission request is the first thing awaited: Firefox grants a prompt
 * only inside the click that asked for it, and one request for everything — the hosts, and on
 * Firefox the consent to hold a token — resolves at once when all of it is already granted.
 * @param {Hooks} hooks
 */
async function begin(hooks) {
  if (flow?.phase === 'starting') return;
  const ok = await requestAccess();
  if (!ok) {
    hooks.flash('not allowed');
    return;
  }
  flow = { phase: 'starting', interval: 5 };
  focusNext = '.signin-starting';
  announce('Asking GitHub for a code.');
  redraw();
  /** @type {SignInCode} */
  let code;
  try {
    code = await hooks.ask({ type: 'gitchop:signin:start' });
  } catch (error) {
    // Cancelled while asking: the cancel already redrew the block, and has the last word.
    if (flow?.phase !== 'starting') return;
    flow = { phase: 'error', interval: 5, error: String(error.message ?? error) };
    focusNext = '.btn-primary';
    announce(endedLine(flow));
    redraw();
    return;
  }
  if (flow?.phase !== 'starting') return;
  showCode(code);
  redraw();
}

/** @param {Hooks} hooks */
async function cancel(hooks) {
  stopTimers();
  flow = null;
  focusNext = '.btn-primary';
  announce('Sign-in cancelled.');
  redraw();
  await hooks.ask({ type: 'gitchop:signin:cancel' }).catch(() => {});
}

function head(tag) {
  const row = element('div', 'recipe-head');
  row.append(element('span', null, 'Sign in with GitHub'));
  if (tag) row.append(element('span', 'recipe-tag', tag));
  return row;
}

/** @param {Hooks} hooks */
function codeView(hooks) {
  const code = /** @type {SignInCode} */ (flow?.code);
  const box = element('div', 'signin');
  const shown = element('output', 'signin-code', code.userCode);
  shown.setAttribute('aria-label', 'Your sign-in code');

  const copy = button('Copy');
  copy.classList.add('signin-copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.userCode);
      hooks.flash('copied');
    } catch {
      hooks.flash('copy failed');
    }
  });
  const codeRow = element('div', 'signin-row');
  codeRow.append(shown, copy);

  const open = link('Open github.com/login/device →', code.verificationUri);
  const steps = element(
    'p',
    'signin-hint',
    'Open GitHub’s page, sign in there if asked, type this code, and approve gitchop. This page carries on by itself.',
  );

  // Announced through the page's live region when it changes, not as a region of its own.
  const status = element('p', 'signin-status', statusLine(flow));
  const count = element('span', 'signin-count', countdown(code.expiresAt));

  const stop = button('Cancel');
  stop.addEventListener('click', () => cancel(hooks));
  const actions = element('div', 'signin-row');
  actions.append(open, count, stop);

  box.append(codeRow, steps, actions, status);
  return box;
}

/**
 * What each way a flow can end says, and what its button says.
 * @param {Flow | null} current
 * @returns {[string, string]}
 */
function ending(current) {
  /** @type {Record<string, [string, string]>} */
  const said = {
    expired: ['The code ran out before it was approved.', 'Get a new code'],
    denied: ['Sign-in was declined on GitHub.', 'Try again'],
    disabled: ['GitHub has sign-in by code switched off for gitchop. Use a personal access token for now.', 'Try again'],
    error: [current?.error ?? 'Signing in did not work.', 'Try again'],
  };
  return said[current?.phase ?? 'error'] ?? said.error;
}

/** @param {Flow | null} current */
function endedLine(current) {
  return ending(current)[0];
}

/**
 * How a flow ended without a sign-in, and the way on. A new code is only ever asked for on a click.
 * The line was announced as the flow ended; the button it is said beside takes the focus.
 * @param {Hooks} hooks
 */
function endedView(hooks) {
  const box = element('div', 'signin');
  const [line, again] = ending(flow);
  box.append(element('p', flow?.phase === 'error' ? 'error signin-error' : 'signin-status', line));
  const retry = button(again, { primary: true });
  retry.addEventListener('click', () => begin(hooks));
  const dismiss = button('Not now');
  dismiss.addEventListener('click', () => {
    flow = null;
    focusNext = '.btn-primary';
    redraw();
  });
  const actions = element('div', 'signin-row');
  actions.append(retry, dismiss);
  box.append(actions);
  return box;
}

/**
 * Nothing signed in: what signing in gives gitchop, said before the click rather than after, and
 * the button.
 * @param {SyncState | null} sync
 * @param {Hooks} hooks
 */
function idleView(sync, hooks) {
  const box = element('div', 'signin');
  box.append(
    element(
      'p',
      'signin-hint',
      'Read-only on repositories, issues, pull requests and contents where you install gitchop, plus read ' +
        'and write on your gists for the backup. Sent only to GitHub.',
    ),
  );
  box.append(
    element('p', 'signin-hint', 'A sign-in counts only your public contributions. Private ones need a classic token with read:user.'),
  );
  if (sync?.tokens.some((entry) => entry.kind !== 'app')) {
    box.append(
      element('p', 'signin-hint', 'Signing in can replace a token per organisation. Your saved tokens keep working beside it.'),
    );
  }
  const go = button('Sign in with GitHub', { primary: true });
  go.addEventListener('click', () => begin(hooks));
  const actions = element('div', 'signin-row');
  actions.append(go);
  box.append(actions);
  return box;
}

/**
 * The owners worth having the app on: the account itself, the owners the links name, and those the
 * saved fine-grained tokens were made for, which signing in might replace.
 * @param {SyncState | null} sync
 * @param {TokenView} app
 */
function candidates(sync, app) {
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
 * The saved tokens made for chosen owners. A classic token is left out: it reaches every owner,
 * and is the token signing in is most worth replacing, so it is not counted as covering anyone.
 * @param {SyncState | null} sync
 */
function fineGrained(sync) {
  return (sync?.tokens ?? []).filter((entry) => entry.kind !== 'app' && entry.kind !== 'classic');
}

/**
 * @param {TokenView} app
 * @param {{ badge?: string, detail: string }} parts
 */
function accountRow(app, { badge, detail }) {
  const row = element('div', 'token');
  const name = element('div', 'token-name');
  const who = element('b', null, app.login ? `@${app.login}` : 'your account');
  name.append(element('span', 'token-detail', 'Signed in as'), who, element('span', 'token-detail', detail));
  if (badge) name.append(element('span', 'token-warn', badge));
  row.append(name);
  return row;
}

/**
 * Signed in: as whom, where the app is installed, and where it is not but would help — each of
 * those with the way to install it, or to add a token for that owner instead.
 * @param {SyncState | null} sync
 * @param {TokenView} app
 * @param {Hooks} hooks
 */
function signedInView(sync, app, hooks) {
  const box = element('div', 'signin');
  box.append(accountRow(app, { detail: 'GitHub App · renews itself' }));

  if (app.installations === null) {
    let line = 'Not checked yet where gitchop is installed. Check again to ask GitHub.';
    if (checking) line = 'Asking GitHub where gitchop is installed…';
    else if (installError) line = `Could not ask where gitchop is installed: ${installError}`;
    box.append(element('p', 'signin-hint', line));
  } else {
    const installed = element('div', 'installs');
    installed.append(element('b', null, 'Installed on'));
    const list = element('ul');
    for (const install of app.installations ?? []) {
      list.append(element('li', null, `@${install.owner} (${install.selection === 'all' ? 'all repositories' : 'selected repositories'})`));
    }
    if (list.childElementCount === 0) list.append(element('li', null, 'nowhere yet'));
    installed.append(list);
    box.append(installed);

    // Owners without the app that a saved fine-grained token reaches are not public-only: they are
    // listed apart, with the install link but no offer of a token they already have.
    const missing = missingInstalls(app.installations, candidates(sync, app));
    const tokens = fineGrained(sync);
    const covered = missing.filter((owner) => tokens.some((entry) => reaches(entry, owner)));
    const uncovered = missing.filter((owner) => !covered.includes(owner));
    if (covered.length > 0) {
      const byToken = element('div', 'installs');
      byToken.append(element('b', null, 'Covered by a token'));
      const rows = element('ul');
      for (const owner of covered) {
        const item = element('li');
        item.append(element('span', null, `@${owner}`), link(`Install on @${owner} →`, INSTALL_URL));
        rows.append(item);
      }
      byToken.append(rows);
      box.append(byToken);
    }
    if (uncovered.length > 0) {
      const wanting = element('div', 'installs');
      wanting.append(element('b', null, 'Not installed on'));
      const rows = element('ul');
      for (const owner of uncovered) {
        const item = element('li');
        const own = app.login && owner.toLowerCase() === app.login.toLowerCase();
        item.append(element('span', null, own ? `@${owner} (your account)` : `@${owner}`), link(`Install on @${owner} →`, INSTALL_URL));
        if (!own) {
          const pat = element('button', 'btn btn-inline', `or add a token for @${owner}`);
          pat.type = 'button';
          pat.addEventListener('click', () => hooks.openAdvanced(owner));
          item.append(pat);
        }
        rows.append(item);
      }
      wanting.append(rows);
      box.append(wanting);
      const classic = (sync?.tokens ?? []).some((entry) => entry.kind === 'classic');
      box.append(
        element(
          'p',
          'signin-hint',
          (classic
            ? 'Your classic token still reaches these. Without it, gitchop would see only their public repositories. '
            : 'Without the app or a token, gitchop sees only these owners’ public repositories. ') +
            'You pick the repositories on GitHub. A member’s install becomes a request to the organisation’s owners.',
        ),
      );
    }
  }

  const again = button('Check again');
  again.title = 'Ask GitHub again where gitchop is installed';
  again.addEventListener('click', () =>
    hooks.guard(again, 'token', async (flash) => {
      installError = null;
      try {
        const result = await hooks.ask({ type: 'gitchop:signin:installations' });
        flash('checked');
        hooks.rerender(result);
      } catch (error) {
        installError = String(error.message ?? error);
        redraw();
        throw error;
      }
    }),
  );
  const out = button('Sign out');
  out.addEventListener('click', () => signOut(app, out, hooks, 'Sign out of GitHub here? gitchop forgets the sign-in; to end it on GitHub as well, revoke it there.'));
  const actions = element('div', 'signin-row');
  actions.append(again, out, link('Revoke on GitHub →', REVOKE_URL));
  box.append(actions);
  return box;
}

/**
 * @param {TokenView} app
 * @param {HTMLElement} node
 * @param {Hooks} hooks
 * @param {string | null} question
 */
function signOut(app, node, hooks, question) {
  return hooks.guard(node, 'token', async (flash) => {
    if (question && !confirm(question)) return;
    const result = await hooks.ask({ type: 'gitchop:token:remove', id: app.id });
    stopTimers();
    flow = null;
    focusNext = '.btn-primary';
    flash('signed out');
    announce('Signed out.');
    hooks.rerender(result);
  });
}

/**
 * GitHub refused to renew the sign-in: the row stays, saying so, with the way back in. Signing in
 * again takes the old entry's place, so nothing remembered against it is lost.
 * @param {TokenView} app
 * @param {Hooks} hooks
 */
function needsSignInView(app, hooks) {
  const box = element('div', 'signin');
  const row = accountRow(app, {
    badge: 'signed out',
    detail: `GitHub no longer accepts this sign-in: ${reasonFor(app.signInError)}. Your tokens and public data still work.`,
  });
  // GitHub's own word for it, for whoever wants to look it up.
  if (app.signInError) row.title = app.signInError;
  box.append(row);
  const again = button('Sign in again', { primary: true });
  again.addEventListener('click', () => begin(hooks));
  const drop = button('Remove');
  drop.addEventListener('click', () => signOut(app, drop, hooks, null));
  const actions = element('div', 'signin-row');
  actions.append(again, drop);
  box.append(actions);
  return box;
}

/**
 * Why a sign-in stopped working, in words: GitHub's reasons are codes, and the rest are gitchop's.
 * @param {string | null | undefined} code
 */
function reasonFor(code) {
  switch (code) {
    case 'lapsed':
      return 'it went unused for too long';
    case 'bad_refresh_token':
    case 'invalid_grant':
      return 'its renewal was refused, or had already been used';
    case 'rejected':
      return 'GitHub refused it, and it has no way to renew';
    case 'no_renewal':
      return 'it ran out, and has no way to renew';
    case null:
    case undefined:
    case '':
      return 'GitHub gave no reason';
    default:
      return 'GitHub refused to renew it';
  }
}

/**
 * @param {SyncState | null} sync
 * @param {Hooks} hooks
 * @returns {HTMLElement[]}
 */
function contents(sync, hooks) {
  const app = appEntry(sync);
  if (flow?.phase === 'code' && flow.code) return [head(), codeView(hooks)];
  if (flow?.phase === 'starting') {
    const box = element('div', 'signin');
    const asking = element('p', 'signin-status signin-starting', 'Asking GitHub for a code…');
    // Focusable from script only, so the focus the Sign in button had does not fall to the page.
    asking.tabIndex = -1;
    box.append(asking);
    return [head(), box];
  }
  if (flow) return [head(), endedView(hooks)];
  if (app?.needsSignIn) return [head(), needsSignInView(app, hooks)];
  if (app) return [head(), signedInView(sync, app, hooks)];
  return [head('recommended'), idleView(sync, hooks)];
}

/**
 * The block, drawn from the state and the flow in progress.
 * @param {SyncState | null} sync
 * @param {Hooks} hooks
 * @returns {HTMLElement}
 */
export function signInBlock(sync, hooks) {
  lastSync = sync;
  lastHooks = hooks;
  const block = element('div', 'recipe signin-block');
  block.append(...contents(sync, hooks));
  host = block;
  // Drawn, but not yet in the page: focus can move once the card has put it there.
  if (focusNext) queueMicrotask(settleFocus);
  return block;
}

/**
 * Once per page load, after the first state: pick up a code a reload or another tab left showing,
 * or, with a sign-in saved, ask where the app is installed now. Either may fail without the card
 * minding; the block says what it can.
 * @param {SyncState} sync
 * @param {Hooks} hooks
 */
export async function resumeSignIn(sync, hooks) {
  lastHooks = hooks;
  try {
    linkOwners = ownersFromLinks(await loadLinks());
  } catch {
    linkOwners = [];
  }
  const app = appEntry(sync);
  if (!app || app.needsSignIn) {
    try {
      const { code } = await hooks.ask({ type: 'gitchop:signin:pending' });
      if (code && !flow) {
        showCode(code);
        // Picked up mid-flow: the background throttles to GitHub's interval, so asking now is free.
        clearTimeout(pollTimer);
        pollTimer = setTimeout(pollOnce, 0);
      }
    } catch {
      /* no code to pick up; the button is there */
    }
    redraw();
    return;
  }
  checking = true;
  redraw();
  try {
    const result = await hooks.ask({ type: 'gitchop:signin:installations' });
    checking = false;
    hooks.rerender(result);
  } catch (error) {
    checking = false;
    installError = String(error.message ?? error);
    redraw();
  }
}
