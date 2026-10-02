/**
 * Where the cursor is and how the keys move it: within the panel's list, across to the pull
 * requests and back, and the strip under the panel that says which keys do what from there.
 */
import { node } from '../dom.js';

/** @param {import('../menu.js').Menu} menu */
export function createKeyboard(menu) {
  const { state, hasPanel } = menu;
  const { panel, filter, keys, stage, pullsList } = menu.el;

  /** The columns the cursor can be in, left to right; the news is not one, being read with the mouse. */
  function regions() {
    const order = hasPanel ? ['panel'] : [];
    if (menu.pulls.visible() && state.pullsItems.length > 0) order.push('pulls');
    return order;
  }

  /**
   * The strip under the panel says what the keys do from wherever the cursor is — the column
   * included, so it has no strip of its own. Only the keys worth telling: moving up and down is
   * not one of them. A pair with no key is a plain word.
   */
  function hint(...pairs) {
    keys.textContent = '';
    for (const [key, label] of pairs) {
      const group = node('span', 'gc-hint');
      if (key) group.append(node('kbd', 'gc-key', key));
      group.append(document.createTextNode(label));
      keys.append(group);
    }
  }

  function paint() {
    const { items, activeIndex, pullsItems, pullsIndex, region, drill } = state;
    items.forEach(({ item }, index) => {
      item.dataset.active = String(index === activeIndex);
    });
    if (region === 'panel') items[activeIndex]?.item.scrollIntoView({ block: 'nearest' });

    pullsItems.forEach(({ item }, index) => {
      item.dataset.active = String(index === pullsIndex);
    });
    if (region === 'pulls') pullsItems[pullsIndex]?.item.scrollIntoView({ block: 'nearest' });
    menu.pulls.placePop();

    const across = regions().includes('pulls');
    if (region === 'pulls') hint(['enter', 'open'], ['←', 'back'], [null, 'type to search']);
    else if (drill) hint(['enter', 'open'], ['←', 'back']);
    else if (items[activeIndex]?.entry.repo) hint(['enter', 'open'], ['→', 'inside'], ...(across ? [['tab', 'pull requests']] : []));
    else hint(['enter', 'open'], ...(across ? [['→', 'pull requests']] : []), ['esc', 'close']);
  }

  function toPulls() {
    if (!menu.pulls.visible() || state.pullsItems.length === 0) return;
    state.region = 'pulls';
    stage.dataset.region = state.region;
    /** @type {HTMLElement} */ (pullsList).focus({ preventScroll: true });
    paint();
  }

  function toPanel() {
    if (!hasPanel) return;
    state.region = 'panel';
    stage.dataset.region = state.region;
    filter.focus({ preventScroll: true });
    paint();
  }

  /** Tab walks the columns left to right and wraps; Shift+Tab walks back. */
  function cycle(delta) {
    const order = regions();
    const next = order[(order.indexOf(state.region) + delta + order.length) % order.length];
    if (next === 'pulls') toPulls();
    else toPanel();
  }

  /**
   * Keys while a side column has the cursor. The arrow that points at the panel comes back to
   * it; anything printable hands the key to the filter: focus moves during keydown, so the
   * character itself arrives there — you are never stuck in a column, you just start typing and
   * you are searching.
   */
  function sideKeys(event, { back, move, current }) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === back) {
      event.preventDefault();
      toPanel();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      menu.list.open(current(), event.metaKey || event.ctrlKey || event.shiftKey);
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) toPanel();
  }

  function pullsKeys(event) {
    sideKeys(event, { back: 'ArrowLeft', move: menu.pulls.move, current: () => state.pullsItems[state.pullsIndex]?.entry });
  }

  // Clicking dead space in either column must not drop focus to the page, where GitHub's
  // single-key shortcuts would start listening again. The count in the head is dead space too:
  // it is for looking at.
  stage.addEventListener('mousedown', (event) => {
    if (/** @type {Element} */ (event.target).closest?.('input, button, a[href]')) return;
    event.preventDefault();
  });

  /** Tab stays inside the panel: it wraps at both ends instead of reaching the page behind. */
  function trapTab(event) {
    const stops = /** @type {HTMLElement[]} */ ([...panel.querySelectorAll('input, a[href], button')]).filter((stop) => !stop.hidden);
    if (stops.length === 0) return;
    const here = stops.indexOf(/** @type {HTMLElement} */ (/** @type {ShadowRoot} */ (panel.getRootNode()).activeElement));
    const edge = event.shiftKey ? 0 : stops.length - 1;
    if (here !== edge) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0].focus();
  }

  stage.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (state.form) menu.form.close();
      else if (hasPanel && state.region !== 'panel') toPanel();
      else if (!menu.list.leaveDrill()) menu.onClose();
      return;
    }
    // With a column on screen, Tab crosses the gutter — left to right, wrapping at the end, and
    // Shift+Tab back; without one, it wraps inside the panel as it always has.
    if (event.key === 'Tab') {
      if (!state.form && regions().length > 1) {
        event.preventDefault();
        cycle(event.shiftKey ? -1 : 1);
      } else {
        trapTab(event);
      }
      return;
    }
    if (state.form) return;
    if (state.region === 'pulls') {
      pullsKeys(event);
      return;
    }
    menu.search.settle();

    // Right only takes over once the caret has nowhere left to go, so it still moves the
    // cursor through what you have typed. On a repository row it goes inside; on any other row
    // it crosses to the pull requests, and Left in that column comes back.
    if (event.key === 'ArrowRight' && !state.drill) {
      const atEnd = filter.selectionStart === filter.value.length && filter.selectionStart === filter.selectionEnd;
      if (!atEnd) return;
      const entry = menu.list.active();
      if (entry?.repo) {
        event.preventDefault();
        menu.list.enterDrill(entry.repo);
      } else if (menu.pulls.visible() && state.pullsItems.length > 0) {
        event.preventDefault();
        toPulls();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && state.drill) {
      event.preventDefault();
      menu.list.leaveDrill();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      menu.list.move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      menu.list.move(-1);
      return;
    }
    if (event.key === 'Enter' && /** @type {ShadowRoot} */ (panel.getRootNode()).activeElement === filter) {
      event.preventDefault();
      menu.list.open(menu.list.active(), event.metaKey || event.ctrlKey || event.shiftKey);
    }
  });

  filter.addEventListener('focus', () => {
    if (state.region === 'panel') return;
    state.region = 'panel';
    stage.dataset.region = state.region;
    paint();
  });

  return { paint, toPulls, toPanel };
}
