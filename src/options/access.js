import { api } from '../lib/links.js';

/** Without these, the content script is never injected and the "." key does nothing at all. */
const NEEDED = { origins: ['https://github.com/*', 'https://api.github.com/*'] };

const card = document.getElementById('access-card');
const host = document.getElementById('access');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function granted() {
  try {
    return await api.permissions.contains(NEEDED);
  } catch {
    return true;
  }
}

function render(ok, note) {
  card.hidden = ok;
  host.textContent = '';
  if (ok) return;

  const wrap = element('div', 'card-body');
  wrap.append(
    element(
      'p',
      'note',
      'This browser has not granted gitchop access to github.com yet. Until it does, pressing . there ' +
        'does nothing.',
    ),
  );

  const grant = element('button', 'btn btn-primary', 'Grant access to github.com');
  grant.type = 'button';
  grant.addEventListener('click', async () => {
    grant.textContent = 'waiting…';
    let allowed = false;
    try {
      allowed = await api.permissions.request(NEEDED);
    } catch (error) {
      render(false, String(error.message ?? error));
      return;
    }
    if (allowed) render(true);
    else render(false, 'Access was declined. gitchop stays inert until it is allowed.');
  });

  const actions = element('div', 'actions');
  actions.append(grant);
  wrap.append(actions);

  if (note) wrap.append(element('p', 'error', note));
  wrap.append(
    element(
      'p',
      'note',
      'GitHub tabs already open need a reload afterwards.',
    ),
  );

  host.append(wrap);
}

export async function load() {
  render(await granted());
}

export function watch() {
  api.permissions.onAdded?.addListener(() => load());
  api.permissions.onRemoved?.addListener(() => load());
}
