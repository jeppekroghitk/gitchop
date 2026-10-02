/** The repository search under the links: the local index on every rebuild, GitHub once typing rests. */
import { isSafeUrl } from '../../lib/links.js';
import { send } from '../../lib/messages.js';
import { REPO_LIMIT } from '../../lib/repos.js';
import { note, section, skeletons } from './parts.js';
import { orderRepos } from './rows.js';

const SEARCH_AFTER = 3;
const SEARCH_DELAY = 300;

/**
 * How long to let typing settle before the list is rebuilt. Long enough that "e", "ec", "eco"
 * is one visual change rather than three, short enough to be imperceptible once you stop. The
 * network wait is separate and longer — the panel settles well before a request goes out.
 */
const SETTLE = 110;

/**
 * Rows under Repositories, and the skeletons standing in for them: the same ten the background
 * asks for. The repository area is always exactly this many rows tall while a search is on,
 * filled with skeletons or blanks, so the panel does not resize when results land under the
 * cursor.
 */
const REPO_SLOTS = REPO_LIMIT;

/** @import { Repo } from '../../lib/repos.js' */
/** @import { Menu } from '../menu.js' */

/** @param {Repo} repo */
function repoEntry(repo) {
  return {
    usable: isSafeUrl(repo.url),
    url: repo.url,
    icon: repo.private ? '◆' : '◇',
    label: repo.fullName,
    reason: '',
    tip: [repo.description, repo.archived ? '(archived)' : ''].filter(Boolean).join(' ') || repo.url,
    repo: repo.fullName,
    owned: repo.owned,
  };
}

/** @param {Menu} menu */
export function createSearch(menu) {
  const { state } = menu;
  const { filter, list } = menu.el;

  // Both result sets carry the query they belong to, so a render can never mix a fresh query
  // with results computed for an older one.
  /** @type {{ query: string, status: 'idle' | 'done' | 'error', results: Repo[], error: string }} */
  let repos = { query: '', status: 'idle', results: [], error: '' };
  /** @type {{ query: string, results: Repo[] }} */
  let mine = { query: '', results: [] };
  /** @type {number | null} */
  let searchTimer = null;
  let searchRun = 0;
  /** @type {number | null} */
  let settleTimer = null;
  let localRun = 0;

  function cancelSearch() {
    clearTimeout(searchTimer);
    searchRun += 1;
  }

  /**
   * The Repositories block of the list, for what has been typed: results, skeletons, or a word on why not.
   * @param {string} query
   */
  function appendResults(query) {
    list.append(section('Repositories'));

    const local = mine.query === query ? mine.results : [];
    const remote = repos.query === query ? repos.results : [];
    const results = orderRepos(query, local, remote, REPO_SLOTS);
    const pending = query.length >= SEARCH_AFTER && repos.query !== query;

    for (const repo of results) menu.list.addItem(repoEntry(repo));

    if (query.length < SEARCH_AFTER && results.length === 0) list.append(note('keep typing to search…'));
    else if (pending && results.length < REPO_SLOTS) skeletons(REPO_SLOTS - results.length, list);
    else if (repos.status === 'error' && results.length === 0) list.append(note(repos.error));
    else if (results.length === 0) list.append(note('no repositories found'));
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
      /** @type {typeof repos} */
      let next;
      try {
        const response = await send({ type: 'gitchop:repos', query });
        if (!response?.ok) throw new Error(response?.error ?? 'The search did not answer.');
        next = { query, status: 'done', results: response.results ?? [], error: '' };
      } catch (error) {
        next = { query, status: 'error', results: [], error: String(error.message ?? error) };
      }
      // A later keystroke, or a navigation, already owns the results.
      if (run !== searchRun) return;
      repos = next;
      menu.list.render();
    }, SEARCH_DELAY);
  }

  /**
   * The local index answers in a millisecond or two, so it is read before every rebuild.
   * @param {string} query
   */
  async function readMine(query) {
    const run = ++localRun;
    if (query.length < 2) {
      mine = { query: '', results: [] };
      return;
    }
    try {
      const response = await send({ type: 'gitchop:repos:mine', query });
      if (run !== localRun) return;
      mine = { query, results: response?.ok ? response.results ?? [] : [] };
    } catch {
      if (run !== localRun) return;
      mine = { query, results: [] };
    }
  }

  filter.addEventListener('input', () => {
    // Typing is a new search, so it always comes back out of a repository.
    state.drill = null;
    state.activeIndex = 0;
    scheduleSearch();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(async () => {
      settleTimer = null;
      await readMine(filter.value.trim());
      menu.list.render();
    }, SETTLE);
  });

  /** Any key that acts on the list needs the list to match what has been typed. */
  function settle() {
    if (!settleTimer) return;
    clearTimeout(settleTimer);
    settleTimer = null;
    menu.list.render();
  }

  return {
    cancel: cancelSearch,
    appendResults,
    settle,
    /** A link was just saved over the filter: whatever GitHub had said belongs to no query now. */
    reset() {
      repos = { query: '', status: 'idle', results: [], error: '' };
    },
  };
}
