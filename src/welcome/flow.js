import { loadLinks } from '../lib/links.js';
import { send } from '../lib/messages.js';
import { ownersFromLinks } from '../lib/repos.js';
import { DEVICE_URL, INSTALL_URL } from '../lib/signin.js';
import { afterLostPoll, afterPoll, appEntry, countdown, ending, minutesLeft, ownerReach, statusLine } from '../lib/signin-flow.js';

/** @import { Answer, Message, MessageType } from '../background/messages.js' */
/** @import { SignInCode } from '../background/signin.js' */
/** @import { SyncState, TokenView } from '../background/config.js' */
/** @import { Flow } from '../lib/signin-flow.js' */

/**
 * The welcome, one decision per screen: what signing in unlocks, the code and the way to GitHub's
 * page, the wait, the organisations, and the end. It is drawn in two places from this one module,
 * so the two cannot drift: the page of its own (src/welcome/welcome.html), which the toolbar
 * button and Settings open, and the "." overlay, where a new user meets it the first time they
 * press the key on GitHub. Each hands over an element to draw into and what is different about
 * it — how access is asked for, and where the welcome goes when it is finished or put aside.
 *
 * The sign-in is the Settings card's, through the same background messages and the same shared
 * pieces in src/lib/signin-flow.js: the welcome drives the polls while it is up, and the
 * background's alarm finishes a flow it was closed on. Leaving for GitHub's tab and coming back
 * loses nothing: the state is all here, and nothing closes the welcome but the user.
 */

const GITHUB = 'https://github.com/';

/** @typedef {'hello' | 'consent' | 'signin' | 'access' | 'ready'} Screen */

/**
 * What a place that shows the welcome says about itself.
 * - `variant`: the page of its own, or the overlay over GitHub, which already knows the key and
 *   drops into the menu at the end instead of saying where to press it.
 * - `at`: where to begin. `signin` asks for a code at once, for the overlay opened from the
 *   menu's sign-in row, whose click was the gesture. `consent` is the page opened by the overlay
 *   for the browser's question alone.
 * - `access`: asked inside the click on "Sign in with GitHub". `elsewhere` is the overlay finding
 *   the sign-in needs a browser prompt only an extension page can show.
 * - `onMenu`: the overlay's way out at the end, or past the sign-in: the menu, right there.
 * - `onEscape`: the overlay's Escape, and its close button.
 * - `onElsewhere`: the overlay opening the page at the browser's question; the overlay stays, and
 *   carries on when the user is back.
 * - `returnToOpener`: the page, once the question is answered, going back to the GitHub tab that
 *   opened it; false when there is none to go back to.
 * @typedef {{
 *   variant: 'page' | 'overlay',
 *   at?: 'hello' | 'signin' | 'consent',
 *   access: () => Promise<'granted' | 'denied' | 'elsewhere'>,
 *   onMenu?: () => void,
 *   onEscape?: () => void,
 *   onElsewhere?: () => void,
 *   returnToOpener?: () => Promise<boolean>,
 * }} WelcomeOptions
 */

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
  const node = /** @type {HTMLButtonElement} */ (el('button', quiet ? 'gw-quiet' : `gw-btn${primary ? ' gw-btn-primary' : ''}`, label));
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/**
 * A link that reads as a button: for what happens on GitHub. One that opens in a new tab leaves
 * the welcome where it is, which is what keeps a sign-in polling while the user approves.
 * @param {string} label
 * @param {string} href
 * @param {{ primary?: boolean, quiet?: boolean, newTab?: boolean }} [options]
 */
function linkButton(label, href, { primary = false, quiet = false, newTab = true } = {}) {
  const node = /** @type {HTMLAnchorElement} */ (el('a', quiet ? 'gw-quiet' : `gw-btn${primary ? ' gw-btn-primary' : ''}`, label));
  node.href = href;
  if (newTab) {
    node.target = '_blank';
    node.rel = 'noreferrer';
  }
  return node;
}

/** @param {Node[]} nodes */
function actions(...nodes) {
  const row = el('div', 'gw-actions');
  row.append(...nodes);
  return row;
}

/** The key itself, the one thing a new user must learn, on the line the chop cuts. */
function keycap() {
  const wrap = el('div', 'gw-hero-key');
  wrap.setAttribute('aria-hidden', 'true');
  const key = el('div', 'gw-keycap');
  key.append(el('span', 'gw-keycap-dot'));
  wrap.append(el('span', 'gw-blade'), key);
  return wrap;
}

/**
 * The dot as it sits in a sentence. A kbd cannot carry a name, so the key is hidden from screen
 * readers and its name is said in words beside it.
 */
function dot() {
  const wrap = document.createDocumentFragment();
  const key = el('kbd', 'gw-key', '.');
  key.setAttribute('aria-hidden', 'true');
  wrap.append(key, el('span', 'gw-visually-hidden', 'the dot key'));
  return wrap;
}

/** The name, as the head and the first screen set it. */
function wordmark(className) {
  const mark = el('p', className);
  mark.append('git', el('b', null, 'chop'));
  return mark;
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

/**
 * The welcome, drawn into an element of its own that the caller places: the page puts it in its
 * body, the overlay in its stage. `start` begins it; `destroy` stops its timers and listeners.
 * @param {WelcomeOptions} options
 */
export function createWelcome({ variant, at = 'hello', access, onMenu, onEscape, onElsewhere, returnToOpener }) {
  const overlay = variant === 'overlay';

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
  /**
   * Back from GitHub with a code on screen: the user has most likely just approved it, and until
   * GitHub has been asked, the screen says it is finishing by itself, so nobody wonders whether
   * there is something left to do.
   */
  let confirming = false;
  /** GitHub was asked after the user came back, and the code was still not approved. */
  let notApproved = false;
  /** Signed in a moment ago: the login, shown briefly before the organisations. */
  /** @type {string | null} */
  let connectedAs = null;
  /** @type {string | null} */
  let installError = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pollTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let tickTimer = null;
  let gone = false;
  /** The overlay has opened the page at the browser's question, and waits for the user back. */
  let handedOff = false;
  /** Back from that page without the question answered yes. */
  let notYet = false;
  /**
   * The browser's question is a step of its own, ahead of the sign-in, wherever it has to be asked
   * on a page of its own: the sign-in that follows it is the next step, not the same one again.
   */
  let asksFirst = at === 'consent';

  const root = el('div', 'gw');
  root.dataset.variant = variant;
  const top = el('header', 'gw-top');
  const stepsEl = el('ol', 'gw-steps');
  stepsEl.hidden = true;
  const topEnd = el('div', 'gw-top-end');
  if (overlay) {
    // Escape is not the only way out; a takeover with no visible door reads as a trap.
    const close = button('×', () => escape(), { quiet: true });
    close.className = 'gw-close';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close (Esc)';
    topEnd.append(close);
  }
  top.append(wordmark('gw-wordmark'), topEnd);
  const screenEl = el('main', 'gw-screen');
  screenEl.tabIndex = -1;
  const bottomEl = el('footer', 'gw-bottom');
  const announceEl = el('p', 'gw-visually-hidden');
  announceEl.setAttribute('role', 'status');
  announceEl.setAttribute('aria-live', 'polite');
  root.append(top, screenEl, bottomEl, announceEl);
  if (overlay) {
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Welcome to gitchop');
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
   * The few steps of the sign-in, as marks in the head: which one this is, of how many. None on the
   * first screen, which is not a step, nor at the end of the way without a sign-in. Organisations
   * passed by with "Skip for now" are marked skipped, not done.
   * @param {'allow' | 'signin' | 'orgs' | 'ready' | null} step
   */
  function paintSteps(step) {
    stepsEl.textContent = '';
    stepsEl.hidden = step === null;
    if (step === null) return;
    /** @type {['allow' | 'signin' | 'orgs' | 'ready', string][]} */
    const all = [
      ['allow', 'Allow'],
      ['signin', 'Sign in'],
      ['orgs', 'Organisations'],
      ['ready', 'Ready'],
    ];
    const steps = asksFirst ? all : all.slice(1);
    const here = steps.findIndex(([key]) => key === step);
    stepsEl.setAttribute('aria-label', `Step ${here + 1} of ${steps.length}`);
    steps.forEach(([key, name], index) => {
      const item = el('li', 'gw-step', name);
      item.dataset.state = index < here ? (key === 'orgs' && orgsSkipped ? 'skipped' : 'done') : index === here ? 'current' : 'todo';
      if (index === here) item.setAttribute('aria-current', 'step');
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
      const count = screenEl.querySelector('.gw-count');
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
    if (gone) return;
    // A redraw the user did not ask for — the organisations re-checked on the way back — must not
    // drop the focus out of the welcome with the button it was on, or Enter and Escape stop working.
    const scope = /** @type {Document | ShadowRoot} */ (root.getRootNode());
    const held = root.contains(scope.activeElement);
    screenEl.dataset.screen = screen;
    root.dataset.screen = screen;
    // The steps head the screen itself, right above its title, where the eye already is.
    screenEl.replaceChildren(stepsEl, ...contents());
    bottomEl.replaceChildren(...footer());
    if (focus || (held && !root.contains(scope.activeElement))) focusPrimary();
  }

  function focusPrimary() {
    // Over GitHub the first screen comes up under a hand that pressed "." for the menu and may be
    // typing a filter: an Enter or Space meant for that must not ask GitHub for a code. The
    // screen itself holds the focus, and the first Tab reaches "Sign in with GitHub".
    const quiet = overlay && screen === 'hello';
    const primary = quiet ? null : screenEl.querySelector('.gw-btn-primary:not([aria-disabled="true"])');
    /** @type {HTMLElement} */ (primary ?? screenEl).focus({ preventScroll: true });
  }

  /**
   * Over GitHub the welcome is modal, as the menu is: Tab and Shift+Tab wrap inside it, the close
   * button and the footer included, so focus never lands on the page behind, where every key is
   * swallowed but Escape.
   * @param {KeyboardEvent} event
   */
  function trapTab(event) {
    const stops = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('button, a[href]')]).filter(
      (stop) =>
        stop.tabIndex >= 0 &&
        !(/** @type {HTMLButtonElement} */ (stop).disabled) &&
        stop.getAttribute('aria-disabled') !== 'true' &&
        !stop.closest('[hidden]') &&
        stop.getClientRects().length > 0,
    );
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }
    const scope = /** @type {Document | ShadowRoot} */ (root.getRootNode());
    const active = /** @type {HTMLElement | null} */ (scope.activeElement);
    const here = active ? stops.indexOf(active) : -1;
    // On the screen itself, or anywhere in the welcome between stops, the browser's own order holds.
    if (here === -1 && active && root.contains(active)) return;
    const edge = event.shiftKey ? 0 : stops.length - 1;
    if (here !== -1 && here !== edge) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0].focus({ preventScroll: true });
  }

  /** @returns {Node[]} */
  function contents() {
    if (screen === 'consent') return consentScreen();
    if (screen === 'signin') return signInScreen();
    if (screen === 'access') return accessScreen();
    if (screen === 'ready') return readyScreen();
    return helloScreen();
  }

  /** @returns {Node[]} */
  function footer() {
    if (screen === 'hello') return [button('Continue without signing in', skip, { quiet: true })];
    if (screen === 'consent') return overlay ? [button('Continue without signing in', skip, { quiet: true })] : [button('Not now', notNow, { quiet: true })];
    if (screen === 'signin') return flow?.phase === 'disabled' || connectedAs ? [] : [button('Continue without signing in', skip, { quiet: true })];
    if (screen === 'access') {
      const app = appEntry(sync);
      const done = app && app.installations && reachedAll(app);
      return done ? [] : [button('Skip for now', finish, { quiet: true })];
    }
    if (overlay) return [];
    // Put aside, the sign-in is still one click away, in the same words the menu's quiet row uses.
    const settings = button('Settings', openSettings, { quiet: true });
    return skipped ? [button('Sign in to search your private repositories', begin, { quiet: true }), settings] : [settings];
  }

  /**
   * The first screen. On its own page it teaches the key; over GitHub the key has just been
   * pressed, so it says hello and what signing in is for, and nothing more.
   */
  function helloScreen() {
    paintSteps(null);
    const go = button('Sign in with GitHub', begin, { primary: true });
    go.classList.add('gw-btn-big');
    if (overlay) {
      return [
        el('h1', 'gw-title', 'Welcome to gitchop.'),
        el('p', 'gw-lede', 'Sign in with GitHub to unlock everything gitchop can do.'),
        actions(go),
      ];
    }
    const title = el('h1', 'gw-title');
    title.append('Press ', dot(), ' anywhere on GitHub');
    return [
      wordmark('gw-brand'),
      keycap(),
      title,
      el('p', 'gw-lede', 'Your links and instant repository search, right over the page you are on.'),
      actions(go),
      el('p', 'gw-fine', 'Sign in with GitHub to unlock everything gitchop can do.'),
    ];
  }

  /**
   * The browser's question, which only an extension page can put. Over GitHub: why a tab opens,
   * before it does, and a wait for the user to come back. On the page opened for it: the question
   * and nothing else, one click that asks it.
   */
  function consentScreen() {
    paintSteps('allow');
    if (!overlay) {
      const allow = button('Allow', begin, { primary: true });
      allow.classList.add('gw-btn-big');
      return [
        el('h1', 'gw-title', 'Allow gitchop to sign in'),
        el('p', 'gw-lede', 'Your browser needs your permission before gitchop can keep you signed in with GitHub.'),
        actions(allow),
      ];
    }
    const open = button('Ask again', handOff, { primary: true });
    const parts = [
      el('h1', 'gw-title', 'Allow gitchop to sign in'),
      el('p', 'gw-lede', 'Your browser needs your permission before gitchop can keep you signed in with GitHub.'),
      actions(open),
    ];
    if (notYet) parts.push(el('p', 'gw-notice', 'Permission was not given. Ask again, or continue without signing in.'));
    else if (handedOff) {
      const waiting = el('p', 'gw-status');
      waiting.append(el('span', 'gw-pulse'), el('span', 'gw-status-line', 'Waiting for your permission…'));
      parts.push(waiting);
    }
    return parts;
  }

  /**
   * The code, one character to a key, so it reads at a glance and types without a slip; blanks of
   * the same shape while GitHub is still handing it over, so nothing moves when it lands.
   * @param {string | null} code
   */
  function codeKeys(code) {
    const row = el('div', 'gw-code');
    const shown = code ?? '••••-••••';
    if (code) {
      row.setAttribute('role', 'img');
      row.setAttribute('aria-label', `Your code: ${code.split('').join(' ')}`);
    } else {
      row.setAttribute('aria-hidden', 'true');
      row.dataset.waiting = 'true';
    }
    for (const char of shown) {
      if (char === '-') row.append(el('span', 'gw-code-gap', '–'));
      else row.append(el('span', 'gw-code-key', code ? char : ''));
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
    return copy;
  }

  function signInScreen() {
    paintSteps('signin');
    if (connectedAs) {
      // The sign-in is done: its step is ticked off while the screen still says so.
      paintSteps('orgs');
      return [el('p', 'gw-done-mark', '✓'), el('h1', 'gw-title', 'Connected to GitHub'), el('p', 'gw-lede', `Signed in as @${connectedAs}.`)];
    }
    if (confirming && flow?.phase === 'code') {
      const status = el('p', 'gw-status');
      status.append(el('span', 'gw-pulse'), el('span', 'gw-status-line', 'Checking with GitHub…'));
      return [
        el('h1', 'gw-title', 'Finishing your sign-in'),
        el('p', 'gw-lede', 'gitchop is checking with GitHub that you approved the connection. This continues by itself.'),
        status,
      ];
    }
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
      const status = el('p', 'gw-status');
      status.dataset.network = String(flow?.status === 'network');
      status.append(el('span', 'gw-pulse'), el('span', 'gw-status-line', code ? waitingLine() : 'Asking GitHub for a code…'));
      if (code) status.append(el('span', 'gw-count', countdown(code.expiresAt)));
      // Typing a code into GitHub for something unfamiliar reads as a trick unless it says what
      // is being connected, what that may do, and how it is undone.
      return [
        el('h1', 'gw-title', 'Connect gitchop to your GitHub account'),
        el('p', 'gw-lede', 'Open GitHub and enter this code to approve the connection.'),
        codeKeys(code ? code.userCode : null),
        row,
        status,
        el(
          'p',
          'gw-fine',
          'gitchop connects through its own GitHub app, so it never sees your password. The app can read your repositories, issues and pull requests, but never change them, and keeps your settings backup in a secret gist. You can disconnect it at any time in your GitHub settings.',
        ),
      ];
    }

    const { line, again, reason } = ending(flow);
    const parts = [el('h1', 'gw-title', ENDED_TITLES[flow.phase] ?? ENDED_TITLES.error), el('p', 'gw-lede', ENDED_LEDES[flow.phase] ?? plainReason(reason) ?? line)];
    if (flow.phase === 'disabled') {
      parts.push(actions(button('Continue without signing in', skip, { primary: true })));
      const token = el('p', 'gw-fine');
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
    const item = el('li', 'gw-owner');
    item.dataset.reach = reach;
    const mark = el('span', 'gw-owner-mark', reach === 'out' ? '–' : '✓');
    mark.setAttribute('aria-hidden', 'true');
    item.append(mark, el('span', 'gw-owner-name', `@${owner}`), el('span', 'gw-owner-detail', detail));
    return item;
  }

  function accessScreen() {
    paintSteps('orgs');
    const app = appEntry(sync);
    const title = el('h1', 'gw-title', 'Give gitchop access to your organisations');
    const who = el('p', 'gw-lede');
    who.append('Signed in', app?.login ? ` as @${app.login}` : '', '. gitchop sees private repositories only in the accounts you install it on, and only reads them.');
    if (!app) return [title, who];

    if (app.installations === null || app.installations === undefined) {
      if (checking) {
        const asking = el('p', 'gw-status');
        asking.append(el('span', 'gw-pulse'), el('span', 'gw-status-line', 'Asking GitHub where gitchop is installed…'));
        return [title, who, asking];
      }
      const network = Boolean(installError && /fetch|network|internet|load failed/i.test(installError));
      const lead = el('p', 'gw-notice', installError ? (network ? 'gitchop could not reach GitHub just now.' : 'GitHub didn’t answer just now.') : 'gitchop hasn’t checked where it is installed yet.');
      if (installError) lead.title = installError;
      const aside = el('p', 'gw-fine');
      aside.append(linkButton('Install on GitHub', INSTALL_URL, { quiet: true }));
      return [title, who, lead, actions(button(installError ? 'Try again' : 'Check now', checkInstallations, { primary: true })), aside];
    }

    const { installs, covered, uncovered, classic } = ownerReach(sync, app, linkOwners);
    const list = el('ul', 'gw-owners');
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
      el('p', 'gw-fine', 'GitHub asks which accounts and repositories. In an organisation, an owner may need to approve.'),
    ];
  }

  /**
   * The end. On its own page it says where to press the key; over GitHub the menu is the next
   * thing, one Enter away.
   */
  function readyScreen() {
    paintSteps(skipped ? null : 'ready');
    if (overlay) {
      const go = button('Open the menu', () => onMenu?.(), { primary: true });
      go.classList.add('gw-btn-big');
      return [el('h1', 'gw-title', 'You’re ready'), el('p', 'gw-lede', readyLine()), actions(go)];
    }
    const line = el('p', 'gw-lede');
    line.append('Press ', dot(), ' on any GitHub page for your links and repository search', skipped ? '.' : ', with your pull requests beside them.');
    const go = linkButton('Open GitHub', GITHUB, { primary: true, newTab: false });
    go.classList.add('gw-btn-big');
    return [keycap(), el('h1', 'gw-title', 'You’re ready'), line, actions(go)];
  }

  /**
   * What the end can promise over GitHub, where the menu is the next thing: private repositories
   * in search only where gitchop is installed. Past the organisations with none, a sign-in alone
   * searches nothing private, and the menu must not be opened on a promise it cannot keep.
   */
  function readyLine() {
    if (skipped) return 'Your links and repository search are one press away.';
    if (!orgsSkipped) return 'Your private repositories are in search now.';
    const app = appEntry(sync);
    const installed = app ? ownerReach(sync, app, linkOwners).installs.length : 0;
    if (installed > 0) return 'Private repositories are in search for the accounts gitchop is installed on. Settings › Sign-in adds more.';
    return 'You’re signed in. Install gitchop on an account to add its private repositories to search; Settings › Sign-in has the way.';
  }

  /** @param {Screen} next */
  function go(next) {
    screen = next;
    render({ focus: true });
  }

  /**
   * Asks for a code. The access check is the first thing awaited: Firefox grants a prompt only
   * inside the click that asked for it.
   */
  async function begin() {
    if (flow?.phase === 'starting') return;
    const verdict = await access();
    if (gone) return;
    if (verdict === 'elsewhere') {
      // The click on "Sign in with GitHub" goes straight to the browser's question, on gitchop's
      // own page; asked again after a no, the screen here says so first.
      flow = null;
      if (overlay && !handedOff) {
        handOff();
        go('consent');
        return;
      }
      notYet = handedOff;
      go('consent');
      return;
    }
    if (verdict === 'denied') {
      flow = { phase: 'error', interval: 5, error: 'gitchop needs access to github.com to sign in.' };
      go('signin');
      return;
    }
    // The page opened for the question alone hands the user back, where the overlay carries on —
    // but only once the background agrees the question is answered, or the two would ask in turn
    // for ever. Otherwise, and with no GitHub tab to go back to, the sign-in is carried out here.
    if (!overlay && screen === 'consent') {
      const answered = await ask({ type: 'gitchop:signin:access' }).then(
        (reply) => reply.granted,
        () => false,
      );
      if (answered && (await returnToOpener?.())) return;
      if (gone) return;
    }
    await startCode();
  }

  /** The overlay opens the page at the question, and stays, waiting for the user to be back. */
  function handOff() {
    handedOff = true;
    asksFirst = true;
    notYet = false;
    onElsewhere?.();
    render({ focus: true });
  }

  /** The page's "Not now": back to GitHub with nothing asked, or to the beginning with no tab to go back to. */
  async function notNow() {
    if (await returnToOpener?.()) return;
    if (!gone) go('hello');
  }

  /**
   * Back in the GitHub tab from the question: answered yes, the sign-in carries on right here —
   * picking up a code or a sign-in the page went on to make itself, if it did.
   */
  async function recheckConsent() {
    if (screen !== 'consent' || !handedOff || gone) return;
    const verdict = await access();
    if (gone || screen !== 'consent') return;
    if (verdict !== 'granted') {
      notYet = true;
      render();
      return;
    }
    if (await resume()) return;
    await startCode();
  }

  /** Asks GitHub for a code and shows it. */
  async function startCode() {
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
    if (flow?.phase !== 'starting' || gone) return;
    showCode(code);
    render({ focus: true });
  }

  /** @param {SignInCode} code */
  function showCode(code) {
    flow = { phase: 'code', code, interval: code.interval, status: 'waiting' };
    confirming = false;
    notApproved = false;
    announce(`Your sign-in code is ${code.userCode.split('').join(' ')}. It expires in ${minutesLeft(code.expiresAt)}. Type it on GitHub’s device page.`);
    schedule(code.interval);
    startTick();
  }

  /** The line under the code: GitHub out of reach, or still waiting — and after a check that found nothing, says so. */
  function waitingLine() {
    if (flow?.status !== 'network' && notApproved) return 'Not approved yet. Enter the code on GitHub to continue.';
    return statusLine(flow);
  }

  function updateStatus() {
    const status = screenEl.querySelector('.gw-status');
    const line = screenEl.querySelector('.gw-status-line');
    if (!status || !line) return;
    /** @type {HTMLElement} */ (status).dataset.network = String(flow?.status === 'network');
    const text = waitingLine();
    if (line.textContent === text) return;
    line.textContent = text;
    announce(text);
  }

  async function pollOnce() {
    pollTimer = null;
    if (flow?.phase !== 'code' || gone) return;
    /** @type {Answer<'gitchop:signin:poll'>} */
    let reply;
    try {
      reply = await ask({ type: 'gitchop:signin:poll' });
    } catch {
      if (flow?.phase !== 'code' || gone) return;
      flow = afterLostPoll(flow);
      schedule(flow.interval);
      updateStatus();
      return;
    }
    if (flow?.phase !== 'code' || gone) return;
    // Checking after a return: a pending GitHub was not yet asked for proves nothing, so the
    // check goes on, a second at a time, until GitHub's own interval lets it ask.
    if (confirming && reply.status === 'pending' && reply.early) {
      pollTimer = setTimeout(pollOnce, 1000);
      return;
    }
    const next = afterPoll(flow, reply);
    flow = next.flow;
    if (next.verdict === 'waiting' && flow) {
      schedule(flow.interval);
      if (confirming) {
        // GitHub answered and the code is not approved: the code comes back, with a line saying so.
        confirming = false;
        notApproved = flow.status !== 'network';
        render({ focus: true });
        if (notApproved) announce(waitingLine());
      } else updateStatus();
      return;
    }
    stopTimers();
    confirming = false;
    if (next.verdict === 'signed-in' || next.verdict === 'gone') {
      sync = reply.state ?? (await ask({ type: 'gitchop:sync:state' }).catch(() => sync));
      const app = appEntry(sync);
      if (app && !app.needsSignIn) {
        if (app.installations === null || app.installations === undefined) checkInstallations();
        // A beat on "Connected" first, so the move to the next step reads as the result of the
        // approval rather than as something that happened on its own.
        connectedAs = app.login ?? 'you';
        announce(`Connected to GitHub. Signed in as ${connectedAs}.`);
        render();
        setTimeout(() => {
          connectedAs = null;
          if (!gone && screen === 'signin') go('access');
        }, 1400);
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

  /** Calls off a code on screen: the background drops the flow, and the alarm with it. */
  function cancelFlow() {
    if (!flow) return;
    stopTimers();
    flow = null;
    ask({ type: 'gitchop:signin:cancel' }).catch(() => {});
  }

  /**
   * Moving on without a sign-in: a code on screen is called off, and the welcome is put aside.
   * Over GitHub, that is straight into the menu.
   */
  async function skip() {
    orgsSkipped = false;
    cancelFlow();
    skipped = true;
    await ask({ type: 'gitchop:welcome:done' }).catch(() => {});
    if (overlay) onMenu?.();
    else go('ready');
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
    ask({ type: 'gitchop:options' }).catch(() => {});
  }

  let away = false;
  let lastReturnCheck = 0;

  /**
   * Back from another tab — most often GitHub's install page — ask again where the app is
   * installed, at most once every few seconds, and redraw only when the answer changed.
   */
  async function recheckOnReturn() {
    if (screen !== 'access' || checking || gone) return;
    const app = appEntry(sync);
    if (!app || app.installations == null) return;
    if (Date.now() - lastReturnCheck < 5000) return;
    lastReturnCheck = Date.now();
    const before = JSON.stringify(app.installations);
    try {
      const result = await ask({ type: 'gitchop:signin:installations' });
      if (gone || JSON.stringify(appEntry(result)?.installations ?? null) === before) return;
      sync = result;
      announce('Updated where gitchop is installed.');
      render();
    } catch {
      /* the list on screen stands */
    }
  }

  /**
   * Back from GitHub's device page: the poll that is due is asked now rather than at the end of
   * its interval, so the approval shows the moment the user is looking again. Never sooner than
   * the background allows, which keeps to GitHub's interval whoever asks.
   */
  function pollOnReturn() {
    if (flow?.phase !== 'code' || !pollTimer) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollOnce, 0);
  }

  function back() {
    if (!away) return;
    away = false;
    if (flow?.phase === 'code' && screen === 'signin' && pollTimer) {
      confirming = true;
      notApproved = false;
      render();
    }
    pollOnReturn();
    recheckConsent();
    setTimeout(recheckOnReturn, 600);
  }

  const onBlur = () => {
    away = true;
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') away = true;
    else back();
  };
  const onPageHide = () => stopTimers();
  /** @param {PageTransitionEvent} event */
  const onPageShow = (event) => {
    if (!event.persisted || flow?.phase !== 'code') return;
    startTick();
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollOnce, 0);
  };

  /**
   * On its own page the key does what it will do on GitHub, as far as a page can show it: the cap
   * goes down. Over GitHub, Escape puts the welcome aside.
   * @param {KeyboardEvent} event
   */
  const onKey = (event) => {
    if (overlay) {
      if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        trapTab(event);
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      escape();
      return;
    }
    if (event.key !== '.' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    for (const key of root.querySelectorAll('.gw-keycap, .gw-key')) {
      key.classList.remove('pressed');
      void (/** @type {HTMLElement} */ (key).offsetWidth);
      key.classList.add('pressed');
    }
  };

  /**
   * Escape over GitHub, or the close button: the caller closes the overlay and calls abandon. The
   * welcome is not put aside, so the next press greets again.
   */
  function escape() {
    onEscape?.();
  }

  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', back);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  (overlay ? root : window).addEventListener('keydown', /** @type {EventListener} */ (onKey));

  /**
   * Where to start: a code a reload or another tab left showing, a sign-in already saved, or the
   * beginning — or, from the menu's sign-in row, a code asked for at once. Each ask may fail
   * without the welcome minding; the beginning is always there.
   */
  async function start() {
    if (at === 'signin' || at === 'consent') screen = at;
    render({ focus: true });
    // The page opened for the browser's question asks it and nothing else.
    if (at === 'consent') return;
    try {
      linkOwners = ownersFromLinks(await loadLinks());
    } catch {
      linkOwners = [];
    }
    if (gone) return;
    if (await resume()) return;
    if (at === 'signin' && !flow && !gone) begin();
  }

  /**
   * A sign-in already saved, or a code another tab left showing, picked up where it is.
   * @returns {Promise<boolean>} whether there was one
   */
  async function resume() {
    try {
      sync = await ask({ type: 'gitchop:sync:state' });
    } catch {
      sync = null;
    }
    if (gone) return true;
    const app = appEntry(sync);
    if (app && !app.needsSignIn) {
      stopTimers();
      flow = null;
      screen = 'access';
      render({ focus: true });
      if (app.installations === null || app.installations === undefined) checkInstallations();
      else recheckOnReturn();
      return true;
    }
    try {
      const { code } = await ask({ type: 'gitchop:signin:pending' });
      if (code && !flow && !gone) {
        showCode(code);
        clearTimeout(pollTimer);
        pollTimer = setTimeout(pollOnce, 0);
        screen = 'signin';
        render({ focus: true });
        return true;
      }
    } catch {
      /* no code to pick up */
    }
    return gone;
  }

  /** Gone from the screen: nothing of it may keep ticking or listening. */
  function destroy() {
    gone = true;
    stopTimers();
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', back);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    (overlay ? root : window).removeEventListener('keydown', /** @type {EventListener} */ (onKey));
  }

  /**
   * Put aside part way, by Escape or the close button: a code on screen is called off, as
   * "Continue without signing in" does. Left to the alarm, it would finish a sign-in out of
   * sight, past the organisations it needs, with nothing to say so.
   */
  function abandon() {
    if (!gone) cancelFlow();
    destroy();
  }

  return {
    element: root,
    start,
    /** Focus to where Enter goes on, for a caller that placed the element after start. */
    focus: focusPrimary,
    abandon,
    destroy,
  };
}
