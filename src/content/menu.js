window.__gitchop = window.__gitchop || {};

(() => {
  const gc = window.__gitchop;
  const api = globalThis.browser ?? globalThis.chrome;

  const SEARCH_AFTER = 3;
  const SEARCH_DELAY = 300;

  /**
   * How long to let typing settle before the list is rebuilt. Long enough that "e", "ec", "eco"
   * is one visual change rather than three, short enough to be imperceptible once you stop. The
   * network wait is separate and longer — the panel settles well before a request goes out.
   */
  const SETTLE = 110;

  /**
   * The repository area is always exactly this many rows tall while a search is on, filled with
   * skeletons or blanks, so the panel does not resize when results land under the cursor.
   */
  const REPO_SLOTS = 5;
  const GHOST_WIDTHS = ['62%', '47%', '71%', '54%', '43%'];

  /** Where you can land inside a repository, likeliest first. */
  const IN_REPO = [
    ['🔀', 'Pull requests', 'pulls'],
    ['🐛', 'Issues', 'issues'],
  ];

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function defaultLabel() {
    return document.title.replace(/\s*[·|—-]\s*GitHub\s*$/i, '').trim().slice(0, 80);
  }

  gc.createMenu = function createMenu({ ctx, links, onClose, onOptions, onLinksChanged }) {
    const panel = node('div', 'gc-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'gitchop links');

    const head = node('div', 'gc-head');
    const wordmark = node('span', 'gc-wordmark');
    wordmark.append(document.createTextNode('git'), node('b', null, 'chop'));
    head.append(wordmark, node('span', 'gc-context', ctx.repoFull || 'github.com'));

    const filter = node('input', 'gc-filter');
    filter.type = 'text';
    filter.placeholder = 'Filter links, or search repositories…';
    filter.autocomplete = 'off';
    filter.spellcheck = false;
    filter.setAttribute('aria-label', 'Filter links or search repositories');

    const list = node('ul', 'gc-list');
    list.setAttribute('role', 'listbox');

    const keys = node('span', 'gc-keys');
    const foot = node('div', 'gc-foot');
    foot.append(keys);

    panel.append(head, filter, list, foot);

    let current = links.slice();
    let items = [];
    let activeIndex = 0;
    let form = null;
    // Both result sets carry the query they belong to, so a render can never mix a fresh query
    // with results computed for an older one.
    let repos = { query: '', status: 'idle', results: [], error: '' };
    let mine = { query: '', results: [] };
    let searchTimer = null;
    let searchRun = 0;
    let settleTimer = null;
    let localRun = 0;
    let drill = null;

    /** Commands live in the list rather than as buttons, so they are reachable by typing. */
    const ACTIONS = [
      { icon: '＋', label: 'Add this page', keywords: 'add save bookmark current page', run: () => openForm() },
      { icon: '⚙', label: 'Settings', keywords: 'settings manage options edit reorder remove delete sync', run: () => onOptions?.() },
    ];

    function linkEntries(query) {
      const needle = query.toLowerCase();
      return current
        .map((link) => {
          const resolved = gc.resolveUrl(link.url, ctx);
          const usable = resolved.missing.length === 0 && gc.isSafeUrl(resolved.url);
          return {
            usable,
            url: resolved.url,
            icon: link.icon || '·',
            label: link.label || link.url,
            reason: usable ? '' : `needs ${resolved.missing.map((key) => `{${key}}`).join(' ') || 'a valid url'}`,
            tip: usable ? resolved.url : '',
            repo: usable ? gc.repoFromUrl(resolved.url) : null,
          };
        })
        .filter((entry) => !needle || `${entry.label} ${entry.url}`.toLowerCase().includes(needle));
    }

    function actionEntries(query) {
      const needle = query.toLowerCase();
      return ACTIONS.filter((action) => !needle || `${action.label} ${action.keywords}`.toLowerCase().includes(needle)).map(
        (action) => ({
          usable: true,
          url: '',
          icon: action.icon,
          label: action.label,
          reason: '',
          tip: '',
          repo: null,
          run: action.run,
        }),
      );
    }

    function repoEntry(repo) {
      return {
        usable: gc.isSafeUrl(repo.url),
        url: repo.url,
        icon: repo.private ? '◆' : '◇',
        label: repo.fullName,
        reason: '',
        tip: [repo.description, repo.archived ? '(archived)' : ''].filter(Boolean).join(' ') || repo.url,
        repo: repo.fullName,
        owned: repo.owned,
      };
    }

    function drillEntries() {
      return IN_REPO.map(([icon, label, path]) => ({
        usable: true,
        url: new URL(`${encodeURIComponent(drill.repo).replace(/%2F/g, '/')}/${path}`, 'https://github.com/').href,
        icon,
        label,
        reason: '',
        tip: '',
        repo: null,
      }));
    }

    function cancelSearch() {
      clearTimeout(searchTimer);
      searchRun += 1;
    }

    function enterDrill(repo) {
      drill = { repo, backIndex: activeIndex };
      activeIndex = 0;
      render();
    }

    function leaveDrill() {
      if (!drill) return false;
      const { backIndex } = drill;
      drill = null;
      activeIndex = backIndex;
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
      cancelSearch();
      onClose();
      window.location.assign(entry.url);
    }

    function paint() {
      items.forEach(({ item }, index) => {
        item.dataset.active = String(index === activeIndex);
      });
      items[activeIndex]?.item.scrollIntoView({ block: 'nearest' });

      if (drill) keys.textContent = '↑↓ move · ↵ open · ← back';
      else if (items[activeIndex]?.entry.repo) keys.textContent = '↑↓ move · → inside · ↵ open';
      else keys.textContent = '↑↓ move · ↵ open · esc close';
    }

    function section(title) {
      return node('li', 'gc-section', title);
    }

    function note(text) {
      return node('li', 'gc-note', text);
    }

    /** Row-shaped shimmer standing in for a result that has not arrived yet. */
    function skeletons(count) {
      for (let slot = 0; slot < count; slot += 1) {
        const row = node('li');
        const item = node('div', 'gc-item gc-item--ghost');
        const bar = node('span', 'gc-bar');
        bar.style.width = GHOST_WIDTHS[slot % GHOST_WIDTHS.length];
        item.append(node('span', 'gc-icon'), bar, node('span', 'gc-tail'));
        row.append(item);
        list.append(row);
      }
    }

    function addItem(entry) {
      const row = node('li');
      row.setAttribute('role', 'option');

      // One gate for every row, whatever built it: nothing becomes clickable without passing the
      // scheme check. Repository results and in-repo destinations come from GitHub's API and from
      // string building, and "probably fine" is not a place to put an href.
      const interactive = entry.usable && !entry.run && gc.isSafeUrl(entry.url);
      const item = node(interactive ? 'a' : 'div', 'gc-item');
      if (interactive) item.href = entry.url;
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

      const index = items.length;
      const activate = () => {
        if (activeIndex === index) return;
        activeIndex = index;
        paint();
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
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
        cancelSearch();
        onClose();
      });

      items.push({ entry, item });
      row.append(item);
      list.append(row);
    }

    function render() {
      list.textContent = '';
      items = [];

      if (drill) {
        list.append(section(drill.repo));
        for (const entry of drillEntries()) addItem(entry);
        activeIndex = Math.max(0, Math.min(activeIndex, items.length - 1));
        paint();
        return;
      }

      const query = filter.value.trim();
      // The repository block is reserved from the first character, not the third, so crossing the
      // search threshold changes what is in it and never how tall the panel is.
      const typing = query.length > 0;
      const found = linkEntries(query);
      const actions = actionEntries(query);
      const labelled = [found.length > 0, actions.length > 0, typing].filter(Boolean).length > 1;

      if (found.length > 0) {
        if (labelled) list.append(section('Links'));
        for (const entry of found) addItem(entry);
      }

      if (actions.length > 0) {
        if (labelled) list.append(section('Do'));
        for (const entry of actions) addItem(entry);
      }

      if (typing) {
        list.append(section('Repositories'));

        const local = mine.query === query ? mine.results : [];
        const seen = new Set(local.map((repo) => repo.fullName.toLowerCase()));
        const remote = (repos.query === query ? repos.results : []).filter(
          (repo) => !seen.has(repo.fullName.toLowerCase()),
        );
        const results = [...local, ...remote].slice(0, REPO_SLOTS);
        const pending = query.length >= SEARCH_AFTER && repos.query !== query;

        for (const repo of results) addItem(repoEntry(repo));

        if (query.length < SEARCH_AFTER && results.length === 0) list.append(note('keep typing to search…'));
        else if (pending && results.length < REPO_SLOTS) skeletons(REPO_SLOTS - results.length);
        else if (repos.status === 'error' && results.length === 0) list.append(note(repos.error));
        else if (results.length === 0) list.append(note('no repositories found'));
      }

      if (items.length === 0 && !typing) {
        list.append(note('No links yet.'));
      }

      activeIndex = Math.max(0, Math.min(activeIndex, items.length - 1));
      paint();
    }

    function scheduleSearch() {
      clearTimeout(searchTimer);
      const query = filter.value.trim();
      if (query.length < SEARCH_AFTER) {
        repos = { query: '', status: 'idle', results: [], error: '' };
        return;
      }

      const run = ++searchRun;
      searchTimer = setTimeout(async () => {
        let next;
        try {
          const response = await api.runtime.sendMessage({ type: 'gitchop:repos', query });
          if (!response?.ok) throw new Error(response?.error ?? 'The search did not answer.');
          next = { query, status: 'done', results: response.results ?? [], error: '' };
        } catch (error) {
          next = { query, status: 'error', results: [], error: String(error.message ?? error) };
        }
        // A later keystroke, or a navigation, already owns the results.
        if (run !== searchRun) return;
        repos = next;
        render();
      }, SEARCH_DELAY);
    }

    /** The local index answers in a millisecond or two, so it is read before every rebuild. */
    async function readMine(query) {
      const run = ++localRun;
      if (query.length < 2) {
        mine = { query: '', results: [] };
        return;
      }
      try {
        const response = await api.runtime.sendMessage({ type: 'gitchop:repos:mine', query });
        if (run !== localRun) return;
        mine = { query, results: response?.ok ? response.results ?? [] : [] };
      } catch {
        if (run !== localRun) return;
        mine = { query, results: [] };
      }
    }

    function move(delta) {
      if (items.length === 0) return;
      activeIndex = (activeIndex + delta + items.length) % items.length;
      paint();
    }

    async function persist(next) {
      const previous = current;
      current = next;
      render();
      try {
        await api.storage.sync.set({ links: current });
        onLinksChanged?.(current);
      } catch (error) {
        // Storage refused it — quota, most likely. Put the list back.
        current = previous;
        render();
        console.error('gitchop: could not save link', error);
      }
    }

    function closeForm() {
      form?.remove();
      form = null;
      filter.hidden = false;
      filter.focus();
    }

    function openForm() {
      if (form) return;
      filter.hidden = true;

      form = node('div', 'gc-form');
      const icon = node('input');
      icon.placeholder = '🔗';
      icon.maxLength = 4;
      icon.setAttribute('aria-label', 'Icon');

      const label = node('input');
      label.placeholder = 'Label';
      label.value = defaultLabel();
      label.setAttribute('aria-label', 'Label');

      const url = node('input', 'gc-form-url');
      url.value = location.href;
      url.setAttribute('aria-label', 'URL');

      const save = node('button', 'gc-btn gc-btn--primary', 'Save');
      const cancel = node('button', 'gc-btn', 'Cancel');
      const actions = node('div', 'gc-form-actions');
      actions.append(cancel, save);

      form.append(icon, label, url, actions);
      panel.insertBefore(form, list);

      const submit = async () => {
        const value = url.value.trim();
        if (!value || !gc.isSafeUrl(value.replace(/\{(\w+)\}/g, 'x'))) {
          url.focus();
          url.select();
          return;
        }
        const link = {
          id: crypto.randomUUID(),
          icon: icon.value.trim().slice(0, 4),
          label: label.value.trim().slice(0, 80) || value,
          url: value,
        };
        closeForm();
        filter.value = '';
        cancelSearch();
        repos = { status: 'idle', results: [], owners: [], error: '' };
        await persist([...current, link]);
      };

      save.addEventListener('click', submit);
      cancel.addEventListener('click', closeForm);
      form.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });

      label.focus();
      label.select();
    }

    filter.addEventListener('input', () => {
      // Typing is a new search, so it always comes back out of a repository.
      drill = null;
      activeIndex = 0;
      scheduleSearch();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(async () => {
        settleTimer = null;
        await readMine(filter.value.trim());
        render();
      }, SETTLE);
    });

    /** Any key that acts on the list needs the list to match what has been typed. */
    function settle() {
      if (!settleTimer) return;
      clearTimeout(settleTimer);
      settleTimer = null;
      render();
    }

    // Clicking dead space in the panel must not drop focus to the page, where GitHub's
    // single-key shortcuts would start listening again.
    panel.addEventListener('mousedown', (event) => {
      if (event.target.closest?.('input, button, a')) return;
      event.preventDefault();
    });

    /** Tab stays inside the panel: it wraps at both ends instead of reaching the page behind. */
    function trapTab(event) {
      const stops = [...panel.querySelectorAll('input, a[href], button')].filter((stop) => !stop.hidden);
      if (stops.length === 0) return;
      const here = stops.indexOf(panel.getRootNode().activeElement);
      const edge = event.shiftKey ? 0 : stops.length - 1;
      if (here !== edge) return;
      event.preventDefault();
      stops[event.shiftKey ? stops.length - 1 : 0].focus();
    }

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (form) closeForm();
        else if (!leaveDrill()) onClose();
        return;
      }
      if (event.key === 'Tab') {
        trapTab(event);
        return;
      }
      if (form) return;
      settle();

      // Right only takes over once the caret has nowhere left to go, so it still moves the
      // cursor through what you have typed.
      if (event.key === 'ArrowRight' && !drill) {
        const atEnd = filter.selectionStart === filter.value.length && filter.selectionStart === filter.selectionEnd;
        const entry = items[activeIndex]?.entry;
        if (atEnd && entry?.repo) {
          event.preventDefault();
          enterDrill(entry.repo);
        }
        return;
      }
      if (event.key === 'ArrowLeft' && drill) {
        event.preventDefault();
        leaveDrill();
        return;
      }

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
      if (event.key === 'Enter' && panel.getRootNode().activeElement === filter) {
        event.preventDefault();
        open(items[activeIndex]?.entry, event.metaKey || event.ctrlKey || event.shiftKey);
      }
    });

    render();

    return {
      element: panel,
      focus() {
        filter.focus();
      },
    };
  };
})();
