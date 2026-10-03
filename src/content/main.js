import { api } from '../lib/links.js';
import { KEY as EFFECTS_KEY, sanitize as sanitizeEffects } from '../lib/effects.js';
import { send } from '../lib/messages.js';
import { CONFIG_KEY, WELCOMED_KEY } from '../background/keys.js';
import { onPress } from '../lib/welcome.js';
import { createWelcome } from '../welcome/flow.js';
import WELCOME_CSS from '../welcome/flow.css';
import { createStage } from './chop.js';
import { readContext } from './context.js';
import { createMenu } from './menu.js';

/**
 * Once per world, however many times the script is run into it. The mark is a property under a
 * registered symbol on the content script's own global — Firefox's sandbox, Chrome's isolated
 * world — not an attribute on the page: an attribute would be GitHub's to see, and would outlive
 * this copy of the extension, so one reloaded under an open tab would find it and stand down. A
 * plain Symbol() would be a new one on every run, and the registry's is the same one each time.
 * The global rather than `window`, which in Firefox is the page's window seen through a wrapper.
 */
const INSTALLED = Symbol.for('gitchop.installed');
if (!(/** @type {Record<symbol, unknown>} */ (globalThis))[INSTALLED]) {
  Object.defineProperty(globalThis, INSTALLED, { value: true });
  install();
}

/** @import { Message, MessageType, Reply } from '../background/messages.js' */

function install() {
  /**
   * @type {{
   *   open: boolean,
   *   stage: ReturnType<typeof createStage> | null,
   *   menu: ReturnType<typeof createMenu> | null,
   *   welcome: ReturnType<typeof createWelcome> | null,
   *   lastFocus: HTMLElement | null,
   * }}
   */
  const state = { open: false, stage: null, menu: null, welcome: null, lastFocus: null };
  /**
   * The welcome on its way out to the menu, which it stays up for until the menu's data is in.
   * @type {ReturnType<typeof createWelcome> | null}
   */
  let leaving = null;

  /**
   * The dot is claimed here, before a single extension API is touched — onKeydown is hoisted, so
   * this is the first thing that runs. Everything below can fail and the key still opens the
   * menu; registering last meant a throw on the way down (storage gone, permissions changed, the
   * add-on reloaded under an open tab) left the page with no listener at all, and the extension
   * looked dead rather than degraded.
   */
  window.addEventListener('keydown', onKeydown, true);

  function deepActiveElement() {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }

  function isEditable(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.isContentEditable) return true;
    const tag = element.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    const role = element.getAttribute?.('role');
    return role === 'textbox' || role === 'searchbox';
  }

  /**
   * @template {MessageType} T
   * @param {Message<T>} message
   * @returns {Promise<Reply<T> | null | undefined>}
   */
  async function ask(message) {
    try {
      return await send(message);
    } catch {
      return null;
    }
  }

  async function readLinks() {
    try {
      const stored = await api.storage.sync.get('links');
      return Array.isArray(stored.links) ? stored.links : [];
    } catch {
      return [];
    }
  }

  // The chop must start the instant the key goes down, so the effect settings are read once up
  // front and kept fresh, never awaited in the keypress path. Both halves are guarded: settings
  // the tab cannot reach cost the user their settings, never the chop itself.
  let effects = sanitizeEffects();
  (async () => {
    try {
      const stored = await api.storage.sync.get(EFFECTS_KEY);
      effects = sanitizeEffects(stored[EFFECTS_KEY]);
    } catch {
      /* the defaults already loaded */
    }
  })();
  // Whether the next press is owed the welcome — a user who has neither signed in, nor saved a
  // token, nor put the welcome aside — read up front and kept fresh the same way, so the chop
  // never waits on it. The mark is read straight from storage, so a tab of a user who has been
  // welcomed never wakes the background to ask; only a tab that may owe it asks, once, and again
  // when a token arrives or leaves. Until the first answer is in it is null, and a press then
  // takes the answer the menu's own data carries (see onPress in src/lib/welcome.js). Each read
  // is numbered, and only the newest may land: an older one that went the long way round must
  // not put back a welcome that a newer read, or this tab, has since settled.
  /** @type {boolean | null} */
  let owed = null;
  let owedRead = 0;
  // Once the menu has been shown in this tab, the welcome never follows it here.
  let menuSeen = false;
  /** @param {boolean} value */
  function settleOwed(value) {
    owedRead += 1;
    owed = value;
  }
  async function readOwed() {
    const read = ++owedRead;
    let next = false;
    try {
      const stored = await api.storage.local.get(WELCOMED_KEY);
      if (stored[WELCOMED_KEY] !== true) {
        const answer = await ask({ type: 'gitchop:welcome' });
        next = Boolean(answer?.ok && answer.first);
      }
    } catch {
      /* not owed: the menu is always the safe answer */
    }
    if (read === owedRead) owed = next;
  }
  readOwed();
  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[WELCOMED_KEY] || changes[CONFIG_KEY])) readOwed();
      if (area !== 'sync' || !changes[EFFECTS_KEY]) return;
      effects = sanitizeEffects(changes[EFFECTS_KEY].newValue);
    });
    // The background writes the news edition a repository at a time, under this key in local
    // storage. A menu that is up repaints from the background's answer as each lands, so the
    // column fills section by section instead of standing as skeletons until the last one is in.
    // The pull requests the same way: a snapshot the alarm or Settings wrote while the menu is up
    // is painted into it, so what left is seen to leave whoever asked.
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !state.open) return;
      const { menu } = state;
      if (!menu) return;
      if (changes.newsCache) {
        ask({ type: 'gitchop:news' }).then((news) => {
          if (state.menu === menu && news?.ok) menu.updateNews(news);
        });
      }
      if (changes.pullsCache) {
        ask({ type: 'gitchop:pulls' }).then((pulls) => {
          if (state.menu === menu && pulls?.ok) menu.updatePulls(pulls);
        });
      }
      // And what GitHub said was left of its budgets, read off every answer: the gauge follows.
      if (changes.rateCache) {
        ask({ type: 'gitchop:rate' }).then((rate) => {
          if (state.menu === menu && rate?.ok) menu.updateRate(rate);
        });
      }
    });
  } catch {
    /* this tab keeps whatever it loaded with */
  }

  function onResize() {
    // The welcome lays itself out again at any size, and may be halfway through a sign-in.
    if (state.open && !state.welcome) closeChop();
  }

  /**
   * The pull requests, the news and the contributions answer from their snapshots, so this is
   * storage reads only; no request holds the menu up, and a background that cannot answer simply
   * means no column, and no number, this time.
   */
  async function loadMenu() {
    const [links, pulls, news, contributions, rate, panel, welcome] = await Promise.all([
      readLinks(),
      ask({ type: 'gitchop:pulls' }),
      ask({ type: 'gitchop:news' }),
      ask({ type: 'gitchop:contributions' }),
      ask({ type: 'gitchop:rate' }),
      ask({ type: 'gitchop:panel' }),
      ask({ type: 'gitchop:welcome' }),
    ]);
    return { links, pulls, news, contributions, rate, panel, welcome };
  }

  async function openChop() {
    if (state.open) return;
    state.open = true;
    state.lastFocus = /** @type {HTMLElement | null} */ (deepActiveElement());
    // Decided now, from what was read up front: nothing is awaited between the key and the blade.
    const verdict = onPress({ owed, menuSeen });

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stage = createStage({ reduced, effects });
    state.stage = stage;
    stage.chop();
    window.addEventListener('resize', onResize);

    if (verdict === 'welcome') {
      showWelcome('hello');
      return;
    }
    const data = await loadMenu();
    if (state.stage !== stage) return;
    // Pressed before the tab had heard: the menu's data carries the same answer, read while the
    // blade was already moving, so nothing waited on it and the welcome still comes first.
    if (verdict === 'ask' && data.welcome?.ok && data.welcome.first) {
      showWelcome('hello');
      return;
    }
    showMenu(data);
  }

  /**
   * The menu, risen into the cut — or, after the welcome, into the place the welcome left.
   * @param {Awaited<ReturnType<typeof loadMenu>>} data
   * @param {{ now?: boolean }} [options]
   */
  function showMenu({ links, pulls, news, contributions, rate, panel, welcome }, { now = false } = {}) {
    const stage = /** @type {NonNullable<typeof state.stage>} */ (state.stage);
    menuSeen = true;
    const ctx = readContext();
    const menu = createMenu({
      ctx,
      links,
      pulls: pulls?.ok ? pulls : null,
      news: news?.ok ? news : null,
      contributions: contributions?.ok ? contributions : null,
      rate: rate?.ok ? rate : null,
      panel: panel?.ok ? panel : null,
      onClose: closeChop,
      onOptions: () => {
        ask({ type: 'gitchop:options' });
        closeChop();
      },
      // Nothing to search private repositories with yet: the list ends in one quiet row that says so.
      hint: welcome?.ok ? welcome.hint : false,
      // The row's sign-in happens right here: the menu makes way for the welcome, at its code.
      onWelcome: () => {
        if (state.menu !== menu) return;
        state.menu = null;
        menu.closed();
        menu.element.remove();
        menu.gauge.remove();
        showWelcome('signin', { now: true });
      },
      onHintDismiss: () => {
        ask({ type: 'gitchop:welcome:hint:dismiss' });
      },
    });
    state.menu = menu;

    // The gauge sits in the layer's corner, not in the menu's flow, so the panel's rise leaves it be.
    stage.menuLayer.append(menu.element, menu.gauge);
    // The gutter between the columns is the stage itself, and clicking it is clicking outside.
    stage.menuLayer.addEventListener('mousedown', (event) => {
      if (state.menu !== menu) return;
      if (event.target === stage.menuLayer || event.target === menu.element) closeChop();
    });

    // The reels in the head roll once the panel is where the roll can be seen.
    stage.revealPanel(menu.element, { now }).then(() => {
      if (state.menu === menu) menu.revealed();
    });
    menu.focus();
  }

  /**
   * The welcome, in place of the menu and filling the stage: for a new user's first press, or
   * from the menu's sign-in row, which starts at the code. Its styles join the menu's in the
   * shadow root the first time it is shown, so the page's styles neither reach it nor feel it.
   * @param {'hello' | 'signin'} at
   * @param {{ now?: boolean }} [options]
   */
  function showWelcome(at, { now = false } = {}) {
    const stage = /** @type {NonNullable<typeof state.stage>} */ (state.stage);
    if (!stage.shadow.querySelector('style[data-welcome]')) {
      const style = document.createElement('style');
      style.dataset.welcome = '';
      style.textContent = WELCOME_CSS;
      stage.shadow.append(style);
    }
    const welcome = createWelcome({
      variant: 'overlay',
      at,
      // A content script cannot show the browser's prompt; when one is still needed, the welcome
      // says so and, on the user's click, opens its page at that one question. The overlay stays
      // up meanwhile, and carries on when the user is back.
      access: async () => {
        const answer = await ask({ type: 'gitchop:signin:access' });
        return answer?.ok && !answer.granted ? 'elsewhere' : 'granted';
      },
      onMenu: () => menuAfterWelcome(welcome),
      onEscape: closeChop,
      onElsewhere: () => {
        ask({ type: 'gitchop:welcome:open', at: 'consent' });
      },
    });
    state.welcome = welcome;
    settleOwed(false);
    stage.menuLayer.append(welcome.element);
    stage.revealPanel(welcome.element, { now });
    welcome.start();
  }

  /**
   * Finished, or put aside: the welcome goes and the menu rises in its place, from a fresh read,
   * so a sign-in just made shows in it.
   * @param {ReturnType<typeof createWelcome>} welcome
   */
  async function menuAfterWelcome(welcome) {
    const { stage } = state;
    if (!stage || state.welcome !== welcome || leaving === welcome) return;
    // The welcome stays up, Escape and all, until the menu's data is in: a background slow to wake
    // must not leave a screen that answers nothing.
    leaving = welcome;
    const data = await loadMenu();
    if (state.stage !== stage || state.welcome !== welcome) return;
    state.welcome = null;
    welcome.destroy();
    welcome.element.remove();
    showMenu(data, { now: true });
  }

  function closeChop() {
    if (!state.open) return;
    const { stage, menu, welcome, lastFocus } = state;
    state.open = false;
    state.stage = null;
    state.menu = null;
    state.welcome = null;
    window.removeEventListener('resize', onResize);

    // However the welcome was left — Escape, or its close button — it is not shown again, and a
    // code it was showing is called off.
    if (welcome) {
      welcome.abandon();
      settleOwed(false);
      ask({ type: 'gitchop:welcome:done' });
    }
    menu?.closed();
    if (menu || welcome) /** @type {NonNullable<typeof stage>} */ (stage).close();
    else stage?.destroy();

    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  }

  function onKeydown(event) {
    if (state.open) {
      // Anything from inside the overlay passes through; the host stops it escaping later.
      if (event.target === state.stage?.host) return;

      // Focus slipped back to the page, but the overlay is modal — GitHub gets nothing.
      // Tab brings focus back in, so Escape is not the only key left.
      if (event.key === 'Escape') closeChop();
      else if (event.key === 'Tab') (state.welcome ?? state.menu)?.focus();
      event.stopImmediatePropagation();
      if (!event.metaKey && !event.ctrlKey && !event.altKey) event.preventDefault();
      return;
    }
    if (event.key !== '.' || event.repeat || event.isComposing) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditable(event.target) || isEditable(deepActiveElement())) return;

    // GitHub binds "." to github.dev. This listener is registered at document_start on window
    // in the capture phase, so it runs before the page's own, and claims the key outright.
    event.preventDefault();
    event.stopImmediatePropagation();
    openChop();
  }
}
