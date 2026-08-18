import {
  DEFAULT_LINKS,
  PLACEHOLDERS,
  STORAGE_KEY,
  api,
  isSafeUrl,
  loadLinks,
  newId,
  saveLinks,
  withIds,
} from '../lib/links.js';
import { load as loadSync, watch as watchSync } from './sync.js';
import { load as loadIndex } from './repo-index.js';
import { load as loadAccess, watch as watchAccess } from './access.js';

const rowsEl = document.getElementById('rows');
const statusEl = document.getElementById('status');
const tokensEl = document.getElementById('tokens');

let links = [];
let saveTimer = null;
let lastWritten = '';
let statusTimer = null;

function flash(text) {
  statusEl.textContent = text;
  statusEl.dataset.shown = 'true';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.dataset.shown = 'false';
  }, 1400);
}

async function commit() {
  clearTimeout(saveTimer);
  saveTimer = null;
  lastWritten = JSON.stringify(links);
  try {
    await saveLinks(links);
    flash('saved');
  } catch (error) {
    flash('save failed');
    console.error('gitchop: could not save links', error);
  }
}

function scheduleCommit() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(commit, 400);
}

function field({ className, placeholder, value, label, maxLength }) {
  const input = document.createElement('input');
  input.type = 'text';
  if (className) input.className = className;
  input.placeholder = placeholder;
  input.value = value ?? '';
  input.setAttribute('aria-label', label);
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (maxLength) input.maxLength = maxLength;
  return input;
}

function iconButton(glyph, label, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn-icon ${className ?? ''}`.trim();
  button.textContent = glyph;
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

function move(link, delta) {
  const from = links.indexOf(link);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= links.length) return;
  links.splice(to, 0, ...links.splice(from, 1));
  render();
  commit();
}

function remove(link) {
  links = links.filter((candidate) => candidate !== link);
  render();
  commit();
}

function buildRow(link, index) {
  const row = document.createElement('div');
  row.className = 'row';

  const icon = field({ className: 'icon', placeholder: '🔗', value: link.icon, label: 'Icon', maxLength: 4 });
  const label = field({ placeholder: 'Label', value: link.label, label: 'Label', maxLength: 80 });
  const url = field({ className: 'url', placeholder: 'https://github.com/{repoFull}/actions', value: link.url, label: 'URL' });

  icon.addEventListener('input', () => {
    link.icon = icon.value;
    scheduleCommit();
  });
  label.addEventListener('input', () => {
    link.label = label.value;
    scheduleCommit();
  });
  url.addEventListener('input', () => {
    link.url = url.value;
    url.dataset.invalid = String(url.value.trim() !== '' && !isSafeUrl(url.value));
    scheduleCommit();
  });
  url.dataset.invalid = String(link.url !== '' && !isSafeUrl(link.url));

  for (const input of [icon, label, url]) {
    input.addEventListener('change', commit);
  }

  const up = iconButton('↑', 'Move up');
  const down = iconButton('↓', 'Move down');
  const del = iconButton('✕', 'Delete link', 'btn-danger');
  up.disabled = index === 0;
  down.disabled = index === links.length - 1;
  up.addEventListener('click', () => move(link, -1));
  down.addEventListener('click', () => move(link, 1));
  del.addEventListener('click', () => remove(link));

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.append(up, down, del);

  row.append(icon, label, url, actions);
  return row;
}

function render() {
  rowsEl.textContent = '';
  if (links.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No links yet. Add one below, or restore the defaults.';
    rowsEl.append(empty);
    return;
  }
  links.forEach((link, index) => rowsEl.append(buildRow(link, index)));
}

function renderTokens() {
  for (const [token, description] of PLACEHOLDERS) {
    const dt = document.createElement('dt');
    dt.textContent = token;
    const dd = document.createElement('dd');
    dd.textContent = description;
    tokensEl.append(dt, dd);
  }
}

document.getElementById('add').addEventListener('click', () => {
  links.push({ id: newId(), icon: '', label: '', url: '' });
  render();
  rowsEl.lastElementChild?.querySelectorAll('input')[1]?.focus();
  commit();
});

document.getElementById('reset').addEventListener('click', () => {
  if (!confirm('Replace your links with the defaults?')) return;
  links = withIds(DEFAULT_LINKS);
  render();
  commit();
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes[STORAGE_KEY]) return;
  const incoming = JSON.stringify(changes[STORAGE_KEY].newValue ?? []);
  if (incoming === lastWritten || saveTimer) return;
  loadLinks().then((stored) => {
    links = stored;
    render();
  });
});

window.addEventListener('beforeunload', () => {
  if (saveTimer) commit();
});

// Straight from the manifest, so there is only ever one place the version is written down.
const { name, version } = api.runtime.getManifest();
document.getElementById('version').textContent = `${name} ${version}`;

links = await loadLinks();
lastWritten = JSON.stringify(links);
render();
renderTokens();
watchAccess();
await loadAccess();
// A token appearing or disappearing changes what the index card can offer.
watchSync(() => loadIndex());
await loadSync();
await loadIndex();
