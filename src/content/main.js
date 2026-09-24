window.__gitchop = window.__gitchop || {};

(() => {
  const gc = window.__gitchop;
  if (gc.installed) return;
  gc.installed = true;

  const api = globalThis.browser ?? globalThis.chrome;

  const state = { open: false, stage: null, menu: null, lastFocus: null };

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

  async function ask(message) {
    try {
      return await api.runtime.sendMessage(message);
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
  let effects = gc.EFFECTS.sanitize();
  (async () => {
    try {
      const stored = await api.storage.sync.get(gc.EFFECTS.KEY);
      effects = gc.EFFECTS.sanitize(stored[gc.EFFECTS.KEY]);
    } catch {
      /* the defaults already loaded */
    }
  })();
  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[gc.EFFECTS.KEY]) return;
      effects = gc.EFFECTS.sanitize(changes[gc.EFFECTS.KEY].newValue);
    });
  } catch {
    /* this tab keeps whatever it loaded with */
  }

  function onResize() {
    if (state.open) closeChop();
  }

  async function openChop() {
    if (state.open) return;
    state.open = true;
    state.lastFocus = deepActiveElement();

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stage = gc.createStage({ reduced, effects });
    state.stage = stage;
    stage.chop();
    window.addEventListener('resize', onResize);

    // The pull requests, the news and the contributions answer from their snapshots, so this is
    // storage reads only; no request holds the menu up, and a background that cannot answer simply
    // means no column, and no number, this time.
    const [links, pulls, news, contributions, panel] = await Promise.all([
      readLinks(),
      ask({ type: 'gitchop:pulls' }),
      ask({ type: 'gitchop:news' }),
      ask({ type: 'gitchop:contributions' }),
      ask({ type: 'gitchop:panel' }),
    ]);
    if (state.stage !== stage) return;

    const ctx = gc.readContext();
    const menu = gc.createMenu({
      ctx,
      links,
      pulls: pulls?.ok ? pulls : null,
      news: news?.ok ? news : null,
      contributions: contributions?.ok ? contributions : null,
      panel: panel?.ok ? panel : null,
      onClose: closeChop,
      onOptions: () => {
        ask({ type: 'gitchop:options' });
        closeChop();
      },
    });
    state.menu = menu;

    stage.menuLayer.append(menu.element);
    // The gutter between the columns is the stage itself, and clicking it is clicking outside.
    stage.menuLayer.addEventListener('mousedown', (event) => {
      if (event.target === stage.menuLayer || event.target === menu.element) closeChop();
    });

    // The reels in the head roll once the panel is where the roll can be seen.
    stage.revealPanel(menu.element).then(() => {
      if (state.menu === menu) menu.revealed();
    });
    menu.focus();
  }

  function closeChop() {
    if (!state.open) return;
    const { stage, menu, lastFocus } = state;
    state.open = false;
    state.stage = null;
    state.menu = null;
    window.removeEventListener('resize', onResize);

    if (menu) stage.close();
    else stage?.destroy();

    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  }

  function onKeydown(event) {
    if (state.open) {
      // Anything from inside the overlay passes through; the host stops it escaping later.
      if (event.target === state.stage?.host) return;

      // Focus slipped back to the page, but the overlay is modal — GitHub gets nothing.
      if (event.key === 'Escape') closeChop();
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
})();
