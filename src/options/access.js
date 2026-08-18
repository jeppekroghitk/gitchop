import { api } from '../lib/links.js';

/** Without these, Firefox never injects the content script and the "." key does nothing at all. */
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
      'Firefox treats access to a site as something you grant rather than something an extension ' +
        'takes, and it has not been granted yet. Until it is, gitchop cannot run on GitHub at all — ' +
        'pressing the . key will do nothing, with no error to explain why.',
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
      'Already open GitHub tabs need a reload afterwards — content scripts are injected when a page ' +
        'loads, so tabs opened before the grant are not covered.',
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
