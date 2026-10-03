import { node } from '../dom.js';
import { gaugeRows } from './rows.js';

/**
 * How much of GitHub's budgets is used, in the corner of the dark: a bar per budget, lit the
 * colour of the blade, filling from nothing to the limit, with the share used as a figure
 * beside it, and the count used and how long until the allowance turns above. It is for
 * looking at — it takes no pointer, so a click on it is a click on the dark. The bars stand
 * empty until the panel is up and then fill to where they are, and from then on they follow
 * the background's table as the menu's own requests land — the pull requests asked for on
 * open, each repository search typed — sliding rather than jumping, which is why a bar that is
 * still there is kept and moved, not drawn again. The count-down ticks once a second while the
 * menu is up, and stops when it is gone.
 * @param {import('../../background/messages.js').Answer<'gitchop:rate'> | null} rate
 */
export function createGauge(rate) {
  const gauge = node('div', 'gc-gauge');
  gauge.setAttribute('aria-label', 'GitHub rate limits');
  gauge.dataset.shown = 'false';
  let rateData = rate ?? null;
  let gaugeLit = false;
  let gaugeKeys = '';
  const gaugeBars = new Map();

  function renderGauge() {
    const rows = gaugeRows(rateData, Date.now());
    gauge.hidden = rows.length === 0;
    const keys = rows.map((row) => `${row.scope}\n${row.name}`);
    if (keys.join('\0') !== gaugeKeys) {
      gaugeKeys = keys.join('\0');
      gauge.textContent = '';
      gaugeBars.clear();
      // A head like the lanes' own, so the corner says what it is before it says how much.
      const head = node('div', 'gc-gauge-head');
      head.append(node('span', null, 'Rate limits'), node('span', 'gc-rule'));
      gauge.append(head);
      let who = null;
      rows.forEach((row, index) => {
        if (row.scope && row.scope !== who) {
          who = row.scope;
          gauge.append(node('div', 'gc-gauge-who', row.scope));
        }
        const line = node('div', 'gc-gauge-row');
        const top = node('span', 'gc-gauge-line');
        const meta = node('span', 'gc-gauge-meta');
        top.append(node('span', 'gc-gauge-name', row.name), meta);
        const bar = node('span', 'gc-gauge-bar');
        const fill = node('span', 'gc-gauge-fill');
        fill.style.width = '0%';
        bar.append(fill);
        const percent = node('span', 'gc-gauge-percent');
        line.append(top, bar, percent);
        gauge.append(line);
        gaugeBars.set(keys[index], { line, meta, fill, percent });
      });
    }
    rows.forEach((row, index) => {
      const parts = gaugeBars.get(keys[index]);
      parts.line.dataset.high = String(row.high);
      parts.meta.textContent = `${row.used}/${row.limit}${row.resetIn ? ` · ${row.resetIn}` : ''}`;
      parts.percent.textContent = `${row.percent}%`;
      parts.fill.style.width = gaugeLit ? `${Math.round(row.share * 1000) / 10}%` : '0%';
    });
  }

  let gaugeSeen = false;
  const gaugeTimer = setInterval(() => {
    if (gauge.isConnected) gaugeSeen = true;
    else if (gaugeSeen) {
      clearInterval(gaugeTimer);
      return;
    }
    renderGauge();
  }, 1000);

  return {
    element: gauge,
    render: renderGauge,
    /** The panel is up: the bars fill to where they are. */
    reveal() {
      gauge.dataset.shown = 'true';
      gaugeLit = true;
      renderGauge();
    },
    update(next) {
      rateData = next;
      renderGauge();
    },
    stop() {
      clearInterval(gaugeTimer);
    },
  };
}
