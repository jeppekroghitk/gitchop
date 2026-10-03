import { loadLinks } from '../lib/links.js';
import { ownersFromLinks } from '../lib/repos.js';
import { INSTALL_URL, REVOKE_URL } from '../lib/signin.js';
import { afterLostPoll, afterPoll, appEntry, countdown, endedLine, ending, minutesLeft, ownerReach, requestAccess, statusLine } from '../lib/signin-flow.js';

/** @import { Answer, Message, MessageType } from '../background/messages.js' */
/** @import { SignInCode } from '../background/signin.js' */
/** @import { SyncState, TokenView } from '../background/config.js' */
/** @import { Flow } from '../lib/signin-flow.js' */

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
/** Whether the sign-out is waiting on its confirmation, drawn in place under the account. */
let confirmingOut = false;
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
  // A list of selectors is a list of choices, the first that matches winning, not document order.
  for (const choice of selector.split(',')) {
    const target = /** @type {HTMLElement | null} */ (host.querySelector(choice.trim()));
    if (target) {
      target.focus();
      return;
    }
  }
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

/**
 * The card's one quieter control, beside its buttons: for what is there when wanted but is not the
 * way on — signing out, a token for one owner, managing access on GitHub. A link when it leads to
 * GitHub, a button otherwise.
 * @param {string} text
 * @param {string} [href]
 * @returns {HTMLElement}
 */
function quiet(text, href) {
  if (href) {
    const node = link(text, href);
    node.className = 'quiet';
    return node;
  }
  const node = element('button', 'quiet', text);
  node.type = 'button';
  return node;
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

/** Redraws the block for a change of phase, and hands focus on as the change asked. */
function redraw() {
  if (!host || !lastHooks) return;
  host.replaceChildren(...contents(lastSync, lastHooks));
  settleFocus();
}

/** A poll's answer within the code phase: the status line changes in place, and is announced if it changed. */
function updateStatus() {
  const line = host?.querySelector('.signin-status');
  const text = statusLine(flow);
  if (!line || line.textContent === text) return;
  line.textContent = text;
  announce(text);
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
    flow = afterLostPoll(flow);
    schedule(flow.interval);
    updateStatus();
    return;
  }
  if (flow?.phase !== 'code') return;
  const next = afterPoll(flow, reply);
  flow = next.flow;
  // Still waiting: same phase, so only the status line changes, and focus stays where it is.
  if (next.verdict === 'waiting' && flow) {
    schedule(flow.interval);
    updateStatus();
    return;
  }
  stopTimers();
  if (next.verdict === 'signed-in' || next.verdict === 'gone') {
    // Signed in, here or in another tab, or cancelled there: the card says which, from the state.
    focusNext = '.btn-primary, button';
    if (next.verdict === 'signed-in') {
      hooks.flash('signed in');
      announce('Signed in with GitHub.');
    }
    if (reply.state) hooks.rerender(reply.state);
    else redraw();
    if (next.verdict === 'signed-in') checkInstallations(hooks, appEntry(reply.state));
    return;
  }
  if (flow?.phase === 'disabled') hooks.openAdvanced();
  focusNext = '.btn-primary, .signin-retry';
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

/**
 * One step of the card's short list: what it is, whether it is done, next, still to come or in
 * trouble, and what goes with it. A done step folds to one line saying what was done; the step
 * that is next carries the one primary action; a step still to come is its title alone.
 * @param {{
 *   number: number,
 *   state: 'done' | 'current' | 'todo' | 'warn',
 *   title: string | Node[],
 *   meta?: string | Node | null,
 *   aside?: Node[],
 *   body?: Node[],
 * }} parts
 */
function stepItem({ number, state, title, meta, aside = [], body = [] }) {
  const item = element('li', 'flow-step');
  item.dataset.state = state;
  const mark = element('span', 'flow-mark', state === 'done' ? '✓' : state === 'warn' ? '!' : String(number));
  mark.setAttribute('aria-hidden', 'true');
  const main = element('div', 'flow-main');
  const top = element('div', 'flow-head');
  const name = element('h3', 'flow-title');
  if (typeof title === 'string') name.textContent = title;
  else name.append(...title);
  const said = { done: 'done', current: 'next', todo: 'to do', warn: 'needs attention' }[state];
  name.append(element('span', 'visually-hidden', ` (${said})`));
  top.append(name);
  if (meta) top.append(typeof meta === 'string' ? element('span', 'flow-meta', meta) : meta);
  if (aside.length > 0) {
    const tools = element('div', 'flow-aside');
    tools.append(...aside);
    top.append(tools);
  }
  main.append(top, ...body);
  item.append(mark, main);
  return item;
}

/** A line of prose under a step's title. */
function say(text, className = 'flow-text') {
  return element('p', className, text);
}

/** @param {Node[]} nodes */
function actionRow(...nodes) {
  const row = element('div', 'flow-actions');
  row.append(...nodes);
  return row;
}

/** A link that reads as a button, for an action that happens on GitHub. */
function linkButton(text, href, { primary = false } = {}) {
  const node = link(text, href);
  node.className = `btn${primary ? ' btn-primary' : ''}`;
  return node;
}

/** @param {string} login */
function handle(login) {
  return element('span', 'flow-handle', `@${login}`);
}

/**
 * The first step while a code is on screen: the code, the way to GitHub's page, and the clock.
 * @param {Hooks} hooks
 */
function codeBody(hooks) {
  const code = /** @type {SignInCode} */ (flow?.code);
  const shown = element('output', 'signin-code', code.userCode);
  shown.setAttribute('aria-label', 'Your sign-in code');
  const copy = button('Copy');
  copy.classList.add('btn-edge', 'signin-copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.userCode);
      hooks.flash('copied');
    } catch {
      hooks.flash('copy failed');
    }
  });
  const codeRow = element('div', 'flow-code');
  codeRow.append(shown, copy);

  const open = linkButton('Open GitHub’s device page', code.verificationUri, { primary: true });
  const stop = button('Cancel');
  stop.addEventListener('click', () => cancel(hooks));

  // Announced through the page's live region when it changes, not as a region of its own.
  const status = element('p', 'signin-status', statusLine(flow));
  return [
    say('Type this code on GitHub and approve gitchop. This page carries on by itself.'),
    codeRow,
    actionRow(open, stop),
    status,
  ];
}

/**
 * How a flow ended without a sign-in, and the way on. A new code is only ever asked for on a click.
 * The line was announced as the flow ended; the button it is said beside takes the focus.
 * @param {Hooks} hooks
 */
function endedBody(hooks) {
  const { line, again, reason } = ending(flow);
  // Switched off on GitHub, a retry is a long shot: the token form below is the way on.
  const retry = button(again, { primary: flow?.phase !== 'disabled' });
  retry.classList.add('signin-retry');
  retry.addEventListener('click', () => begin(hooks));
  const dismiss = button('Not now');
  dismiss.addEventListener('click', () => {
    flow = null;
    focusNext = '.btn-primary';
    redraw();
  });
  const lead = say(line, 'signin-status');
  if (reason) lead.append(element('span', 'flow-reason', reason));
  return [lead, actionRow(retry, dismiss)];
}

/**
 * Nothing signed in: what signing in gives gitchop, said before the click rather than after, and
 * the button.
 * @param {SyncState | null} sync
 * @param {Hooks} hooks
 */
function idleBody(sync, hooks) {
  let what = 'Read-only access to the repositories you choose, and your gists for the backup. Sent only to GitHub.';
  if (sync?.tokens.some((entry) => entry.kind !== 'app')) what += ' Your saved tokens keep working beside it.';
  const body = [say(what)];
  const go = button('Sign in with GitHub', { primary: true });
  go.addEventListener('click', () => begin(hooks));
  body.push(actionRow(go));
  return body;
}

/**
 * One owner in the second step: whether gitchop reaches it, how, and for an organisation it does
 * not reach yet, the way to a token instead.
 * @param {string} owner
 * @param {'in' | 'token' | 'out'} reach
 * @param {string} detail
 * @param {Hooks | null} hooks
 */
function ownerRow(owner, reach, detail, hooks) {
  const item = element('li', 'flow-owner');
  item.dataset.reach = reach;
  const dot = element('span', 'flow-dot');
  dot.setAttribute('aria-hidden', 'true');
  item.append(dot, handle(owner), element('span', 'flow-detail', detail));
  if (hooks) {
    const pat = quiet('Use a token instead');
    pat.setAttribute('aria-label', `Use a token for @${owner} instead`);
    pat.addEventListener('click', () => hooks.openAdvanced(owner));
    item.append(pat);
  }
  return item;
}

/**
 * Asks GitHub again where the app is installed, from a click, with the card's busy guard.
 * @param {HTMLElement} node
 * @param {Hooks} hooks
 */
function askAgain(node, hooks) {
  return hooks.guard(node, 'token', async (flash) => {
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
  });
}

/**
 * The second step while it is not known where the app is installed: asking, not asked yet, or the
 * ask failed. Until the list is known, asking again is the way on.
 * @param {Hooks} hooks
 */
function unknownAccess(hooks) {
  const title = 'Give gitchop access to your organisations';
  if (checking) return stepItem({ number: 2, state: 'current', title, body: [say('Asking GitHub where gitchop is installed…', 'signin-status')] });
  const again = button(installError ? 'Try again' : 'Check now', { primary: true });
  again.addEventListener('click', () => askAgain(again, hooks));
  const lead = say(installError ? 'Could not check where gitchop is installed.' : 'Not checked yet where gitchop is installed.', 'signin-status');
  if (installError) lead.append(element('span', 'flow-reason', installError));
  return stepItem({ number: 2, state: installError ? 'warn' : 'current', title, body: [lead, actionRow(again, linkButton('Install on GitHub', INSTALL_URL))] });
}

/**
 * How many accounts gitchop reaches, said as the done step's title.
 * @param {number} count
 */
function reachTitle(count) {
  if (count === 1) return 'Access to your account';
  if (count === 2) return 'Access to both accounts';
  return `Access to all ${count} accounts`;
}

/**
 * Where the app is installed, as the second step. Owners without the app that a saved fine-grained
 * token reaches are not public-only: they count as reached, with no offer of a token they already
 * have. One install link serves every owner, since GitHub's page asks which account. Once every
 * owner is reached the step folds to one line, like the first.
 * @param {SyncState | null} sync
 * @param {TokenView} app
 * @param {Hooks} hooks
 * @returns {HTMLElement}
 */
function accessStep(sync, app, hooks) {
  if (app.installations === null) return unknownAccess(hooks);

  const { installs, covered, uncovered, classic, total, reached } = ownerReach(sync, app, linkOwners);

  if (uncovered.length === 0 && reached > 0) {
    const names = element('p', 'flow-summary');
    const all = [
      ...installs.map((install) => [install.owner, install.selection === 'all' ? '' : ' (chosen repositories)']),
      ...covered.map((owner) => [owner, ' (by token)']),
    ];
    all.forEach(([owner, note], at) => {
      if (at > 0) names.append(at === all.length - 1 ? ' and ' : ', ');
      names.append(handle(owner));
      if (note) names.append(note);
    });
    return stepItem({
      number: 2,
      state: 'done',
      title: reachTitle(reached),
      aside: [quiet('Manage on GitHub', INSTALL_URL)],
      body: [names],
    });
  }

  const list = element('ul', 'flow-owners');
  for (const install of installs) {
    list.append(ownerRow(install.owner, 'in', install.selection === 'all' ? 'all repositories' : 'chosen repositories', null));
  }
  for (const owner of covered) list.append(ownerRow(owner, 'token', 'through a saved token', null));
  for (const owner of uncovered) {
    const own = Boolean(app.login && owner.toLowerCase() === app.login.toLowerCase());
    let detail = classic ? 'through your classic token' : 'public repositories only';
    if (own) detail = `your account, ${detail}`;
    list.append(ownerRow(owner, 'out', detail, own ? null : hooks));
  }
  const install = linkButton('Install on GitHub', INSTALL_URL, { primary: true });
  return stepItem({
    number: 2,
    state: 'current',
    title: 'Give gitchop access to your organisations',
    meta: total > 0 ? `${reached} of ${total} accounts` : null,
    body: [
      list,
      actionRow(install),
      say(
        'On GitHub, pick the account and its repositories; in an organisation you do not own, the install goes to its owners as a request. This list updates when you come back.',
        'flow-hint',
      ),
    ],
  });
}

/**
 * @param {TokenView} app
 * @param {HTMLElement} node
 * @param {Hooks} hooks
 */
function signOut(app, node, hooks) {
  return hooks.guard(node, 'token', async (flash) => {
    const result = await hooks.ask({ type: 'gitchop:token:remove', id: app.id });
    stopTimers();
    flow = null;
    confirmingOut = false;
    focusNext = '.btn-primary';
    flash('signed out');
    announce('Signed out.');
    hooks.rerender(result);
  });
}

/**
 * Asked before signing out, in place rather than in a dialog: what signing out here does, and the
 * way to end the sign-in on GitHub too, which signs out here as it opens GitHub's page.
 * @param {TokenView} app
 * @param {Hooks} hooks
 */
function signOutConfirm(app, hooks) {
  const box = element('div', 'signout');
  box.append(say('gitchop forgets the sign-in on this browser. The app keeps its access on GitHub until you revoke it there.'));
  const yes = button('Sign out', { primary: true });
  yes.classList.add('signout-confirm');
  yes.addEventListener('click', () => signOut(app, yes, hooks));
  const revoke = linkButton('Sign out and revoke on GitHub', REVOKE_URL);
  revoke.classList.add('signout-revoke');
  // The link opens GitHub's page as it would anyway; the click signs out here as well.
  revoke.addEventListener('click', () => signOut(app, revoke, hooks));
  const no = quiet('Cancel');
  no.addEventListener('click', () => {
    confirmingOut = false;
    focusNext = '.signout-open';
    redraw();
  });
  box.append(actionRow(yes, revoke, no));
  return box;
}

/** The one quiet Sign out, which asks in place before it does anything. */
function signOutOpener() {
  const out = quiet('Sign out');
  out.classList.add('signout-open');
  out.addEventListener('click', () => {
    confirmingOut = true;
    focusNext = '.signout-confirm';
    redraw();
  });
  return out;
}

/**
 * Signed in: the first step folds to who, with the way out, and the second is where the app is.
 * @param {SyncState | null} sync
 * @param {TokenView} app
 * @param {Hooks} hooks
 */
function signedInSteps(sync, app, hooks) {
  const who = app.login ? handle(app.login) : element('span', null, 'your account');
  /** @type {Node[]} */
  const aside = confirmingOut ? [] : [signOutOpener()];
  const one = stepItem({
    number: 1,
    state: 'done',
    title: ['Signed in as ', who],
    aside,
    body: confirmingOut ? [signOutConfirm(app, hooks)] : [],
  });
  return [one, accessStep(sync, app, hooks)];
}

/**
 * GitHub refused to renew the sign-in: the step says so, with the way back in. Signing in again
 * takes the old entry's place, so nothing remembered against it is lost.
 * @param {TokenView} app
 * @param {Hooks} hooks
 */
function needsSignInBody(app, hooks) {
  const line = say('GitHub no longer accepts the sign-in');
  if (app.login) line.append(' for ', handle(app.login));
  line.append(`: ${reasonFor(app.signInError)}. Your tokens and public data still work.`);
  // GitHub's own word for it, for whoever wants to look it up.
  if (app.signInError) line.title = app.signInError;
  if (confirmingOut) return [line, signOutConfirm(app, hooks)];
  const again = button('Sign in again', { primary: true });
  again.addEventListener('click', () => begin(hooks));
  return [line, actionRow(again, signOutOpener())];
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
 * The first step while nobody is signed in, by the flow's phase.
 * @param {SyncState | null} sync
 * @param {Hooks} hooks
 */
function firstStep(sync, hooks) {
  const app = appEntry(sync);
  const title = 'Sign in with GitHub';
  if (flow?.phase === 'code' && flow.code) {
    const count = element('span', 'flow-meta signin-count', countdown(flow.code.expiresAt));
    return stepItem({ number: 1, state: 'current', title, meta: count, body: codeBody(hooks) });
  }
  if (flow?.phase === 'starting') {
    const asking = element('p', 'signin-status signin-starting', 'Asking GitHub for a code…');
    // Focusable from script only, so the focus the Sign in button had does not fall to the page.
    asking.tabIndex = -1;
    return stepItem({ number: 1, state: 'current', title, body: [asking] });
  }
  if (flow) return stepItem({ number: 1, state: flow.phase === 'expired' ? 'current' : 'warn', title, body: endedBody(hooks) });
  if (app?.needsSignIn) return stepItem({ number: 1, state: 'warn', title: 'Sign in again', body: needsSignInBody(app, hooks) });
  return stepItem({ number: 1, state: 'current', title, meta: 'recommended', body: idleBody(sync, hooks) });
}

/**
 * @param {SyncState | null} sync
 * @param {Hooks} hooks
 * @returns {HTMLElement[]}
 */
function contents(sync, hooks) {
  const app = appEntry(sync);
  const list = element('ol', 'flow');
  if (!app || flow) confirmingOut = false;
  if (!flow && app && !app.needsSignIn) list.append(...signedInSteps(sync, app, hooks));
  else list.append(firstStep(sync, hooks), stepItem({ number: 2, state: 'todo', title: 'Give gitchop access to your organisations' }));
  return [list];
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
  const block = element('div', 'signin-block');
  block.append(...contents(sync, hooks));
  host = block;
  // Drawn, but not yet in the page: focus can move once the card has put it there.
  if (focusNext) queueMicrotask(settleFocus);
  return block;
}

/** Whether the page has been left since the last look, so only a return counts as one. */
let away = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let returnTimer = null;
let lastReturnCheck = 0;
let watchingReturns = false;
let busyReturn = false;

/**
 * Back from another tab or window — most often GitHub's install page — ask again where the app is
 * installed, at most once every few seconds. The card is redrawn only when the answer changed, so a
 * token half typed into the form below is not wiped by a look that found nothing new.
 */
async function recheckOnReturn() {
  const hooks = lastHooks;
  const app = appEntry(lastSync);
  if (!hooks || !app || app.needsSignIn || flow || checking || busyReturn) return;
  if (Date.now() - lastReturnCheck < 5000) return;
  lastReturnCheck = Date.now();
  const before = JSON.stringify(app.installations);
  busyReturn = true;
  try {
    const result = await hooks.ask({ type: 'gitchop:signin:installations' });
    const after = appEntry(result)?.installations ?? null;
    if (JSON.stringify(after) === before && !installError) return;
    installError = null;
    if (before !== 'null') {
      hooks.flash('updated');
      announce('Updated where gitchop is installed.');
    }
    hooks.rerender(result);
  } catch (error) {
    // Known installations stay on screen; only an unknown list says the ask failed.
    if (app.installations !== null) return;
    installError = String(error.message ?? error);
    redraw();
  } finally {
    busyReturn = false;
  }
}

function back() {
  if (!away) return;
  away = false;
  clearTimeout(returnTimer);
  returnTimer = setTimeout(recheckOnReturn, 600);
}

function watchReturns() {
  if (watchingReturns) return;
  watchingReturns = true;
  window.addEventListener('blur', () => {
    away = true;
  });
  window.addEventListener('focus', back);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') away = true;
    else back();
  });
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
  watchReturns();
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
