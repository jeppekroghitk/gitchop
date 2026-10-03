/** The year's contributions in the head, and the years before it hung beneath on hover. */
import { send } from '../../lib/messages.js';
import { node } from '../dom.js';
import { createOdometer } from '../odometer.js';
import { popLine } from './parts.js';

/** @import { Answer } from '../../background/messages.js' */

/** @param {Answer<'gitchop:contributions'> | null} contributions */
export function createCount(contributions) {
  /**
   * The year's contributions beside the title, when the background said so — a token, and the
   * switch on. The reels are for looking at; the exact figures go on the element for anything
   * that reads it, this year's and the past ones both. It is not a link: hovering it hangs the
   * years before this one beneath, and that is all it does. Where it hangs is the frame's to
   * say, which sets `home` on it.
   * @type {{
   *   element: HTMLSpanElement,
   *   odometer: ReturnType<typeof createOdometer>,
   *   label: HTMLSpanElement,
   *   pop: HTMLDivElement,
   *   years: HTMLDivElement,
   *   past: { year: number, total: number }[],
   *   home?: HTMLElement | null,
   * } | null}
   */
  let count = null;
  if (contributions?.show) {
    const element = node('span', 'gc-count');
    element.setAttribute('role', 'img');
    const odometer = createOdometer();
    const label = node('span', 'gc-count-label');
    element.append(odometer.element, label);
    // The news popover's card and rows, hung from the same bridge — but a tooltip: nothing in it
    // to click, so it takes no pointer and goes when the mouse leaves the number.
    const pop = node('div', 'gc-pop gc-pop--list gc-pop--years');
    pop.dataset.shown = 'false';
    pop.dataset.below = 'true';
    pop.setAttribute('role', 'tooltip');
    pop.setAttribute('aria-hidden', 'true');
    const years = node('div', 'gc-pop-card');
    pop.append(years);
    element.addEventListener('mouseenter', () => showYears());
    element.addEventListener('mouseleave', () => hideYears());
    count = { element, odometer, label, pop, years, past: [] };
  }

  /** @type {Partial<Answer<'gitchop:contributions'>> | null} */
  let contribData = contributions ?? null;
  let contribRun = 0;

  function hideYears() {
    if (!count) return;
    count.pop.dataset.shown = 'false';
    count.pop.setAttribute('aria-hidden', 'true');
  }

  /**
   * The years before this one, under the number, right edge to right edge with it, while the
   * mouse is on it. Flush under the number as the news popover is under its chip — the bridge's
   * padding is the visible gap. Nothing to hang while the snapshot has no past years: before the
   * first refresh, or on an account made this year.
   */
  function showYears() {
    if (!count || count.past.length === 0 || count.element.hidden) return;
    const box = /** @type {HTMLElement} */ (count.home).getBoundingClientRect();
    const at = count.element.getBoundingClientRect();
    count.pop.style.right = `${Math.round(box.right - at.right)}px`;
    count.pop.style.top = `${Math.round(at.bottom - box.top)}px`;
    count.pop.dataset.shown = 'true';
    count.pop.setAttribute('aria-hidden', 'false');
  }

  /**
   * The number as it stands. The total is null until a snapshot exists, which is the cue for a
   * shimmer where the digits will be; null with a failure on record — the refresh refused, and
   * there was nothing before it — is no number at all, and the settings page says why. The year
   * is the snapshot's, so a count is never labelled with a year it does not cover. The past years
   * are filled in here and hung on hover, and read out with this year's for anything that listens.
   */
  function renderCount() {
    if (!count) return;
    const data = contribData ?? {};
    const known = Number.isFinite(data.total);
    if (!known && data.error) {
      count.element.hidden = true;
      hideYears();
      return;
    }
    count.element.hidden = false;
    const year = data.year ?? new Date().getFullYear();
    count.label.textContent = `contributions in ${year}`;
    count.odometer.set(known ? data.total : null);

    count.past = known ? (data.past ?? []).filter((entry) => Number.isFinite(entry?.total)) : [];
    count.years.textContent = '';
    // The same line as a pull request or a commit in the news: the year where the title goes,
    // its total where the detail goes — plain digits, as the reels are — and no URL, so it is a
    // line and not a link.
    for (const entry of count.past) count.years.append(popLine(String(entry.year), String(entry.total), ''));
    if (count.past.length === 0) hideYears();

    if (!known) {
      count.element.setAttribute('aria-label', `contributions in ${year}, not counted yet`);
      return;
    }
    const spoken = [
      `${/** @type {number} */ (data.total).toLocaleString('en')} contributions in ${year}`,
      ...count.past.map((entry) => `${entry.total.toLocaleString('en')} in ${entry.year}`),
    ];
    count.element.setAttribute('aria-label', spoken.join('; '));
  }

  /**
   * The snapshot painted instantly; if the background said it was stale, ask for a fresh one and
   * roll to it when it lands — the last digits turning over is the day's work arriving. A number
   * that never came, with nothing before it, is taken down rather than left shimmering.
   */
  async function refreshCount() {
    if (!count || !contribData?.stale) return;
    const run = ++contribRun;
    /** @type {Answer<'gitchop:contributions:refresh'> | null} */
    let next = null;
    try {
      const response = await send({ type: 'gitchop:contributions:refresh' });
      if (response?.ok) next = response;
    } catch {
      /* keep what is already on screen */
    }
    if (run !== contribRun) return;
    if (next) contribData = next;
    else if (!Number.isFinite(contribData?.total)) contribData = { ...contribData, error: contribData?.error ?? 'GitHub did not answer.' };
    renderCount();
  }

  return {
    /** The number and its years as built, for the frame to place; null with the count switched off. */
    view: count,
    render: renderCount,
    refresh: refreshCount,
    /** The panel has risen, so the reels may roll up to the number where the roll can be seen. */
    reveal() {
      count?.odometer.reveal();
    },
  };
}
