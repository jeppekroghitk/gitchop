/** The pull request column: its lanes, the title popover, and a refresh painted as what changed. */
import { isSafeUrl } from '../../lib/links.js';
import { send } from '../../lib/messages.js';
import { node } from '../dom.js';
import { ARRIVE_STAGGER, LEAVE_BEAT, LEAVE_STAGGER, arrive, leave, leavingFor } from './motion.js';
import { ghost, note, opensElsewhere } from './parts.js';
import { diffRows, laneRows } from './rows.js';

/** The one row in a lane that is not a pull request: the tail for whatever GitHub holds beyond what was fetched. */
const MORE_ROW = 'more';

/** @import { Answer } from '../../background/messages.js' */
/** @import { Menu } from '../menu.js' */

/**
 * @param {Menu} menu
 * @param {Answer<'gitchop:pulls'> | null} pulls
 */
export function createPulls(menu, pulls) {
  const { state } = menu;
  const { pullsEl, pullsList } = menu.el;

  // The full title of a pull request whose row had to cut it short, shown the instant the row is
  // hovered or becomes the cursor. One element for the whole column, moved to whichever row.
  // Shown and hidden by an attribute rather than `hidden`, so it can fade and rise into place.
  const pop = node('div', 'gc-pop');
  pop.dataset.shown = 'false';
  pop.setAttribute('role', 'tooltip');
  pop.setAttribute('aria-hidden', 'true');
  pullsEl?.append(pop);
  /** @type {HTMLElement | null} */
  let popHover = null;

  let pullsData = pulls ?? null;
  let pullsRun = 0;
  /** The column's rows by key as they stand; a row on its way out has left it, and is only in the list. */
  const pullsRows = new Map();
  let pullsLoaded = false;
  let pullsRevealed = false;
  let pullsPending = null;

  function hidePop() {
    pop.dataset.shown = 'false';
    pop.setAttribute('aria-hidden', 'true');
  }

  function popFor(item) {
    const title = item?.isConnected ? item.querySelector('.gc-pr-title') : null;
    if (!title || title.scrollWidth <= title.clientWidth) {
      hidePop();
      return;
    }
    const box = /** @type {HTMLElement} */ (pullsEl).getBoundingClientRect();
    const row = item.getBoundingClientRect();
    const at = title.getBoundingClientRect();
    // Under the row, starting where the title starts and never past the column's edge. Only when
    // the column has no room left beneath does it go above instead.
    const left = Math.round(at.left - box.left);
    pop.style.left = `${left}px`;
    pop.style.maxWidth = `${Math.round(box.width - left - 14)}px`;
    pop.textContent = title.textContent;
    const below = row.bottom - box.top + 6 + pop.offsetHeight <= box.height - 6;
    pop.dataset.below = String(below);
    pop.style.top = `${Math.round((below ? row.bottom + 6 : row.top - 6) - box.top)}px`;
    pop.dataset.shown = 'true';
    pop.setAttribute('aria-hidden', 'false');
  }

  /** Whatever the mouse is over wins; otherwise the cursor, if it is in this column. */
  function placePop() {
    if (!pullsEl) return;
    if (popHover) popFor(popHover);
    else if (state.region === 'pulls') popFor(state.pullsItems[state.pullsIndex]?.item);
    else hidePop();
  }
  pullsList?.addEventListener('scroll', hidePop, { passive: true });

  /** A column is in the layout only while the viewport has room for it; the CSS decides. */
  function pullsVisible() {
    return Boolean(pullsEl) && /** @type {HTMLElement} */ (pullsEl).getClientRects().length > 0;
  }

  /**
   * What one pull request says about itself: the title — that is what you recognise your work
   * by — the repository, dim, with the owner dropped because you know which economics is yours,
   * and how long since it last moved. On the feedback lane the glyph is the verdict; elsewhere it
   * is the same mark on every row, meaning nothing — private or public is not a question here,
   * every one of these is yours to deal with. The column is for looking at.
   */
  function pullEntry(pull, lane) {
    let icon = '◆';
    if (lane.id === 'reviewed') icon = pull.verdict === 'changes' ? '✗' : '✓';
    return {
      usable: isSafeUrl(pull.url),
      url: pull.url,
      icon,
      verdict: lane.id === 'reviewed' ? pull.verdict : null,
      title: pull.title || `#${pull.number}`,
      repo: pull.repoShort || pull.repo,
      age: pull.age || '',
    };
  }

  /** The tail of a lane: whatever GitHub holds past what was fetched, as one row pointing there. */
  function moreEntry(row) {
    return { usable: true, url: row.url, icon: '…', title: `${row.count} more on GitHub`, kind: MORE_ROW };
  }

  /**
   * A row that can be stood on: a pull request, or a lane's tail. Built once and filled again on
   * every refresh — the age ticks on, a title edited on GitHub follows, a verdict that changed is
   * the new glyph — so a row that is still there is never torn down and rebuilt under the cursor
   * or the mouse.
   */
  function pullRow(entry) {
    const li = node('li');
    li.setAttribute('role', 'option');

    // Same gate as the panel: nothing becomes clickable without passing the scheme check.
    const interactive = entry.usable && isSafeUrl(entry.url);
    const item = node(interactive ? 'a' : 'div', `gc-item gc-pr${entry.kind === MORE_ROW ? ' gc-pr--more' : ''}`);
    if (interactive) /** @type {HTMLAnchorElement} */ (item).href = entry.url;
    if (entry.tip) item.title = entry.tip;

    const icon = node('span', 'gc-icon');
    const title = node('span', 'gc-pr-title');
    // No tail here: the highlight is the cursor, and the age then ends where the divider does.
    item.append(icon, title);
    const repo = entry.repo ? node('span', 'gc-pr-repo') : null;
    const age = entry.age ? node('span', 'gc-pr-age') : null;
    if (repo) item.append(repo);
    if (age) item.append(age);
    const record = { li, item, icon, title, repo, age, entry };
    fillRow(record, entry);

    item.addEventListener('mousemove', () => {
      const index = state.pullsItems.findIndex((it) => it.item === item);
      if (index < 0 || state.pullsIndex === index) return;
      state.pullsIndex = index;
      menu.keyboard.paint();
    });
    item.addEventListener('mouseenter', () => {
      popHover = item;
      placePop();
    });
    item.addEventListener('mouseleave', () => {
      if (popHover === item) popHover = null;
      placePop();
    });
    item.addEventListener('click', (event) => {
      if (opensElsewhere(event)) return;
      menu.dismiss();
    });

    li.append(item);
    return record;
  }

  function fillRow(record, entry) {
    record.entry = entry;
    record.icon.textContent = entry.icon;
    if (entry.verdict) record.icon.dataset.verdict = entry.verdict;
    else delete record.icon.dataset.verdict;
    record.title.textContent = entry.title;
    if (record.repo) record.repo.textContent = entry.repo;
    if (record.age) record.age.textContent = entry.age;
  }

  function laneSection(lane) {
    const row = node('li', 'gc-section gc-section--lane');
    row.append(node('span', null, lane.title), node('span', 'gc-rule'));
    return row;
  }

  /** One row of the column, built for its key; what can be stood on carries its entry. */
  function buildRow(row) {
    switch (row.kind) {
      case 'pull':
        return { kind: row.kind, ...pullRow(pullEntry(row.pull, row.lane)) };
      case 'more':
        return { kind: row.kind, ...pullRow(moreEntry(row)) };
      case 'ghost':
        return { kind: row.kind, li: ghost(row.slot, true) };
      case 'empty': {
        const li = note(row.text);
        li.classList.add('gc-note--pr');
        return { kind: row.kind, li };
      }
      case 'error':
        return { kind: row.kind, li: note(row.text) };
      default:
        return { kind: row.kind, li: laneSection(row.lane) };
    }
  }

  /** A row that is still there, brought up to date without being rebuilt. */
  function updateRow(record, row) {
    if (row.kind === 'pull') fillRow(record, pullEntry(row.pull, row.lane));
    else if (row.kind === 'more') fillRow(record, moreEntry(row));
    else if (row.kind === 'empty' || row.kind === 'error') record.li.textContent = row.text;
  }

  /**
   * Paints the column from `pullsData`, keeping every row that is still there. Before the
   * snapshot, every lane is a few skeleton rows; after, it is exactly as tall as what it holds —
   * every row, or one quiet line when there is nothing — and the lane below moves up to meet it.
   * Nothing is folded away: seeing all three groups at once was weighed against seeing everything
   * in each, and everything won, so the column scrolls when it has to. The column's own height is
   * the panel's, so nothing about the slab changes as results land. Only past what was fetched
   * does a row point at GitHub.
   *
   * A refresh over a snapshot already up changes only what changed: a row still there is filled
   * again in place, one that is gone leaves, one that is new arrives once the leaving is done.
   * The first snapshot over the skeletons is simply placed — there was nothing to see go — as is
   * anything while the column is out of the layout. Rows on their way out stay where they were
   * until they are gone, so the walk that puts what remains in order steps past them. The cursor
   * stays on the row it was on if that row is still there, and comes back to the panel if the
   * column has emptied under it.
   */
  function renderPulls() {
    if (!pullsEl || !pullsList) return;
    /** @type {Partial<Answer<'gitchop:pulls'>>} */
    const data = pullsData ?? {};
    const rows = laneRows(data);
    const loaded = (data.lanes ?? []).some((lane) => lane.pulls !== null);
    const animate = loaded && pullsLoaded && pullsVisible();
    const activeKey = state.pullsItems[state.pullsIndex]?.key ?? null;

    const { gone } = diffRows([...pullsRows.keys()], rows);
    gone.forEach((key, index) => {
      const record = pullsRows.get(key);
      pullsRows.delete(key);
      if (animate) {
        // The mouse can no longer be over a row that is going.
        if (popHover === record.item) popHover = null;
        leave(record, index * LEAVE_STAGGER, menu.reduced);
      } else {
        record.li.remove();
      }
    });

    state.pullsItems = [];
    const arriving = [];
    /** @type {ChildNode | null} */
    let cursor = pullsList.firstChild;
    for (const row of rows) {
      let record = pullsRows.get(row.key);
      if (record) {
        updateRow(record, row);
      } else {
        record = buildRow(row);
        pullsRows.set(row.key, record);
        arriving.push(record);
      }
      while (cursor && cursor !== record.li && /** @type {Partial<HTMLElement>} */ (cursor).dataset?.leaving === 'true') cursor = cursor.nextSibling;
      if (cursor === record.li) cursor = /** @type {ChildNode} */ (cursor).nextSibling;
      else pullsList.insertBefore(record.li, cursor);
      if (row.kind === 'pull' || row.kind === 'more') state.pullsItems.push({ key: row.key, entry: record.entry, item: record.item });
    }
    pullsLoaded = loaded;

    if (animate) {
      const after = leavingFor(gone.length);
      arriving.forEach((record, index) => arrive(record, after + index * ARRIVE_STAGGER, menu.reduced));
    }

    const kept = activeKey ? state.pullsItems.findIndex((it) => it.key === activeKey) : -1;
    state.pullsIndex = kept >= 0 ? kept : Math.max(0, Math.min(state.pullsIndex, state.pullsItems.length - 1));
    if (state.region === 'pulls' && state.pullsItems.length === 0) menu.keyboard.toPanel();
    menu.keyboard.paint();
  }

  /**
   * The snapshot painted instantly; if the background said it was worth asking, ask for a fresh
   * one and paint the answer once the panel is up. A later refresh owns the result, exactly as
   * with the search.
   */
  async function refreshPulls() {
    if (!pullsEl || !pullsData?.stale) return;
    const run = ++pullsRun;
    /** @type {Answer<'gitchop:pulls:refresh'> | null} */
    let next = null;
    try {
      const response = await send({ type: 'gitchop:pulls:refresh' });
      if (response?.ok) next = response;
    } catch {
      /* keep what is already on screen */
    }
    if (run !== pullsRun) return;
    applyPulls(next ?? { ...pullsData, error: pullsData.error ?? 'GitHub did not answer.' });
  }

  /**
   * A fresh answer is painted once the panel is up, and a beat after, so the list as it was is
   * seen before anything leaves it — the whole point of asking again is to see what has gone.
   * Until then the latest answer waits, and whatever lands while the panel is still rising is
   * the one painted when it is. Should the panel never say it is up, the answer is painted anyway
   * after a while: a column standing on an old snapshot is worse than a departure unseen.
   */
  function applyPulls(next) {
    if (!next) return;
    if (!pullsRevealed) {
      pullsPending = next;
      return;
    }
    pullsData = next;
    renderPulls();
  }

  function revealPulls() {
    if (pullsRevealed) return;
    pullsRevealed = true;
    const next = pullsPending;
    pullsPending = null;
    if (next) setTimeout(() => applyPulls(next), LEAVE_BEAT);
  }

  function movePulls(delta) {
    if (state.pullsItems.length === 0) return;
    state.pullsIndex = (state.pullsIndex + delta + state.pullsItems.length) % state.pullsItems.length;
    menu.keyboard.paint();
  }

  return {
    render: renderPulls,
    refresh: refreshPulls,
    apply: applyPulls,
    reveal: revealPulls,
    move: movePulls,
    visible: pullsVisible,
    placePop,
  };
}
