/**
 * The small pieces every part of the menu is built from: headings, quiet lines, skeletons, the
 * lines of a popover, and the test for a click the browser sends elsewhere.
 */
import { isSafeUrl } from '../../lib/links.js';
import { node } from '../dom.js';

const GHOST_WIDTHS = ['62%', '47%', '71%', '54%', '43%'];

/**
 * A click the browser sends somewhere else — a new tab, a new window — leaves this page where it
 * is, so the menu stays up over it; only a plain click navigates here and dismisses the menu.
 */
export function opensElsewhere(event) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1;
}

export function section(title) {
  return node('li', 'gc-section', title);
}

export function note(text) {
  return node('li', 'gc-note', text);
}

/** Row-shaped shimmer standing in for a result that has not arrived yet. */
export function ghost(slot, tall = false) {
  const row = node('li');
  const item = node('div', `gc-item gc-item--ghost${tall ? ' gc-pr' : ''}`);
  const bar = node('span', 'gc-bar');
  bar.style.width = GHOST_WIDTHS[slot % GHOST_WIDTHS.length];
  item.append(node('span', 'gc-icon'), bar);
  if (!tall) item.append(node('span', 'gc-tail'));
  row.append(item);
  return row;
}

export function skeletons(count, target, tall = false) {
  for (let slot = 0; slot < count; slot += 1) target.append(ghost(slot, tall));
}

/**
 * One line of a popover: a title and its detail, a link when the URL passes the scheme check and
 * a plain line when there is none. Following it dismisses the menu, as any row does.
 * @param {string} title
 * @param {string} detail
 * @param {string} url
 * @param {{ more?: boolean, dismiss?: () => void }} [options]
 */
export function popLine(title, detail, url, { more = false, dismiss } = {}) {
  const usable = isSafeUrl(url);
  const line = node(usable ? 'a' : 'div', `gc-pop-item${more ? ' gc-pop-item--more' : ''}`);
  if (usable) {
    /** @type {HTMLAnchorElement} */ (line).href = url;
    line.addEventListener('click', (event) => {
      if (opensElsewhere(event)) return;
      dismiss?.();
    });
  }
  line.append(node('span', 'gc-pop-title', title));
  if (detail) line.append(node('span', 'gc-pop-detail', detail));
  return line;
}
