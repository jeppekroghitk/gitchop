import { PANEL_SWITCHES as PANEL, api } from '../lib/links.js';
import { SWITCHES as PULLS } from '../lib/pulls.js';
import { SWITCHES as NEWS } from '../lib/news.js';
import { SWITCHES as CONTRIBUTIONS } from '../lib/contributions.js';
import { load as loadPulls } from './pulls-card.js';

const host = document.getElementById('features');
const statusEl = document.getElementById('features-status');
/** Under the card: what is worth knowing about the switches as they stand. */
const notes = document.getElementById('features-notes');

/**
 * One row per thing the menu shows besides the links. Each switch is the `enabled` setting of its
 * own feature, kept where that feature keeps the rest of its settings, so flipping it here is the
 * same as it ever was; only the switch has moved. `after` is a page that draws itself differently
 * once its feature is off, and redraws; the news page follows storage on its own.
 */
const FEATURES = [
  { id: 'panel', spec: PANEL.find((spec) => spec.id === 'enabled'), ask: 'gitchop:panel', set: 'gitchop:panel:settings', needsToken: false },
  { id: 'pulls', spec: PULLS.find((spec) => spec.id === 'enabled'), ask: 'gitchop:pulls', set: 'gitchop:pulls:settings', needsToken: true, after: loadPulls },
  { id: 'news', spec: NEWS.find((spec) => spec.id === 'enabled'), ask: 'gitchop:news', set: 'gitchop:news:settings', needsToken: false },
  { id: 'contributions', spec: CONTRIBUTIONS.find((spec) => spec.id === 'enabled'), ask: 'gitchop:contributions', set: 'gitchop:contributions:settings', needsToken: true },
];

let statusTimer = null;
let busy = false;
let current = {};

function flash(text) {
  statusEl.textContent = text;
  statusEl.dataset.shown = 'true';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.dataset.shown = 'false';
  }, 2600);
}

async function ask(message) {
  const response = await api.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? 'The background script did not answer.');
  return response;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function guard(node, work) {
  if (busy) return;
  busy = true;
  const label = node.textContent;
  node.textContent = 'working…';
  try {
    await work();
  } catch (error) {
    flash('failed');
    render(String(error.message ?? error));
    return;
  } finally {
    busy = false;
    node.textContent = label;
  }
}

/** One switch per feature, in the same dress as the chop effect's own. */
function switchRow(feature) {
  const row = element('div', 'slider slider-toggle');
  row.title = feature.spec.hint;

  const label = element('span', 'slider-label', feature.spec.label);
  label.id = `features-${feature.id}-label`;

  const toggle = element('button', 'switch');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-labelledby', label.id);
  const on = current[feature.id]?.settings?.enabled === 1;
  toggle.dataset.on = String(on);
  toggle.setAttribute('aria-checked', String(on));
  toggle.addEventListener('click', () =>
    guard(toggle, async () => {
      current[feature.id] = await ask({ type: feature.set, patch: { enabled: on ? 0 : 1 } });
      flash('saved');
      render();
      feature.after?.();
    }),
  );

  row.append(label, toggle, element('output', null, on ? 'on' : 'off'));
  return row;
}

function render(error) {
  host.textContent = '';
  notes.textContent = '';
  const wrap = element('div', 'card-body');

  const switches = element('div', 'sliders');
  for (const feature of FEATURES) switches.append(switchRow(feature));
  wrap.append(switches);

  if (error) wrap.append(element('p', 'error', error));
  host.append(wrap);

  const hasToken = FEATURES.some((feature) => current[feature.id]?.hasToken);
  if (!hasToken) {
    notes.append(
      element(
        'p',
        'note',
        'Pull requests and contributions need a token under Tokens. The switches keep your choice for when there is one.',
      ),
    );
  }
}

export async function load() {
  try {
    const answers = await Promise.all(FEATURES.map((feature) => ask({ type: feature.ask })));
    FEATURES.forEach((feature, index) => {
      current[feature.id] = answers[index];
    });
    render();
  } catch (error) {
    render(String(error.message ?? error));
  }
}
