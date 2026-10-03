/** The news column: a few sentences per subscribed repository, and what each fact is made of. */
import { isSafeUrl } from '../../lib/links.js';
import { send } from '../../lib/messages.js';
import { node } from '../dom.js';
import { note, opensElsewhere, popLine, skeletons } from './parts.js';

/** @import { Answer } from '../../background/messages.js' */
/** @import { Chip, Segment } from '../../lib/news.js' */
/** @import { Menu } from '../menu.js' */

/** Skeleton rows standing in for a repository the edition has not reached yet. */
const NEWS_SLOTS = 2;
/** About how many lines a fact's popover shows before it scrolls. */
const POP_LINES = 20;
/** The gap between a chip's line and its popover — part of the popover, so crossing it is still being in it. */
const POP_BRIDGE = 6;
/** How long a popover outlives the mouse leaving its chip — long enough to reach it diagonally. */
const POP_LINGER = 120;

/**
 * @param {Menu} menu
 * @param {Answer<'gitchop:news'> | null} news
 */
export function createNews(menu, news) {
  const { stage, newsEl, newsList, newsSince } = menu.el;

  /**
   * What a fact in the news is made of — the pull requests behind "2 pull requests merged",
   * every message behind "23 commits" — under the sentence it sits in, the moment the chip is
   * hovered. Unlike the title above it is a place to be: every line is a link and a long list
   * scrolls inside it, so it stays while the mouse is over the chip or over the popover itself,
   * and goes a beat after the mouse has left both. The gap between the chip's line and the card
   * belongs to the popover — the next line's chips begin in that gap, and without the bridge the
   * mouse on its way down would open theirs instead. One element for the column, filled per chip.
   */
  const newsPop = node('div', 'gc-pop gc-pop--list');
  newsPop.dataset.shown = 'false';
  newsPop.setAttribute('aria-hidden', 'true');
  const newsPopCard = node('div', 'gc-pop-card');
  newsPop.append(newsPopCard);
  newsEl?.append(newsPop);
  /** @type {{ item: HTMLElement, entry: ReturnType<typeof chipEntry> } | null} */
  let newsHover = null;
  let newsPopHovered = false;
  /** @type {number | null} */
  let newsPopTimer = null;
  /** @type {{ item: HTMLElement, chip: Chip } | null} */
  let newsShown = null;

  /** @type {Answer<'gitchop:news'> | null} */
  let newsData = news ?? null;
  let newsRun = 0;
  let newsBusy = false;

  function hideNewsPop() {
    clearTimeout(newsPopTimer);
    newsPopTimer = null;
    if (newsShown) delete newsShown.item.dataset.open;
    newsShown = null;
    newsPop.dataset.shown = 'false';
    newsPop.setAttribute('aria-hidden', 'true');
  }

  /**
   * Every line the fact is made of; only a fetch that stopped short ends with a line pointing at GitHub.
   * @param {Chip} chip
   */
  function fillNewsPop(chip) {
    newsPopCard.textContent = '';
    for (const item of chip.items ?? []) newsPopCard.append(popLine(item.title, item.detail, item.url, { dismiss: menu.dismiss }));
    if (chip.more) newsPopCard.append(popLine('more on GitHub', '', chip.url, { more: true, dismiss: menu.dismiss }));
  }

  /**
   * Flush under the line the chip sits on — the bridge is the visible gap — the width of the
   * column's text, and no taller than about twenty lines or the room the column has left
   * beneath, whichever is less, so a long list scrolls inside the card rather than running off
   * the column. Above only when beneath is not enough and above has more.
   * @param {HTMLElement | null} chipEl
   * @param {Chip | null} chip
   */
  function newsPopAt(chipEl, chip) {
    if (!chipEl || !chip || (chip.items?.length ?? 0) === 0) {
      hideNewsPop();
      return;
    }
    clearTimeout(newsPopTimer);
    newsPopTimer = null;
    if (newsShown?.item !== chipEl) {
      if (newsShown) delete newsShown.item.dataset.open;
      fillNewsPop(chip);
      newsPopCard.scrollTop = 0;
    }
    newsShown = { item: chipEl, chip };
    chipEl.dataset.open = 'true';
    const box = /** @type {HTMLElement} */ (newsEl).getBoundingClientRect();
    const at = chipEl.getBoundingClientRect();
    const left = 13;
    newsPop.style.left = `${left}px`;
    newsPop.style.width = `${Math.round(box.width - left - 15)}px`;
    newsPopCard.style.maxHeight = '';
    const natural = newsPopCard.offsetHeight;
    const line = /** @type {HTMLElement | null} */ (newsPopCard.firstElementChild)?.offsetHeight || 25;
    const roomBelow = box.height - 6 - (at.bottom - box.top) - POP_BRIDGE;
    const roomAbove = at.top - box.top - 6 - POP_BRIDGE;
    const below = natural <= roomBelow || roomBelow >= roomAbove;
    newsPopCard.style.maxHeight = `${Math.round(Math.max(line * 3, Math.min(line * POP_LINES + 10, below ? roomBelow : roomAbove)))}px`;
    newsPop.dataset.below = String(below);
    newsPop.style.top = `${Math.round((below ? at.bottom : at.top) - box.top)}px`;
    newsPop.dataset.shown = 'true';
    newsPop.setAttribute('aria-hidden', 'false');
  }

  /**
   * A beat before hiding, so the mouse can cross from the chip into the popover or back; the
   * hide is deferred at all because the chip's mouseleave fires before the popover's mouseenter,
   * and a popover hidden in between has no pointer left to be entered.
   */
  function lingerNewsPop() {
    clearTimeout(newsPopTimer);
    newsPopTimer = setTimeout(() => {
      newsPopTimer = null;
      if (!newsHover && !newsPopHovered) hideNewsPop();
    }, POP_LINGER);
  }

  /** The chip under the mouse opens its popover; off both the chip and the popover, it goes. */
  function placeNewsPop() {
    if (!newsEl) return;
    if (newsHover) newsPopAt(newsHover.item, newsHover.entry.chip);
    else if (!newsPopHovered) lingerNewsPop();
  }
  newsPop.addEventListener('mouseenter', () => {
    newsPopHovered = true;
    clearTimeout(newsPopTimer);
    newsPopTimer = null;
  });
  newsPop.addEventListener('mouseleave', () => {
    newsPopHovered = false;
    placeNewsPop();
  });
  newsEl?.addEventListener('mouseleave', () => {
    newsHover = null;
    newsPopHovered = false;
    hideNewsPop();
  });
  // The chip it hangs from has moved; where to is not worth working out.
  newsList?.addEventListener('scroll', hideNewsPop, { passive: true });

  /** @param {string} repo */
  function subscribed(repo) {
    return (newsData?.settings?.repos ?? []).some((seen) => seen.toLowerCase() === String(repo).toLowerCase());
  }

  /**
   * The subscribe row for one repository — inside it, or as a command when standing on its page.
   * @param {string} repo
   * @param {string} [label]
   */
  function subscribeEntry(repo, label) {
    const on = subscribed(repo);
    return {
      usable: true,
      url: '',
      icon: on ? '◉' : '◎',
      label: on ? `Unsubscribe${label ? ` ${label}` : ''} from news` : `Subscribe to news${label ? ` for ${label}` : ''}`,
      keywords: 'subscribe follow news unsubscribe unfollow digest',
      reason: '',
      tip: '',
      repo: null,
      run: () => toggleNews(repo, !on),
    };
  }

  /**
   * A fact in the prose. The chip is what the mouse hovers and clicks — the click opens GitHub's
   * own list of exactly that, cut to the window — and the popover is what it is made of. Same
   * gate as every other row: nothing becomes a link without passing the scheme check.
   * @param {Segment & { chip: Chip }} segment
   */
  function chipEntry(segment) {
    return {
      usable: isSafeUrl(segment.chip.url),
      url: segment.chip.url,
      kind: segment.chip.kind,
      text: segment.text,
      chip: segment.chip,
    };
  }

  /** @param {ReturnType<typeof chipEntry>} entry */
  function newsChip(entry) {
    const item = node(entry.usable ? 'a' : 'span', 'gc-chip', entry.text);
    if (entry.usable) /** @type {HTMLAnchorElement} */ (item).href = entry.url;
    item.dataset.kind = entry.kind;

    item.addEventListener('mouseenter', () => {
      newsHover = { item, entry };
      placeNewsPop();
    });
    item.addEventListener('mouseleave', () => {
      newsHover = null;
      placeNewsPop();
    });
    item.addEventListener('click', (event) => {
      if (opensElsewhere(event)) return;
      menu.dismiss();
    });
    return item;
  }

  /**
   * One repository's sentences: plain text and chips, in the order the prose puts them.
   * @param {Segment[]} segments
   */
  function proseRow(segments) {
    const row = node('li', 'gc-prose-row');
    const prose = node('p', 'gc-prose');
    for (const segment of segments) {
      if (segment.chip) prose.append(newsChip(chipEntry(/** @type {Segment & { chip: Chip }} */ (segment))));
      else prose.append(document.createTextNode(segment.text));
    }
    row.append(prose);
    return row;
  }

  /** @param {{ repo: string, private: boolean }} entry */
  function repoSection(entry) {
    const row = node('li', 'gc-section gc-section--lane gc-section--repo');
    const name = node('span', null, entry.repo);
    if (entry.private) name.title = 'private repository';
    row.append(name, node('span', 'gc-rule'));
    return row;
  }

  /**
   * One section per subscribed repository, in the order they were subscribed. Before the edition
   * reaches a repository it is two skeleton rows; after, its day as a few sentences — or one
   * quiet line, or the sentence that stands where its day would be. The header says what the
   * whole column covers, once, so the sections need not repeat it. Whether the column is in the
   * layout at all follows the list: the first subscription raises it, the last unsubscription
   * lets it go.
   */
  function renderNews() {
    if (!newsEl || !newsList || !newsSince) return;
    newsList.textContent = '';
    newsHover = null;
    hideNewsPop();

    /** @type {Partial<Answer<'gitchop:news'>>} */
    const data = newsData ?? {};
    const repos = data.repos ?? [];
    stage.dataset.news = String(repos.length > 0);
    newsSince.textContent = data.sinceLabel ?? '';

    for (const entry of repos) {
      newsList.append(repoSection(entry));
      if (entry.prose === null) {
        skeletons(NEWS_SLOTS, newsList, true);
        continue;
      }
      if (entry.prose.length > 0) {
        newsList.append(proseRow(entry.prose));
      } else {
        const empty = note(entry.error ?? 'nothing new');
        empty.classList.add('gc-note--pr');
        if (entry.error) empty.dataset.error = 'true';
        newsList.append(empty);
      }
    }
  }

  /**
   * The edition painted instantly; if the background said it was not this morning's, ask for it
   * and repaint when it lands. A later navigation or subscription owns the result.
   */
  async function refreshNews() {
    if (!newsEl || !newsData?.stale) return;
    const run = ++newsRun;
    /** @type {Answer<'gitchop:news:refresh'> | null} */
    let next = null;
    try {
      const response = await send({ type: 'gitchop:news:refresh' });
      if (response?.ok) next = response;
    } catch {
      /* keep what is already on screen */
    }
    if (run !== newsRun) return;
    if (next) newsData = next;
    renderNews();
  }

  /**
   * Subscribing from the menu: the list is the background's to change, and its answer is the
   * whole state, so the drill row flips, the command under Do flips, and the column gains or
   * loses a section in one repaint. A new repository then has no place in the edition yet, so
   * the refresh that follows fills it in.
   * @param {string} repo
   * @param {boolean} subscribe
   */
  async function toggleNews(repo, subscribe) {
    if (newsBusy) return;
    newsBusy = true;
    const run = ++newsRun;
    /** @type {Answer<'gitchop:news:subscribe'> | null} */
    let next = null;
    try {
      const response = await send({ type: subscribe ? 'gitchop:news:subscribe' : 'gitchop:news:unsubscribe', repo });
      if (response?.ok) next = response;
    } catch {
      /* the list stays as it was */
    } finally {
      newsBusy = false;
    }
    if (run !== newsRun || !next) return;
    newsData = next;
    renderNews();
    menu.list.render();
    refreshNews();
  }

  return {
    /** Whether the news is on at all, which is when the panel offers to subscribe. */
    on: () => Boolean(newsData?.show),
    subscribeEntry,
    render: renderNews,
    refresh: refreshNews,
    /**
     * A whole new edition from the background; it has nothing to merge, so it is simply painted.
     * @param {Answer<'gitchop:news'>} next
     */
    update(next) {
      newsData = next;
      renderNews();
    },
  };
}
