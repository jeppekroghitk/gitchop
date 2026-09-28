import { api } from '../lib/links.js';
import { HOUR, isRepoName, proseText } from '../lib/news.js';

const host = document.getElementById('news');
const statusEl = document.getElementById('news-status');
/** Under the card: what is worth knowing about the settings as they stand. */
const notes = document.getElementById('news-notes');

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

function link(text, href) {
  const node = element('a', 'link', text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noreferrer';
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

async function apply(message, word) {
  const result = await ask(message);
  flash(word);
  current = result;
  render(result);
}

function clock(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** The hour the edition is made up; saved when the thumb is let go of, shown as a time while it moves. */
function hourRow(state) {
  const row = element('div', 'slider');
  row.title = HOUR.hint;

  const label = element('label', null, HOUR.label);
  label.htmlFor = 'news-hour';

  const input = element('input');
  input.type = 'range';
  input.id = 'news-hour';
  input.min = String(HOUR.min);
  input.max = String(HOUR.max);
  input.step = '1';
  input.value = String(state.settings.hour);
  input.disabled = state.settings.enabled !== 1;

  const output = element('output', null, clock(state.settings.hour));
  output.htmlFor = input.id;

  input.addEventListener('input', () => {
    output.textContent = clock(Number(input.value));
  });
  input.addEventListener('change', () =>
    guard(input, () => apply({ type: 'gitchop:news:settings', patch: { hour: Number(input.value) } }, 'saved')),
  );

  row.append(label, input, output);
  return row;
}

/** Every subscribed repository, with what the edition made of it and a way out. */
function repoList(state) {
  const wrap = element('div', 'tokens');
  for (const entry of state.repos) {
    const row = element('div', 'token');
    const name = element('div', 'token-name');
    name.append(link(entry.repo, entry.url));

    let detail;
    if (entry.prose === null) detail = 'not in this edition yet';
    else if (entry.error) detail = entry.error;
    else if (entry.quiet) detail = 'quiet';
    else detail = proseText(entry.prose);
    const detailEl = element('span', 'token-detail', detail);
    detailEl.title = detail;
    name.append(detailEl);
    if (entry.error) name.append(element('span', 'token-warn', 'failed'));

    const drop = button('Unsubscribe');
    drop.addEventListener('click', () => guard(drop, () => apply({ type: 'gitchop:news:unsubscribe', repo: entry.repo }, 'unsubscribed')));

    row.append(name, drop);
    wrap.append(row);
  }
  return wrap;
}

function addRepo() {
  const input = element('input');
  input.type = 'text';
  input.placeholder = 'owner/repository';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Repository to subscribe to');

  const field = element('label', 'field');
  field.append(element('span', 'field-label', 'Subscribe'), input);
  const fields = element('div', 'form');
  fields.append(field);

  const save = button('Subscribe', { primary: true });
  const submit = () =>
    guard(save, async () => {
      const name = input.value.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/+$/, '');
      if (!isRepoName(name)) throw new Error('That is not a repository name. Use owner/repository, or paste its GitHub URL.');
      await apply({ type: 'gitchop:news:subscribe', repo: name }, 'subscribed');
      // The edition is made up in the background; the card shows the repository the moment it lands.
      ask({ type: 'gitchop:news:refresh' })
        .then((result) => {
          current = result;
          render(result);
        })
        .catch(() => {});
    });
  save.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  const actions = element('div', 'actions');
  actions.append(save);
  const wrap = element('div', 'add-token');
  wrap.append(fields, actions);
  return wrap;
}

function render(state, error) {
  host.textContent = '';
  notes.textContent = '';
  const wrap = element('div', 'card-body');

  if (!state) {
    if (error) wrap.append(element('p', 'error', error));
    host.append(wrap);
    return;
  }

  // The column's own switch is under Panels with the other columns'; the hour is here.
  const controls = element('div', 'sliders');
  controls.dataset.off = String(state.settings.enabled !== 1);
  controls.append(hourRow(state));
  wrap.append(controls);
  if (state.settings.enabled !== 1) notes.append(element('p', 'note', 'The column is switched off under Panels.'));

  if (state.repos.length > 0) {
    wrap.append(repoList(state));
    const facts = element('dl', 'facts');
    facts.append(element('dt', null, 'Edition'), element('dd', null, state.fetchedAt ? `${when(state.until)} — ${state.sinceLabel}` : `not made up yet — ${state.sinceLabel}`));
    facts.append(element('dt', null, 'Fetched'), element('dd', null, when(state.fetchedAt)));
    wrap.append(facts);
  } else {
    notes.append(
      element(
        'p',
        'note',
        'Nothing subscribed yet. In the menu, → on a repository row and choose Subscribe to news, or ' +
          'name one above.',
      ),
    );
  }

  wrap.append(addRepo());

  if (error) wrap.append(element('p', 'error', error));

  notes.append(
    element(
      'p',
      'note',
      'Public repositories need no token. A private one needs a saved token that can see it: repo on ' +
        'a classic token, or Contents, Pull requests and Issues read-only on a fine-grained one.',
    ),
  );

  if (state.repos.length > 0) {
    const refresh = button('Refresh now', { primary: true });
    refresh.title = 'Ask GitHub again for this edition; the window it covers does not move';
    refresh.addEventListener('click', () =>
      guard(refresh, () => apply({ type: 'gitchop:news:refresh', force: true }, 'refreshed')),
    );
    const actions = element('div', 'actions');
    actions.append(refresh);
    wrap.append(actions);
  }

  host.append(wrap);
}

export async function load() {
  try {
    current = await ask({ type: 'gitchop:news' });
    render(current);
  } catch (error) {
    render(current, String(error.message ?? error));
  }
}

/**
 * A subscription made in the menu lands in sync storage, and the edition lands in local storage
 * when the background is done; the card follows both without a reload — unless a name is being
 * typed into it, which a redraw would take away.
 */
export function watch() {
  api.storage.onChanged.addListener((changes, area) => {
    if (!((area === 'sync' && changes.news) || (area === 'local' && changes.newsCache))) return;
    if (busy) return;
    const typing = host.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.value;
    if (!typing) load();
  });
}
