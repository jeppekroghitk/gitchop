/**
 * The menu the chop opens onto: the panel of links and search, the pull requests on its right,
 * the news on its left, the year's contributions in the head and the rate gauge in the corner.
 * Each is its own module under menu/; this one builds them in order and hands them one shared
 * `menu`, through which they reach each other and the little state more than one of them moves.
 */
import { createCount } from './menu/count.js';
import { createForm } from './menu/form.js';
import { createGauge } from './menu/gauge.js';
import { createKeyboard } from './menu/keyboard.js';
import { createList } from './menu/list.js';
import { REVEAL_AT_MOST } from './menu/motion.js';
import { createNews } from './menu/news.js';
import { createPulls } from './menu/pulls.js';
import { createSearch } from './menu/search.js';
import { createShell } from './menu/shell.js';

/** @import { Answer } from '../background/messages.js' */

/**
 * The one object every module of the menu is handed: what it was opened with, the frame, the
 * shared cursor, and each module, through which they reach one another.
 * @typedef {{
 *   ctx: ReturnType<typeof import('./context.js').readContext>,
 *   onClose: () => void,
 *   onOptions: () => void,
 *   onLinksChanged?: (links: import('../lib/links.js').Link[]) => void,
 *   hint: boolean,
 *   onWelcome?: () => void,
 *   onHintDismiss?: () => void,
 *   hasPanel: boolean,
 *   reduced: boolean,
 *   el: ReturnType<typeof createShell>,
 *   state: {
 *     region: 'panel' | 'pulls',
 *     items: any[],
 *     activeIndex: number,
 *     drill: any,
 *     form: any,
 *     pullsItems: any[],
 *     pullsIndex: number,
 *   },
 *   dismiss(): void,
 *   pulls: ReturnType<typeof createPulls>,
 *   news: ReturnType<typeof createNews>,
 *   list: ReturnType<typeof createList>,
 *   search: ReturnType<typeof createSearch>,
 *   form: ReturnType<typeof createForm>,
 *   keyboard: ReturnType<typeof createKeyboard>,
 * }} Menu
 */

/**
 * What the menu opens with: the page it is over, the links, and the background's instant answers
 * — each null when the background did not give one, which means that part is not shown.
 * @param {{
 *   ctx: Menu['ctx'],
 *   links: import('../lib/links.js').Link[],
 *   pulls: Answer<'gitchop:pulls'> | null,
 *   news: Answer<'gitchop:news'> | null,
 *   contributions: Answer<'gitchop:contributions'> | null,
 *   rate: Answer<'gitchop:rate'> | null,
 *   panel: Answer<'gitchop:panel'> | null,
 *   onClose: () => void,
 *   onOptions: () => void,
 *   onLinksChanged?: Menu['onLinksChanged'],
 *   hint?: boolean,
 *   onWelcome?: () => void,
 *   onHintDismiss?: () => void,
 * }} options
 */
export function createMenu({ ctx, links, pulls, news, contributions, rate, panel: panelSetting, onClose, onOptions, onLinksChanged, hint = false, onWelcome, onHintDismiss }) {
  // The count is built before the frame, which hangs it in whichever head stands nearest the panel.
  const count = createCount(contributions);
  const el = createShell({ panelSetting, pulls, news, count: count.view, onOptions });

  const menu = /** @type {Menu} */ (/** @type {Omit<Menu, 'pulls' | 'news' | 'list' | 'search' | 'form' | 'keyboard'>} */ ({
    ctx,
    onClose,
    onOptions,
    onLinksChanged,
    hint,
    onWelcome,
    onHintDismiss,
    hasPanel: el.hasPanel,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    el,
    /**
     * Where the cursor is, which more than one module reads and moves: the keys walk it, the
     * mouse sets it, and each list resets it when it is built again. Everything else a module
     * keeps to itself.
     */
    state: {
      // Which column the keyboard is in. Focus itself sits on the filter or on the pull requests
      // list; this is the same fact, kept where paint() can read it without asking the DOM.
      region: el.hasPanel ? 'panel' : 'pulls',
      /** The panel's rows that can be stood on, as built, and the one the cursor is on. */
      items: [],
      activeIndex: 0,
      /** The repository whose insides the panel is showing, and the row to come back to. */
      drill: null,
      /** The add-a-link form while it stands in place of the filter. */
      form: null,
      /** The pull request column's rows that can be stood on, and the one the cursor is on. */
      pullsItems: [],
      pullsIndex: 0,
    },
    /** Following anything out of the menu: the search still in flight is not wanted any more. */
    dismiss() {
      menu.search.cancel();
      onClose();
    },
  }));

  menu.pulls = createPulls(menu, pulls);
  menu.news = createNews(menu, news);
  menu.list = createList(menu, links);
  menu.search = createSearch(menu);
  menu.form = createForm(menu);
  menu.keyboard = createKeyboard(menu);
  const gauge = createGauge(rate);

  menu.list.render();
  menu.pulls.render();
  menu.news.render();
  count.render();
  gauge.render();
  menu.pulls.refresh();
  menu.news.refresh();
  count.refresh();
  setTimeout(menu.pulls.reveal, REVEAL_AT_MOST);

  return {
    element: el.stage,
    /**
     * Called once the stage is in the page, which is the first moment the columns have a layout
     * to be visible in — so the strip is painted again here, or a fresh snapshot with nothing to
     * refresh would leave it not mentioning them until the cursor moved.
     */
    focus() {
      if (menu.hasPanel) el.filter.focus();
      else if (menu.pulls.visible() && menu.state.pullsItems.length > 0) menu.keyboard.toPulls();
      else el.stage.focus({ preventScroll: true });
      menu.keyboard.paint();
    },
    /**
     * The panel has risen: the reels may roll up to the number now, where the roll can be seen,
     * and a fresh answer about the pull requests may be painted, where what leaves is seen to go.
     */
    revealed() {
      count.reveal();
      menu.pulls.reveal();
      gauge.reveal();
    },
    /** The budgets' corner of the dark, for the layer to place beside the menu: it is not in the menu's own flow. */
    gauge: gauge.element,
    /**
     * The background read another answer from GitHub while the menu is up: the gauge follows.
     * @param {Answer<'gitchop:rate'>} next
     */
    updateRate(next) {
      if (!next) return;
      gauge.update(next);
    },
    /** The menu is going: nothing of it may keep ticking. */
    closed() {
      gauge.stop();
    },
    /**
     * The snapshot changed on file while the menu is up — the alarm landed, or Settings asked —
     * so the column is painted from it, what left leaving as it would after the menu's own ask.
     * @param {Answer<'gitchop:pulls'>} next
     */
    updatePulls(next) {
      if (!el.pullsEl || !next) return;
      menu.pulls.apply(next);
    },
    /**
     * The edition changed on file while the menu is up — a repository landing in a refresh that
     * is still going — so the column is painted from it: the section that came in fills, the
     * rest keep their skeletons. The background's answer is the whole state, so nothing here
     * has to merge.
     * @param {Answer<'gitchop:news'>} next
     */
    updateNews(next) {
      if (!el.newsEl || !next) return;
      menu.news.update(next);
    },
  };
}
