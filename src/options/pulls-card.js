import { api } from '../lib/links.js';
import { SWITCHES } from '../lib/pulls.js';
import { tokenGate } from './pages.js';

const host = document.getElementById('pulls');
const statusEl = document.getElementById('pulls-status');
/** Under the card: what is worth knowing about the settings as they stand. */
const notes = document.getElementById('pulls-notes');

let statusTimer = null;
let busy = false;
let current = null;

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

function when(iso) {
  if (!iso) return 'never';
  const stamp = new Date(iso);
  return Number.isNaN(stamp.valueOf()) ? 'never' : stamp.toLocaleString();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, { primary = false } = {}) {
  const node = element('button', `btn${primary ? ' btn-primary' : ''}`, label);
  node.type = 'button';
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
    render(current, String(error.message ?? error));
    return;
  } finally {
    busy = false;
    node.textContent = label;
  }
}

/** One switch per setting, in the same dress as the chop effect's own. */
function switchRow(spec, state) {
  const row = element('div', 'slider slider-toggle');
  row.title = spec.hint;

  const label = element('span', 'slider-label', spec.label);
  label.id = `pulls-${spec.id}-label`;

  const toggle = element('button', 'switch');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-labelledby', label.id);
  const on = state.settings[spec.id] === 1;
  toggle.dataset.on = String(on);
  toggle.setAttribute('aria-checked', String(on));
  toggle.addEventListener('click', () =>
    guard(toggle, async () => {
      const result = await ask({ type: 'gitchop:pulls:settings', patch: { [spec.id]: on ? 0 : 1 } });
      flash('saved');
      current = result;
      render(result);
    }),
  );

  row.append(label, toggle, element('output', null, on ? 'on' : 'off'));
  return row;
}

function render(state, error) {
  host.textContent = '';
  notes.textContent = '';
  const wrap = element('div', 'card-body');

  if (!state?.hasToken) {
    notes.append(
      element(
        'p',
        'note',
        'A classic token with repo, or a fine-grained one with Pull requests: read-only per owner. ' +
          'Without one there is no column.',
      ),
    );
    host.append(tokenGate());
    return;
  }

  // The column's own switch is under Panels with the other columns'; the rest of its settings are here.
  const switches = element('div', 'sliders');
  for (const spec of SWITCHES.filter((spec) => spec.id !== 'enabled')) switches.append(switchRow(spec, state));
  wrap.append(switches);
  if (state.settings.enabled !== 1) notes.append(element('p', 'note', 'The column is switched off under Panels.'));

  const lanes = state.lanes ?? [];
  if (state.settings.enabled === 1 && lanes.some((lane) => lane.pulls !== null)) {
    const facts = element('dl', 'facts');
    for (const lane of lanes) facts.append(element('dt', null, lane.title), element('dd', null, String(lane.total ?? 0)));
    facts.append(element('dt', null, 'Refreshed'), element('dd', null, when(state.fetchedAt)));
    wrap.append(facts);
  }

  if (error ?? state.error) wrap.append(element('p', 'error', error ?? state.error));
  else if (state.partial) wrap.append(element('p', 'error', `One token did not answer: ${state.partial}`));

  if (state.settings.enabled === 1) {
    notes.append(
      element(
        'p',
        'note',
        'A fine-grained token without Pull requests: read-only shows empty lanes rather than an error.',
      ),
    );

    const refresh = button('Refresh now', { primary: true });
    refresh.addEventListener('click', () =>
      guard(refresh, async () => {
        const result = await ask({ type: 'gitchop:pulls:refresh' });
        flash(result.error ? 'failed' : 'refreshed');
        current = result;
        render(result);
      }),
    );
    const actions = element('div', 'actions');
    actions.append(refresh);
    wrap.append(actions);
  }

  host.append(wrap);
}

export async function load() {
  try {
    current = await ask({ type: 'gitchop:pulls' });
    render(current);
  } catch (error) {
    render(current, String(error.message ?? error));
  }
}
