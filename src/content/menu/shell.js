/**
 * The menu's frame: the panel with its filter, list and strip, the columns beside it, and the
 * stage they all stand on. Built empty; the modules beside this one fill it.
 */
import { node } from '../dom.js';
import { standsPanel } from './rows.js';

export function createShell({ panelSetting, pulls, news, count, onOptions }) {
  const hasPanel = standsPanel(panelSetting, pulls, news);
  const panel = node('div', 'gc-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'gitchop links');

  const head = node('div', 'gc-head');
  head.append(node('span', 'gc-title', 'Links'));
  if (count) head.append(count.element);

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

  /**
   * The panel and the columns beside it rise into the cut as one slab, so the stage is what the
   * chop animates: the news on the left, the pull requests on the right. Each column only exists
   * when the background said so — a token that can read pull requests and the switch on; the
   * news switch on. Without them the stage is the panel alone, exactly as before.
   */
  const stage = node('div', 'gc-stage');
  stage.dataset.region = hasPanel ? 'panel' : 'pulls';
  stage.dataset.panel = String(hasPanel);
  stage.dataset.pulls = String(Boolean(pulls?.show));
  stage.dataset.news = String(Boolean(news?.show) && (news?.repos?.length ?? 0) > 0);
  // Focusable, so that with no panel to hold the keys the stage itself does, and Escape still closes.
  stage.tabIndex = -1;
  if (hasPanel) stage.append(panel);

  // The news column is in the tree whenever the feature is on, and in the layout only while
  // something is subscribed — so the first subscription made from the menu raises it at once,
  // and the last unsubscription lets it go, without the menu being reopened.
  let newsEl = null;
  let newsList = null;
  let newsSince = null;
  if (news?.show) {
    newsEl = node('aside', 'gc-news');
    newsEl.setAttribute('aria-label', 'News from the repositories you follow');
    const newsHead = node('div', 'gc-head');
    newsSince = node('span', 'gc-since');
    newsHead.append(node('span', 'gc-title', 'News'), newsSince);
    // Read with the mouse, never walked with the keys: prose is not a list of rows to be a
    // cursor in, so the arrows and Tab stay with the links and the pull requests.
    newsList = node('ul', 'gc-list gc-lanes');
    newsList.setAttribute('aria-label', 'News');
    newsEl.append(newsHead, newsList);
    stage.prepend(newsEl);
  }

  let pullsEl = null;
  let pullsList = null;
  if (pulls?.show) {
    pullsEl = node('aside', 'gc-pulls');
    pullsEl.setAttribute('aria-label', 'Pull requests waiting on you');
    const pullsHead = node('div', 'gc-head');
    pullsHead.append(node('span', 'gc-title', 'Pull requests'));
    pullsList = node('ul', 'gc-list gc-lanes');
    pullsList.setAttribute('role', 'listbox');
    pullsList.setAttribute('aria-label', 'Pull requests');
    pullsList.tabIndex = -1;
    pullsEl.append(pullsHead, pullsList);
    stage.append(pullsEl);
  }

  /**
   * The count and its years hang in the panel's head; without the panel, in the head of the
   * column standing nearest where the panel would have been. The years hang from that column
   * rather than its head, so they can lie over what is beneath.
   */
  if (count) {
    count.home = hasPanel ? panel : (pullsEl ?? newsEl);
    if (!hasPanel) count.home?.querySelector('.gc-head')?.append(count.element);
    count.home?.append(count.pop);
  }

  /**
   * Settings is a row in the links list, so without the panel there would be no way to it from
   * the menu. The column standing nearest where the panel would be — the same one the count
   * moves to — then ends in a strip like the panel's own, with the word in it where the panel
   * keeps its keys, and clicking it goes where the row went. One strip, not one per column: two
   * columns standing together share the one, as they would have shared the panel. That column
   * also sets the height, since without a panel nothing else does; the other stretches to it.
   * The head is left alone: with the count and the news' own fact already in it, a third thing
   * cut the fact short.
   */
  if (!hasPanel) {
    const host = pullsEl ?? newsEl;
    const tool = node('button', 'gc-tool', 'settings');
    tool.type = 'button';
    tool.title = 'Open Settings';
    tool.addEventListener('click', () => onOptions());
    const strip = node('div', 'gc-foot');
    strip.append(tool);
    host.append(strip);
    host.dataset.strip = 'true';
  }

  return { hasPanel, panel, filter, list, keys, stage, newsEl, newsList, newsSince, pullsEl, pullsList };
}
