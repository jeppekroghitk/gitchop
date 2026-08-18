window.__gitchop = window.__gitchop || {};

(() => {
  const gc = window.__gitchop;
  if (gc.installed) return;
  gc.installed = true;

  const api = globalThis.browser ?? globalThis.chrome;

  const state = { open: false, stage: null, menu: null, lastFocus: null };

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

  function onResize() {
    if (state.open) closeChop();
  }

  async function openChop() {
    if (state.open) return;
    state.open = true;
    state.lastFocus = deepActiveElement();

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stage = gc.createStage({ reduced });
    state.stage = stage;
    stage.chop();
    window.addEventListener('resize', onResize);

    const links = await readLinks();
    if (state.stage !== stage) return;

    const ctx = gc.readContext();
    const menu = gc.createMenu({
      ctx,
      links,
      onClose: closeChop,
      onOptions: () => {
        ask({ type: 'gitchop:options' });
        closeChop();
      },
    });
    state.menu = menu;

    stage.menuLayer.append(menu.element);
    stage.menuLayer.addEventListener('mousedown', (event) => {
      if (event.target === stage.menuLayer) closeChop();
    });

    stage.revealPanel(menu.element);
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

  window.addEventListener('keydown', onKeydown, true);
})();
