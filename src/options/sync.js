import { api } from '../lib/links.js';

const TOKEN_CLASSIC = 'https://github.com/settings/tokens/new?scopes=repo,gist&description=gitchop';
const TOKEN_FINE = 'https://github.com/settings/personal-access-tokens/new';

const host = document.getElementById('sync');
const statusEl = document.getElementById('sync-status');

let statusTimer = null;
let busy = false;
let current = null;
let onTokenChange = () => {};

function flash(text) {
  statusEl.textContent = text;
  statusEl.dataset.shown = 'true';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.dataset.shown = 'false';
  }, 2600);
}

/**
 * Holding a token and shipping the link list are declared as optional data collection, so consent
 * is asked for here rather than at install. Firefox before 140 has no such gate and throws instead
 * of answering — there is nothing to consent to there.
 */
async function consent(types) {
  const wanted = { data_collection: types };
  try {
    if (await api.permissions.contains(wanted)) return true;
    return await api.permissions.request(wanted);
  } catch {
    return true;
  }
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

function field(text, input) {
  const row = element('label', 'field');
  row.append(element('span', 'field-label', text), input);
  return row;
}

function textInput({ password = false, placeholder = '', label = '' } = {}) {
  const input = element('input');
  input.type = password ? 'password' : 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  return input;
}

/** Guards against a second click while a request is in flight. */
async function guard(node, work) {
  if (busy) return;
  busy = true;
  const label = node.textContent;
  node.textContent = 'working…';
  try {
    await work();
  } catch (error) {
    flash('failed');
    // Keep whatever state we were in — a failed pull must not look like a disconnection.
    render(current, String(error.message ?? error));
    return;
  } finally {
    busy = false;
    node.textContent = label;
  }
}

function recipe() {
  const wrap = element('div', 'recipe');
  wrap.append(element('p', 'note', 'One classic token covers everything, including every organisation you belong to:'));

  const steps = element('ol', 'steps');
  const items = [
    ['Scopes', 'repo and gist. repo is what lists private repositories; gist is only for the backup, so leave it off if you do not want that.'],
    ['Expiration', 'set one. When it lapses, search stops and this page reports the rejection — nothing is lost, and it beats a credential with no end date.'],
    ['Nothing else', 'no other scope is needed or used.'],
  ];
  for (const [term, detail] of items) {
    const step = element('li');
    step.append(element('b', null, term), document.createTextNode(` — ${detail}`));
    steps.append(step);
  }
  wrap.append(steps);
  wrap.append(
    element(
      'p',
      'note',
      'Worth knowing what you are handing over: classic tokens have no read-only scope for private ' +
        'repositories, so repo also grants write to every repository the account can reach. gitchop only ' +
        'ever lists them. If you would rather grant less, a fine-grained token with Metadata read-only ' +
        'lists them without the write — but it covers one owner each, so two organisations means two ' +
        'tokens, and an organisation may require an owner to approve them. Add as many as you like below.',
    ),
  );
  return wrap;
}

function noToken(error) {
  const wrap = element('div', 'card-body');
  wrap.append(
    element(
      'p',
      'note',
      'One token unlocks two things: finding private repositories, which GitHub’s search will not ' +
        'return, and backing your links up to a secret gist.',
    ),
  );
  wrap.append(recipe());

  const token = textInput({ password: true, placeholder: 'github_pat_… or ghp_…', label: 'GitHub token' });
  const fields = element('div', 'form');
  fields.append(field('Token', token));

  const save = button('Save token', { primary: true });
  save.addEventListener('click', () =>
    guard(save, async () => {
      if (!(await consent(['authenticationInfo']))) {
        flash('not allowed');
        return;
      }
      await ask({ type: 'gitchop:token:save', token: token.value });
      flash('saved');
      await load();
      onTokenChange();
    }),
  );

  const actions = element('div', 'actions');
  actions.append(save);

  const scopes = element('ul', 'scopes');
  const classic = element('li');
  classic.append(link('Classic token, repo + gist →', TOKEN_CLASSIC), document.createTextNode(' simplest'));
  const fine = element('li');
  fine.append(
    link('Fine-grained token →', TOKEN_FINE),
    document.createTextNode(' tighter, one per organisation'),
  );
  scopes.append(classic, fine);

  wrap.append(fields, actions, scopes);
  if (error) wrap.append(element('p', 'error', error));
  wrap.append(
    element(
      'p',
      'note',
      'Tokens are stored outside synced storage, obfuscated rather than left as readable text, only ' +
        'ever sent to api.github.com, and never handed to a web page. Each is used for three calls and ' +
        'no others: who the account is, which repositories it can see, and reading and writing the one ' +
        'gist. Obfuscation is not encryption — anyone with access to this profile can still recover ' +
        'them — but a token no longer sits in the profile as searchable text.',
    ),
  );
  return wrap;
}

/** Lists what has actually been handed over, so an over-broad token cannot hide. */
function tokenList(sync) {
  const wrap = element('div', 'tokens');
  for (const entry of sync.tokens) {
    const row = element('div', 'token');
    const name = entry.login ? `@${entry.login}` : 'token';
    const detail = entry.scopes.length > 0 ? `${entry.kind ?? 'token'} — ${entry.scopes.join(', ')}` : entry.kind ?? 'saved';

    const label = element('div', 'token-name');
    label.append(element('b', null, name), element('span', 'token-detail', detail));
    if (entry.broad) label.append(element('span', 'token-warn', 'writes'));

    const drop = button('Remove');
    drop.addEventListener('click', () =>
      guard(drop, async () => {
        const result = await ask({ type: 'gitchop:token:remove', id: entry.id });
        flash('removed');
        render(result);
        current = result;
        onTokenChange();
      }),
    );

    row.append(label, drop);
    wrap.append(row);
  }
  return wrap;
}

function broadWarning(sync) {
  const broad = sync.tokens.filter((entry) => entry.broad);
  if (broad.length === 0) return null;
  const scopes = [...new Set(broad.flatMap((entry) => entry.scopes))]
    .filter((scope) => /^(repo|workflow|delete_repo|admin:|write:)/.test(scope))
    .join(', ');
  return element(
    'p',
    'note',
    `Marked "writes": ${scopes}. That is expected of a classic token — repo is the only scope that ` +
      'lists private repositories and it carries write with it, which gitchop never uses. Keep an ' +
      'expiry on it, and revoke it rather than leaving it idle if you stop using gitchop.',
  );
}

function facts(rows) {
  const list = element('dl', 'facts');
  for (const [term, value] of rows) {
    const dd = element('dd');
    dd.append(typeof value === 'string' ? document.createTextNode(value) : value);
    list.append(element('dt', null, term), dd);
  }
  return list;
}

function addAnother() {
  const token = textInput({ password: true, placeholder: 'another github_pat_… for a second owner', label: 'GitHub token' });
  const fields = element('div', 'form');
  fields.append(field('Add', token));

  const save = button('Save');
  save.addEventListener('click', () =>
    guard(save, async () => {
      if (!(await consent(['authenticationInfo']))) {
        flash('not allowed');
        return;
      }
      const result = await ask({ type: 'gitchop:token:save', token: token.value });
      flash('saved');
      render(result);
      current = result;
      onTokenChange();
    }),
  );

  const actions = element('div', 'actions');
  actions.append(save);
  const wrap = element('div', 'add-token');
  wrap.append(fields, actions);
  return wrap;
}

function tokenOnly(sync, error) {
  const wrap = element('div', 'card-body');
  wrap.append(tokenList(sync));
  const warn = broadWarning(sync);
  if (warn) wrap.append(warn);
  wrap.append(
    element(
      'p',
      'note',
      'The token is in place, so private repository search works as soon as the index below is built. ' +
        'Backup is separate and off: switch it on and your links are written to a secret gist on every ' +
        'change, with the gist’s revision history as the safety net.',
    ),
  );

  const gist = textInput({ placeholder: 'existing gist id (leave empty to create one)', label: 'Gist id' });
  const fields = element('div', 'form');
  fields.append(field('Gist', gist));

  const enable = button('Enable backup', { primary: true });
  enable.addEventListener('click', () =>
    guard(enable, async () => {
      if (!(await consent(['bookmarksInfo']))) {
        flash('not allowed');
        return;
      }
      const result = await ask({ type: 'gitchop:sync:connect', gistId: gist.value });
      flash('backing up');
      render(result);
      current = result;
    }),
  );

  const actions = element('div', 'actions');
  actions.append(enable);

  wrap.append(addAnother(), fields);
  if (error ?? sync.lastError) wrap.append(element('p', 'error', error ?? sync.lastError));
  wrap.append(actions);
  return wrap;
}

function connected(sync, error) {
  const wrap = element('div', 'card-body');

  wrap.append(tokenList(sync));
  const warn = broadWarning(sync);
  if (warn) wrap.append(warn);
  wrap.append(
    facts([
      ['Gist', link(sync.gistId, sync.gistUrl)],
      ['Last pulled', when(sync.lastPulledAt)],
      ['Last pushed', sync.dirty ? `${when(sync.lastPushedAt)} — changes pending` : when(sync.lastPushedAt)],
    ]),
  );

  const pull = button('Pull now');
  pull.title = 'Replace the local list with the gist';
  pull.addEventListener('click', () =>
    guard(pull, async () => {
      if (sync.dirty && !confirm('There are local changes that have not reached the gist yet. Pull anyway and lose them?')) return;
      const result = await ask({ type: 'gitchop:sync:pull', force: true });
      flash(result.changed ? 'pulled' : 'already current');
      await load();
    }),
  );

  const push = button('Push now');
  push.title = 'Write the local list to the gist';
  push.addEventListener('click', () =>
    guard(push, async () => {
      const result = await ask({ type: 'gitchop:sync:push', force: true });
      flash(result.changed ? 'pushed' : 'already current');
      await load();
    }),
  );

  const stop = button('Stop backup');
  stop.title = 'Leave the gist alone and stop writing to it';
  stop.addEventListener('click', () =>
    guard(stop, async () => {
      if (!confirm('Stop backing up to the gist? Your tokens and the gist itself are left alone.')) return;
      const result = await ask({ type: 'gitchop:sync:stop' });
      flash('stopped');
      render(result);
      current = result;
    }),
  );

  const actions = element('div', 'actions');
  actions.append(stop, pull, push);

  wrap.append(addAnother());

  if (error ?? sync.lastError) wrap.append(element('p', 'error', error ?? sync.lastError));
  wrap.append(actions);
  return wrap;
}

function render(sync, error) {
  host.textContent = '';
  if (sync?.connected) host.append(connected(sync, error));
  else if (sync?.hasToken) host.append(tokenOnly(sync, error));
  else host.append(noToken(error));
}

export async function load() {
  try {
    current = await ask({ type: 'gitchop:sync:state' });
    render(current);
  } catch (error) {
    render(current, String(error.message ?? error));
  }
}

/** Saving a link marks the config dirty in the background; reflect that without a reload. */
export function watch(afterTokenChange) {
  if (afterTokenChange) onTokenChange = afterTokenChange;
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sync) load();
  });
}
