import { api } from '../lib/links.js';

const host = document.getElementById('index');
const statusEl = document.getElementById('index-status');

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

function render(index, error) {
  host.textContent = '';
  const wrap = element('div', 'card-body');

  wrap.append(
    element(
      'p',
      'note',
      'GitHub’s search will not show you private repositories, so gitchop keeps its own list of the ' +
        'repositories your token can reach and matches that first. It is held on this machine only, it ' +
        'answers instantly with no request per keystroke, and it covers private repositories that search ' +
        'cannot see.',
    ),
  );

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

    wrap.append(
      element(
        'p',
        'note',
        'Check that list. An organisation missing from it is an organisation the token was never granted, ' +
          'or one whose owner has not approved the token yet — the request succeeds either way and simply ' +
          'returns less, which is the one failure GitHub will not tell you about.',
      ),
    );

    if (index.privateCount === 0) {
      wrap.append(
        element(
          'p',
          'error',
          'No private repositories came back. The token can list repositories but cannot see private ones: ' +
            'a fine-grained token needs Metadata read-only, and the organisation it was created for has to ' +
            'be its resource owner.',
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
    render(await ask({ type: 'gitchop:index:state' }));
  } catch (error) {
    render(null, String(error.message ?? error));
  }
}
