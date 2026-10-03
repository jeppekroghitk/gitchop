/** The panel's list: the saved links, the commands, a repository's insides, and following any of them. */
import { api, isSafeUrl } from '../../lib/links.js';
import { repoFromUrl, resolveUrl } from '../context.js';
import { node } from '../dom.js';
import { note, opensElsewhere, section } from './parts.js';

/** Where you can land inside a repository, likeliest first. */
const IN_REPO = [
  ['🔀', 'Pull requests', 'pulls'],
  ['🐛', 'Issues', 'issues'],
];

/**
 * @param {import('../menu.js').Menu} menu
 * @param {import('../../lib/links.js').Link[]} links
 */
export function createList(menu, links) {
  const { ctx, state } = menu;
  const { filter, list } = menu.el;
  let current = links.slice();

  /**
   * Commands live in the list rather than as buttons, so they are reachable by typing. The
   * repository you are standing on rarely has a row of its own — the default links point inside
   * it, not at it — so subscribing to it is a command here rather than a level down.
   */
  const ACTIONS = [
    { icon: '＋', label: 'Add this page', keywords: 'add save bookmark current page', run: () => menu.form.open() },
    { icon: '⚙', label: 'Settings', keywords: 'settings manage options edit reorder remove delete sync', run: () => menu.onOptions?.() },
  ];

  function actions() {
    const list = ACTIONS.slice();
    if (menu.news.on() && ctx.repoFull) list.splice(1, 0, menu.news.subscribeEntry(ctx.repoFull, ctx.repoFull));
    return list;
  }

  function linkEntries(query) {
    const needle = query.toLowerCase();
    return current
      .map((link) => {
        const resolved = resolveUrl(link.url, ctx);
        const usable = resolved.missing.length === 0 && isSafeUrl(resolved.url);
        return {
          usable,
          url: resolved.url,
          icon: link.icon || '·',
          label: link.label || link.url,
          reason: usable ? '' : `needs ${resolved.missing.map((key) => `{${key}}`).join(' ') || 'a valid url'}`,
          tip: usable ? resolved.url : '',
          repo: usable ? repoFromUrl(resolved.url) : null,
        };
      })
      .filter((entry) => !needle || `${entry.label} ${entry.url}`.toLowerCase().includes(needle));
  }

  function actionEntries(query) {
    const needle = query.toLowerCase();
    return actions()
      .filter((action) => !needle || `${action.label} ${action.keywords}`.toLowerCase().includes(needle))
      .map((action) => ({
        usable: true,
        url: '',
        icon: action.icon,
        label: action.label,
        reason: '',
        tip: '',
        repo: null,
        run: action.run,
      }));
  }

  /** The places inside a repository, and — with the news on — whether its days land in the column. */
  function drillEntries() {
    const entries = IN_REPO.map(([icon, label, path]) => ({
      usable: true,
      url: new URL(`${encodeURIComponent(state.drill.repo).replace(/%2F/g, '/')}/${path}`, 'https://github.com/').href,
      icon,
      label,
      reason: '',
      tip: '',
      repo: null,
    }));
    if (menu.news.on()) entries.push(menu.news.subscribeEntry(state.drill.repo, ''));
    return entries;
  }

  function enterDrill(repo) {
    state.drill = { repo, backIndex: state.activeIndex };
    state.activeIndex = 0;
    render();
  }

  function leaveDrill() {
    if (!state.drill) return false;
    const { backIndex } = state.drill;
    state.drill = null;
    state.activeIndex = backIndex;
    render();
    return true;
  }

  /**
   * Navigating in this tab dismisses the overlay first. The page load is not gitchop's wait,
   * and leaving the menu up through it made an instant Enter look like it was blocked on the
   * repository search still spinning underneath.
   */
  function open(entry, newTab) {
    if (!entry) return;
    if (entry.run) {
      entry.run();
      return;
    }
    if (!entry.usable) return;
    if (newTab) {
      window.open(entry.url, '_blank', 'noopener');
      return;
    }
    menu.dismiss();
    window.location.assign(entry.url);
  }

  function addItem(entry) {
    const row = node('li');
    row.setAttribute('role', 'option');

    // One gate for every row, whatever built it: nothing becomes clickable without passing the
    // scheme check. Repository results and in-repo destinations come from GitHub's API and from
    // string building, and "probably fine" is not a place to put an href.
    const interactive = entry.usable && !entry.run && isSafeUrl(entry.url);
    const item = node(interactive ? 'a' : 'div', 'gc-item');
    if (interactive) /** @type {HTMLAnchorElement} */ (item).href = entry.url;
    else if (!entry.usable) item.dataset.blocked = 'true';
    if (entry.owned) item.dataset.owned = 'true';
    if (entry.tip) item.title = entry.tip;

    // A chevron means there is a level underneath; a plain arrow means Enter is the end of it.
    let tail;
    if (!entry.usable) {
      tail = node('span', 'gc-reason', entry.reason);
    } else {
      tail = node('span', 'gc-tail', entry.repo ? '›' : '→');
      if (entry.repo) {
        tail.title = `Places inside ${entry.repo}`;
        tail.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          enterDrill(entry.repo);
        });
      }
    }
    item.append(node('span', 'gc-icon', entry.icon), node('span', 'gc-label', entry.label), tail);

    const index = state.items.length;
    const activate = () => {
      if (state.activeIndex === index) return;
      state.activeIndex = index;
      menu.keyboard.paint();
    };
    item.addEventListener('mousemove', activate);
    item.addEventListener('focus', activate);
    item.addEventListener('click', (event) => {
      if (entry.run) {
        event.preventDefault();
        entry.run();
        return;
      }
      // Let the anchor navigate, but get the overlay out of the way of the page load.
      if (opensElsewhere(event)) return;
      menu.dismiss();
    });

    state.items.push({ entry, item });
    row.append(item);
    list.append(row);
  }

  /**
   * The one quiet row at the foot of the list while there is nothing to search private
   * repositories with: it opens the welcome, where the sign-in is, and its cross waves it away for
   * good. Last, under everything, so the links stay where they always are.
   */
  function addHint() {
    const entry = {
      usable: true,
      url: '',
      icon: '🔑',
      label: 'Sign in to search your private repositories',
      reason: '',
      tip: '',
      repo: null,
      hint: true,
      run: () => menu.onWelcome?.(),
    };
    addItem(entry);
    const item = /** @type {HTMLElement} */ (state.items[state.items.length - 1].item);
    item.dataset.hint = 'true';
    const close = node('button', 'gc-hint-close', '✕');
    close.type = 'button';
    close.title = 'Hide this';
    close.setAttribute('aria-label', 'Hide the sign-in hint');
    close.tabIndex = -1;
    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideHint();
    });
    item.lastElementChild?.replaceWith(close);
  }

  /** Waves the sign-in row away for good: its cross with the mouse, Delete or Backspace with the keys. */
  function hideHint() {
    if (!menu.hint) return;
    menu.hint = false;
    menu.onHintDismiss?.();
    render();
  }

  function render() {
    list.textContent = '';
    state.items = [];

    if (state.drill) {
      list.append(section(state.drill.repo));
      for (const entry of drillEntries()) addItem(entry);
      state.activeIndex = Math.max(0, Math.min(state.activeIndex, state.items.length - 1));
      menu.keyboard.paint();
      return;
    }

    const query = filter.value.trim();
    // The repository block is reserved from the first character, not the third, so crossing the
    // search threshold changes what is in it and never how tall the panel is.
    const typing = query.length > 0;
    const found = linkEntries(query);
    const actions = actionEntries(query);
    const labelled = [found.length > 0, actions.length > 0, typing].filter(Boolean).length > 1;

    for (const entry of found) addItem(entry);

    if (actions.length > 0) {
      if (labelled) list.append(section('Do'));
      for (const entry of actions) addItem(entry);
    }

    if (typing) menu.search.appendResults(query);

    if (state.items.length === 0 && !typing) {
      list.append(note('No links yet.'));
    }

    if (menu.hint && !typing) addHint();

    state.activeIndex = Math.max(0, Math.min(state.activeIndex, state.items.length - 1));
    menu.keyboard.paint();
  }

  function move(delta) {
    if (state.items.length === 0) return;
    state.activeIndex = (state.activeIndex + delta + state.items.length) % state.items.length;
    menu.keyboard.paint();
  }

  async function persist(next) {
    const previous = current;
    current = next;
    render();
    try {
      await api.storage.sync.set({ links: current });
      menu.onLinksChanged?.(current);
    } catch (error) {
      // Storage refused it — quota, most likely. Put the list back.
      current = previous;
      render();
      console.error('gitchop: could not save link', error);
    }
  }

  return {
    render,
    addItem,
    move,
    open,
    enterDrill,
    leaveDrill,
    persist,
    hideHint,
    /** The links as they stand, the one just saved included. */
    links: () => current,
    /** The row the cursor is on in the panel, if there is one. */
    active: () => state.items[state.activeIndex]?.entry,
  };
}
