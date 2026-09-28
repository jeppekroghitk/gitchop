import { api } from '../lib/links.js';
import { tokenGate } from './pages.js';

const host = document.getElementById('index');
const statusEl = document.getElementById('index-status');
/** Under the card: what is worth knowing about the index as it stands. */
const notes = document.getElementById('index-notes');

let statusTimer = null;
let busy = false;

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
    render(null, String(error.message ?? error));
    return;
  } finally {
    busy = false;
    node.textContent = label;
  }
}

/** Whether a token is saved: the index is built from one, so without it there is nothing to build. */
let tokened = false;

function render(index, error) {
  host.textContent = '';
  notes.textContent = '';

  if (!tokened) {
    host.append(tokenGate());
    notes.append(element('p', 'note', 'The index is the repositories a token can reach; without one there is nothing to build.'));
    return;
  }

  const wrap = element('div', 'card-body');
  if (!(index && index.count > 0)) wrap.append(element('p', 'empty', 'No index built yet.'));

  if (index && index.count > 0) {
    const facts = element('dl', 'facts');
    const rows = [
      ['Repositories', `${index.count}`],
      ['Private', `${index.privateCount}`],
      ['Accounts', (index.owners ?? []).map(({ owner, count }) => `${owner} (${count})`).join(', ') || 'none'],
      ['Built', when(index.builtAt)],
    ];
    for (const [term, value] of rows) {
      facts.append(element('dt', null, term), element('dd', null, value));
    }
    wrap.append(facts);

    notes.append(
      element(
        'p',
        'note',
        'Check the private count as much as the list: any token lists an organisation’s public ' +
          'repositories, so one that never granted the token, or has not approved it yet, still shows ' +
          'up here with only its private ones missing. GitHub returns less rather than an error.',
      ),
    );

    if (index.privateCount === 0) {
      wrap.append(
        element(
          'p',
          'error',
          'No private repositories came back. A fine-grained token needs Metadata: read-only with the ' +
            'organisation as its resource owner, and an owner’s approval where the organisation requires ' +
            'one; until then it lists public repositories only.',
        ),
      );
    }
  }

  if (error) wrap.append(element('p', 'error', error));

  const build = button(index && index.count > 0 ? 'Refresh' : 'Build index', { primary: true });
  build.addEventListener('click', () =>
    guard(build, async () => {
      const result = await ask({ type: 'gitchop:index:build' });
      flash(`${result.count} indexed`);
      render(result);
    }),
  );

  const actions = element('div', 'actions');
  if (index && index.count > 0) {
    const clear = button('Clear');
    clear.addEventListener('click', () =>
      guard(clear, async () => {
        const result = await ask({ type: 'gitchop:index:clear' });
        flash('cleared');
        render(result);
      }),
    );
    actions.append(clear);
  }
  actions.append(build);
  wrap.append(actions);

  host.append(wrap);
}

export async function load() {
  try {
    const [index, sync] = await Promise.all([ask({ type: 'gitchop:index:state' }), ask({ type: 'gitchop:sync:state' })]);
    tokened = Boolean(sync.hasToken);
    render(index);
  } catch (error) {
    render(null, String(error.message ?? error));
  }
}
