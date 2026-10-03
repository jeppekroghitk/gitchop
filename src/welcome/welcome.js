import { api, loadLinks } from '../lib/links.js';
import { send } from '../lib/messages.js';
import { ownersFromLinks } from '../lib/repos.js';
import { DEVICE_URL, INSTALL_URL } from '../lib/signin.js';
import { afterLostPoll, afterPoll, appEntry, countdown, ending, minutesLeft, ownerReach, requestAccess, statusLine } from '../lib/signin-flow.js';

/** @import { Answer, Message, MessageType } from '../background/messages.js' */
/** @import { SignInCode } from '../background/signin.js' */
/** @import { SyncState, TokenView } from '../background/config.js' */
/** @import { Flow } from '../lib/signin-flow.js' */

/**
 * The welcome: what a new user sees first, one decision per screen. It says what gitchop is and
 * what the one gesture is, offers the sign-in, and carries it out here rather than sending the user
 * to Settings — the code, the way to GitHub's page, the wait — then asks for the organisations,
 * and ends on where to press the key. Every screen has a quiet way past it at the bottom.
 *
 * The sign-in is the Settings card's, through the same background messages and the same shared
 * pieces in src/lib/signin-flow.js: this page drives the polls while it is open, and the
 * background's alarm finishes a flow whose tab was closed.
 */

const GITHUB = 'https://github.com/';

/** @typedef {'hello' | 'signin' | 'access' | 'ready'} Screen */

/** @type {Screen} */
let screen = 'hello';
/** @type {Flow | null} */
let flow = null;
/** @type {SyncState | null} */
let sync = null;
/** Reached the end without signing in, so the end says where the sign-in is kept. */
let skipped = false;
/** Signed in, but went past the organisations without installing, so that step is not marked done. */
let orgsSkipped = false;
/** @type {string[]} */
let linkOwners = [];
let checking = false;
/** @type {string | null} */
let installError = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let pollTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let tickTimer = null;

const screenEl = /** @type {HTMLElement} */ (document.getElementById('screen'));
const bottomEl = /** @type {HTMLElement} */ (document.getElementById('bottom'));
const stepsEl = /** @type {HTMLElement} */ (document.getElementById('steps'));
const announceEl = /** @type {HTMLElement} */ (document.getElementById('announce'));

/**
 * @template {MessageType} T
 * @param {Message<T>} message
 * @returns {Promise<Answer<T>>}
 */
async function ask(message) {
  const response = await send(message);
  if (!response?.ok) throw new Error(response?.error ?? 'The background script did not answer.');
  return response;
}

/**
 * Cleared first and set a moment later, so a repeat of the same words is read out again.
 * @param {string} text
 */
function announce(text) {
  announceEl.textContent = '';
  setTimeout(() => {
    announceEl.textContent = text;
  }, 50);
}

/**
 * @param {string} tag
 * @param {string | null} [className]
 * @param {string | null} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {string} label
 * @param {() => void} onClick
 * @param {{ primary?: boolean, quiet?: boolean }} [options]
 */
function button(label, onClick, { primary = false, quiet = false } = {}) {
  const node = /** @type {HTMLButtonElement} */ (el('button', quiet ? 'quiet' : `btn${primary ? ' btn-primary' : ''}`, label));
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/**
 * A link that reads as a button: for what happens on GitHub. One that opens in a new tab leaves
 * this page where it is, which is what keeps a sign-in polling while the user approves.
 * @param {string} label
 * @param {string} href
 * @param {{ primary?: boolean, quiet?: boolean, newTab?: boolean }} [options]
 */
function linkButton(label, href, { primary = false, quiet = false, newTab = true } = {}) {
  const node = /** @type {HTMLAnchorElement} */ (el('a', quiet ? 'quiet' : `btn${primary ? ' btn-primary' : ''}`, label));
  node.href = href;
  if (newTab) {
    node.target = '_blank';
    node.rel = 'noreferrer';
  }
  return node;
}

/** @param {Node[]} nodes */
function actions(...nodes) {
  const row = el('div', 'actions');
  row.append(...nodes);
  return row;
}

/** The key itself, the one thing a new user must learn, on the line the chop cuts. */
function keycap() {
  const wrap = el('div', 'hero-key');
  wrap.setAttribute('aria-hidden', 'true');
  const key = el('div', 'keycap');
  key.append(el('span', 'keycap-dot'));
  wrap.append(el('span', 'blade'), key);
  return wrap;
}

/**
 * The dot as it sits in a sentence. A kbd cannot carry a name, so the key is hidden from screen
 * readers and its name is said in words beside it.
 */
function dot() {
  const wrap = document.createDocumentFragment();
  const key = el('kbd', 'key', '.');
  key.setAttribute('aria-hidden', 'true');
  wrap.append(key, el('span', 'visually-hidden', 'the dot key'));
  return wrap;
}

/**
 * The few steps of the sign-in, as marks in the head: which one this is, of how many. None on the
 * first screen, which is not a step, nor at the end of the way without a sign-in. Organisations
 * passed by with "Skip for now" are marked skipped, not done.
 * @param {number | null} at
 */
function paintSteps(at) {
  stepsEl.textContent = '';
  stepsEl.hidden = at === null;
  if (at === null) return;
  const names = ['Sign in', 'Organisations', 'Ready'];
  stepsEl.setAttribute('aria-label', `Step ${at} of ${names.length}`);
  names.forEach((name, index) => {
    const item = el('li', 'step', name);
    item.dataset.state = index + 1 < at ? (index === 1 && orgsSkipped ? 'skipped' : 'done') : index + 1 === at ? 'current' : 'todo';
    if (index + 1 === at) item.setAttribute('aria-current', 'step');
    stepsEl.append(item);
  });
}

function stopTimers() {
  clearTimeout(pollTimer);
  pollTimer = null;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
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
    const count = screenEl.querySelector('.count');
    if (count) count.textContent = countdown(flow.code.expiresAt);
    if (Date.parse(flow.code.expiresAt) <= Date.now() && pollTimer) {
      clearTimeout(pollTimer);
      pollOnce();
    }
  }, 1000);
}

/**
 * Draws the screen, and hands focus to its primary action when the change came from the user,
 * so Enter is always the way on.
 * @param {{ focus?: boolean }} [options]
 */
function render({ focus = false } = {}) {
  screenEl.dataset.screen = screen;
  document.body.dataset.screen = screen;
  screenEl.replaceChildren(...contents());
  bottomEl.replaceChildren(...footer());
  if (!focus) return;
  const target = /** @type {HTMLElement} */ (screenEl.querySelector('.btn-primary:not([aria-disabled="true"])') ?? screenEl);
  target.focus({ preventScroll: true });
}

/** @returns {Node[]} */
function contents() {
  if (screen === 'signin') return signInScreen();
  if (screen === 'access') return accessScreen();
  if (screen === 'ready') return readyScreen();
  return helloScreen();
}

/** @returns {Node[]} */
function footer() {
  if (screen === 'hello') return [button('Continue without signing in', skip, { quiet: true })];
  if (screen === 'signin') return flow?.phase === 'disabled' ? [] : [button('Continue without signing in', skip, { quiet: true })];
  if (screen === 'access') {
    const app = appEntry(sync);
    const done = app && app.installations && reachedAll(app);
    return done ? [] : [button('Skip for now', finish, { quiet: true })];
  }
  // Put aside, the sign-in is still one click away, in the same words the menu's quiet row uses.
  const settings = button('Settings', openSettings, { quiet: true });
  return skipped ? [button('Sign in to search your private repositories', begin, { quiet: true }), settings] : [settings];
}

function helloScreen() {
  paintSteps(null);
  const title = el('h1', 'title');
  title.append('Press ', dot(), ' anywhere on GitHub');
  const go = button('Sign in with GitHub', begin, { primary: true });
  go.classList.add('btn-big');
  const brand = el('p', 'brand');
  brand.append('git', el('b', null, 'chop'));
  return [
    brand,
    keycap(),
    title,
    el('p', 'lede', 'Your links and instant repository search, right over the page you are on.'),
    actions(go),
    el('p', 'fine', 'Signing in adds your private repositories to search, plus pull requests, news and backup. gitchop only reads your repositories, and talks to nobody but GitHub.'),
  ];
}

/**
 * The code, one character to a key, so it reads at a glance and types without a slip; blanks of
 * the same shape while GitHub is still handing it over, so nothing moves when it lands.
 * @param {string | null} code
 */
function codeKeys(code) {
  const row = el('div', 'code');
  const shown = code ?? '••••-••••';
  if (code) {
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', `Your code: ${code.split('').join(' ')}`);
  } else {
    row.setAttribute('aria-hidden', 'true');
    row.dataset.waiting = 'true';
  }
  for (const char of shown) {
    if (char === '-') row.append(el('span', 'code-gap', '–'));
    else row.append(el('span', 'code-key', code ? char : ''));
  }
  return row;
}

function copyButton() {
  const code = /** @type {SignInCode} */ (flow?.code);
  const copy = button('Copy code', async () => {
    try {
      await navigator.clipboard.writeText(code.userCode);
      copy.textContent = 'Copied';
      announce('Code copied.');
    } catch {
      copy.textContent = 'Copy failed';
    }
    setTimeout(() => {
      if (copy.isConnected) copy.textContent = 'Copy code';
    }, 1600);
  });
  copy.classList.add('copy');
  return copy;
}

/**
 * A network failure says so in plain words; GitHub's own reasons are kept as they are.
 * @param {string | undefined} reason
 */
function plainReason(reason) {
  if (!reason) return undefined;
  if (/fetch|network|internet|load failed/i.test(reason)) return 'gitchop could not reach GitHub. Check the connection and try again.';
  return reason;
}

/** The headline for each way a flow can end. */
const ENDED_TITLES = {
  expired: 'That code ran out',
  denied: 'Sign-in was declined',
  disabled: 'Sign-in isn’t available right now',
  error: 'Sign-in did not finish',
};

/** What to do about it, said under the headline; an error says its reason instead. */
const ENDED_LEDES = {
  expired: 'A code lasts fifteen minutes. Get a fresh one and type it on GitHub’s device page.',
  denied: 'GitHub was told not to let gitchop in. Try again if that was a slip.',
  disabled: 'GitHub has this way of signing in switched off for gitchop. Everything else works without it: your links and repository search are ready.',
};

function signInScreen() {
  paintSteps(1);
  if (!flow || flow.phase === 'starting' || flow.phase === 'code') {
    const code = flow?.phase === 'code' && flow.code ? flow.code : null;
    const open = linkButton('Open GitHub', code?.verificationUri ?? DEVICE_URL, { primary: true });
    const row = actions(open);
    if (code) row.append(copyButton());
    else {
      open.setAttribute('aria-disabled', 'true');
      open.tabIndex = -1;
      open.addEventListener('click', (event) => event.preventDefault());
    }
    const status = el('p', 'status');
    status.dataset.network = String(flow?.status === 'network');
    status.append(el('span', 'pulse'), el('span', 'status-line', code ? statusLine(flow) : 'Asking GitHub for a code…'));
    if (code) status.append(el('span', 'count', countdown(code.expiresAt)));
    return [
      el('h1', 'title', 'Enter this code on GitHub'),
      el('p', 'lede', 'Open GitHub, type the code, approve. This page carries on by itself.'),
      codeKeys(code ? code.userCode : null),
      row,
      status,
    ];
  }

  const { line, again, reason } = ending(flow);
  const parts = [el('h1', 'title', ENDED_TITLES[flow.phase] ?? ENDED_TITLES.error), el('p', 'lede', ENDED_LEDES[flow.phase] ?? plainReason(reason) ?? line)];
  if (flow.phase === 'disabled') {
    parts.push(actions(button('Continue without signing in', skip, { primary: true })));
    const token = el('p', 'fine');
    token.append('For private repositories, you can ', button('add a GitHub token in Settings', openSettings, { quiet: true }), ' instead.');
    parts.push(token);
  } else {
    parts.push(actions(button(again, begin, { primary: true })));
  }
  return parts;
}

/** @param {TokenView} app */
function reachedAll(app) {
  const { uncovered, reached } = ownerReach(sync, app, linkOwners);
  return uncovered.length === 0 && reached > 0;
}

/**
 * @param {string} owner
 * @param {'in' | 'token' | 'out'} reach
 * @param {string} detail
 */
function ownerRow(owner, reach, detail) {
  const item = el('li', 'owner');
  item.dataset.reach = reach;
  const mark = el('span', 'owner-mark', reach === 'out' ? '–' : '✓');
  mark.setAttribute('aria-hidden', 'true');
  item.append(mark, el('span', 'owner-name', `@${owner}`), el('span', 'owner-detail', detail));
  return item;
}

function accessScreen() {
  paintSteps(2);
  const app = appEntry(sync);
  const title = el('h1', 'title', 'Give gitchop access to your organisations');
  const who = el('p', 'lede');
  who.append('Signed in', app?.login ? ` as @${app.login}` : '', '. gitchop sees private repositories only in the accounts you install it on, and only reads them.');
  if (!app) return [title, who];

  if (app.installations === null || app.installations === undefined) {
    if (checking) {
      const asking = el('p', 'status');
      asking.append(el('span', 'pulse'), el('span', 'status-line', 'Asking GitHub where gitchop is installed…'));
      return [title, who, asking];
    }
    const network = Boolean(installError && /fetch|network|internet|load failed/i.test(installError));
    const lead = el('p', 'notice', installError ? (network ? 'gitchop could not reach GitHub just now.' : 'GitHub didn’t answer just now.') : 'gitchop hasn’t checked where it is installed yet.');
    if (installError) lead.title = installError;
    const aside = el('p', 'fine');
    aside.append(linkButton('Install on GitHub', INSTALL_URL, { quiet: true }));
    return [title, who, lead, actions(button(installError ? 'Try again' : 'Check now', checkInstallations, { primary: true })), aside];
  }

  const { installs, covered, uncovered, classic } = ownerReach(sync, app, linkOwners);
  const list = el('ul', 'owners');
  for (const install of installs) list.append(ownerRow(install.owner, 'in', install.selection === 'all' ? 'all repositories' : 'chosen repositories'));
  for (const owner of covered) list.append(ownerRow(owner, 'token', 'through a saved token'));
  for (const owner of uncovered) {
    const own = Boolean(app.login && owner.toLowerCase() === app.login.toLowerCase());
    let detail = classic ? 'through your classic token' : 'public repositories only';
    if (own) detail = `your account, ${detail}`;
    list.append(ownerRow(owner, 'out', detail));
  }

  if (reachedAll(app)) {
    return [title, who, list, actions(button('Continue', finish, { primary: true }), linkButton('Manage on GitHub', INSTALL_URL))];
  }
  return [
    title,
    who,
    list,
    actions(linkButton('Install on GitHub', INSTALL_URL, { primary: true })),
    el('p', 'fine', 'GitHub asks which accounts and repositories. In an organisation, an owner may need to approve.'),
  ];
}

function readyScreen() {
  paintSteps(skipped ? null : 3);
  const line = el('p', 'lede');
  line.append('Press ', dot(), ' on any GitHub page for your links and repository search', skipped ? '.' : ', with your pull requests beside them.');
  const go = linkButton('Open GitHub', GITHUB, { primary: true, newTab: false });
  go.classList.add('btn-big');
  return [keycap(), el('h1', 'title', 'You’re ready'), line, actions(go)];
}

/** @param {Screen} next */
function go(next) {
  screen = next;
  render({ focus: true });
}

/**
 * Asks for a code. The permission request is the first thing awaited: Firefox grants a prompt only
 * inside the click that asked for it.
 */
async function begin() {
  if (flow?.phase === 'starting') return;
  const ok = await requestAccess();
  if (!ok) {
    flow = { phase: 'error', interval: 5, error: 'gitchop needs access to github.com to sign in.' };
    go('signin');
    return;
  }
  flow = { phase: 'starting', interval: 5 };
  announce('Asking GitHub for a code.');
  go('signin');
  /** @type {SignInCode} */
  let code;
  try {
    code = await ask({ type: 'gitchop:signin:start' });
  } catch (error) {
    if (flow?.phase !== 'starting') return;
    flow = { phase: 'error', interval: 5, error: String(error.message ?? error) };
    announce(ending(flow).line);
    render({ focus: true });
    return;
  }
  if (flow?.phase !== 'starting') return;
  showCode(code);
  render({ focus: true });
}

/** @param {SignInCode} code */
function showCode(code) {
  flow = { phase: 'code', code, interval: code.interval, status: 'waiting' };
  announce(`Your sign-in code is ${code.userCode.split('').join(' ')}. It expires in ${minutesLeft(code.expiresAt)}. Type it on GitHub’s device page.`);
  schedule(code.interval);
  startTick();
}

function updateStatus() {
  const status = screenEl.querySelector('.status');
  const line = screenEl.querySelector('.status-line');
  if (!status || !line) return;
  /** @type {HTMLElement} */ (status).dataset.network = String(flow?.status === 'network');
  const text = statusLine(flow);
  if (line.textContent === text) return;
  line.textContent = text;
  announce(text);
}

async function pollOnce() {
  pollTimer = null;
  if (flow?.phase !== 'code') return;
  /** @type {Answer<'gitchop:signin:poll'>} */
  let reply;
  try {
    reply = await ask({ type: 'gitchop:signin:poll' });
  } catch {
    if (flow?.phase !== 'code') return;
    flow = afterLostPoll(flow);
    schedule(flow.interval);
    updateStatus();
    return;
  }
  if (flow?.phase !== 'code') return;
  const next = afterPoll(flow, reply);
  flow = next.flow;
  if (next.verdict === 'waiting' && flow) {
    schedule(flow.interval);
    updateStatus();
    return;
  }
  stopTimers();
  if (next.verdict === 'signed-in' || next.verdict === 'gone') {
    sync = reply.state ?? (await ask({ type: 'gitchop:sync:state' }).catch(() => sync));
    const app = appEntry(sync);
    if (app && !app.needsSignIn) {
      announce('Signed in with GitHub.');
      go('access');
      if (app.installations === null || app.installations === undefined) checkInstallations();
    } else go('hello');
    return;
  }
  announce(ending(flow).line);
  render({ focus: true });
}

async function checkInstallations() {
  if (checking) return;
  checking = true;
  installError = null;
  render();
  try {
    sync = await ask({ type: 'gitchop:signin:installations' });
  } catch (error) {
    installError = String(error.message ?? error);
  }
  checking = false;
  render({ focus: true });
}

/** Moving on without a sign-in: a code on screen is called off, and the welcome is put aside. */
async function skip() {
  orgsSkipped = false;
  if (flow) {
    stopTimers();
    flow = null;
    ask({ type: 'gitchop:signin:cancel' }).catch(() => {});
  }
  skipped = true;
  await ask({ type: 'gitchop:welcome:done' }).catch(() => {});
  go('ready');
}

async function finish() {
  skipped = false;
  const app = appEntry(sync);
  orgsSkipped = !(app && app.installations && reachedAll(app));
  await ask({ type: 'gitchop:welcome:done' }).catch(() => {});
  go('ready');
}

function openSettings() {
  ask({ type: 'gitchop:welcome:done' }).catch(() => {});
  api.runtime.openOptionsPage();
}

let away = false;
let lastReturnCheck = 0;

/**
 * Back from another tab — most often GitHub's install page — ask again where the app is
 * installed, at most once every few seconds, and redraw only when the answer changed.
 */
async function recheckOnReturn() {
  if (screen !== 'access' || checking) return;
  const app = appEntry(sync);
  if (!app || app.installations == null) return;
  if (Date.now() - lastReturnCheck < 5000) return;
  lastReturnCheck = Date.now();
  const before = JSON.stringify(app.installations);
  try {
    const result = await ask({ type: 'gitchop:signin:installations' });
    if (JSON.stringify(appEntry(result)?.installations ?? null) === before) return;
    sync = result;
    announce('Updated where gitchop is installed.');
    render();
  } catch {
    /* the list on screen stands */
  }
}

function back() {
  if (!away) return;
  away = false;
  setTimeout(recheckOnReturn, 600);
}

window.addEventListener('blur', () => {
  away = true;
});
window.addEventListener('focus', back);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') away = true;
  else back();
});
window.addEventListener('pagehide', () => stopTimers());
window.addEventListener('pageshow', (event) => {
  if (!event.persisted || flow?.phase !== 'code') return;
  startTick();
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollOnce, 0);
});

// The key does here what it will do on GitHub, as far as a page can show it: the cap goes down.
window.addEventListener('keydown', (event) => {
  if (event.key !== '.' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  for (const key of document.querySelectorAll('.keycap, .key')) {
    key.classList.remove('pressed');
    void (/** @type {HTMLElement} */ (key).offsetWidth);
    key.classList.add('pressed');
  }
});

/**
 * Where to start: a code a reload or another tab left showing, a sign-in already saved, or the
 * beginning. Each ask may fail without the page minding; the beginning is always there.
 */
async function start() {
  render({ focus: true });
  try {
    linkOwners = ownersFromLinks(await loadLinks());
  } catch {
    linkOwners = [];
  }
  try {
    sync = await ask({ type: 'gitchop:sync:state' });
  } catch {
    sync = null;
  }
  const app = appEntry(sync);
  if (app && !app.needsSignIn) {
    screen = 'access';
    render({ focus: true });
    if (app.installations === null || app.installations === undefined) checkInstallations();
    else recheckOnReturn();
    return;
  }
  try {
    const { code } = await ask({ type: 'gitchop:signin:pending' });
    if (code && !flow) {
      showCode(code);
      clearTimeout(pollTimer);
      pollTimer = setTimeout(pollOnce, 0);
      screen = 'signin';
      render({ focus: true });
    }
  } catch {
    /* no code to pick up */
  }
}

start();
