import { tokenLabel } from '../lib/gist.js';
import { api } from '../lib/links.js';
import { tokenGate, tokenState } from './pages.js';

const TOKEN_CLASSIC = 'https://github.com/settings/tokens/new?scopes=repo,gist&description=gitchop';
const TOKEN_FINE = 'https://github.com/settings/personal-access-tokens/new';
/**
 * What GitHub's form is asked to tick: Metadata comes with any repository permission, Pull requests
 * carries the lanes, Issues and Contents with it carry the news. Gists is the backup's, and only the
 * account itself can hold it, so it is asked for only when no other owner is named.
 */
const FINE_GRANTS = { pull_requests: 'read', issues: 'read', contents: 'read' };

/** The owner as GitHub spells it in a URL: trimmed, and without the @ people tend to type. */
function ownerName(value) {
  return String(value ?? '').trim().replace(/^@/, '');
}

/**
 * The form pre-ticked for one owner. The owner has to travel in the link: GitHub clears every tick
 * the moment the owner is changed on the form itself, and a fine-grained token has exactly one.
 */
function fineTokenUrl(owner) {
  const target = ownerName(owner);
  const params = new URLSearchParams({ name: target ? `gitchop ${target}`.slice(0, 40) : 'gitchop', ...FINE_GRANTS });
  if (target) params.set('target_name', target);
  else params.set('gists', 'write');
  return `${TOKEN_FINE}?${params}`;
}

const tokenHost = document.getElementById('sync');
const backupHost = document.getElementById('backup');
/** Under each card: the cautions, the fine print, and what the backup would take. */
const tokenNotes = document.getElementById('token-notes');
const backupNotes = document.getElementById('backup-notes');

let busy = false;
let current = null;
let onTokenChange = () => {};

/** Each card has its own status corner, so a saved token and a pushed gist do not fight over one. */
function flasher(node) {
  let timer = null;
  return (text) => {
    node.textContent = text;
    node.dataset.shown = 'true';
    clearTimeout(timer);
    timer = setTimeout(() => {
      node.dataset.shown = 'false';
    }, 2600);
  };
}

const flash = {
  token: flasher(document.getElementById('sync-status')),
  backup: flasher(document.getElementById('backup-status')),
};

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

/**
 * Guards against a second click while a request is in flight. A failure is reported on the card the
 * button sits in, and the work is handed that card's flash for the same reason.
 */
async function guard(node, card, work) {
  if (busy) return;
  busy = true;
  const label = node.textContent;
  node.textContent = 'working…';
  try {
    await work(flash[card]);
  } catch (error) {
    flash[card]('failed');
    // Keep whatever state we were in — a failed pull must not look like a disconnection.
    render(current, String(error.message ?? error), card);
    return;
  } finally {
    busy = false;
    node.textContent = label;
  }
}

function step(lead, ...controls) {
  const item = element('li');
  const box = element('div', 'step');
  const row = element('div', 'step-row');
  row.append(element('b', null, lead), ...controls);
  box.append(row);
  item.append(box);
  return { item, box };
}

function hint(text) {
  return element('p', 'step-hint', text);
}

/**
 * The way to a fine-grained token, in the order it happens: name the owner, open GitHub's form for
 * that owner, paste what comes back. The link follows the owner typed in the first step, and the form
 * it opens arrives with the permissions gitchop needs already ticked for that owner — blank is the
 * account itself, whose token also carries the backup's gist. Saving is the third step, so the whole
 * thing reads top to bottom.
 */
function fineSteps({ placeholder, saveLabel, primary }) {
  const list = element('ol', 'steps');

  const owner = textInput({ placeholder: 'organisation, exact name', label: 'Owner of the fine-grained token' });
  owner.className = 'owner';
  const one = step('Owner', owner);
  one.box.append(
    hint(
      'Type the exact name of your organisation, as it appears in github.com/‹name›. Leave it blank ' +
        'for a token on your own account.',
    ),
  );

  const anchor = link('', '');
  const two = step('Create', anchor);
  const ticked = hint('');
  two.box.append(ticked);

  const token = textInput({ password: true, placeholder, label: 'GitHub token' });
  const save = button(saveLabel, { primary });
  save.addEventListener('click', () =>
    guard(save, 'token', async (flash) => {
      if (!(await consent(['authenticationInfo']))) {
        flash('not allowed');
        return;
      }
      const result = await ask({ type: 'gitchop:token:save', token: token.value });
      flash('saved');
      current = result;
      render(result);
      onTokenChange();
    }),
  );
  const three = step('Paste', token, save);
  three.box.append(hint('A fine-grained token reaches one owner. Add another for each organisation.'));

  const follow = () => {
    const target = ownerName(owner.value);
    anchor.href = fineTokenUrl(target);
    anchor.textContent = target ? `Open GitHub’s form for @${target} →` : 'Open GitHub’s form for your own account →';
    ticked.textContent =
      (target
        ? `The form opens for @${target} with the permissions gitchop needs already ticked: Pull requests, Issues and Contents, read-only. `
        : 'The form opens for your account with the permissions gitchop needs already ticked: Pull requests, Issues and Contents, read-only, and Gists for the backup. ') +
      'You only choose the repositories and an expiration. Leave the owner as it is: changing it on the form clears the ticks.';
  };
  owner.addEventListener('input', follow);
  follow();

  list.append(one.item, two.item, three.item);
  return list;
}

function recipeHead(title, tag) {
  const head = element('div', 'recipe-head');
  head.append(element('span', null, title));
  if (tag) head.append(element('span', 'recipe-tag', tag));
  return head;
}

/**
 * The classic token is kept reachable, because some organisations still allow nothing else, but it is
 * warned against rather than offered: repo is write everywhere the account reaches.
 */
function classicCaution() {
  const box = element('div', 'caution');
  box.append(
    element('b', null, 'Avoid classic tokens'),
    element(
      'p',
      null,
      'A classic token cannot be read-only. The repo scope it needs also grants write access to every ' +
        'repository your account can reach, in every organisation you belong to, and gitchop only ever ' +
        'reads. Use one only if your organisation does not allow fine-grained tokens.',
    ),
    link('Classic token anyway, repo + gist →', TOKEN_CLASSIC),
  );
  return box;
}

function fineprint() {
  const box = element('details', 'fineprint');
  box.append(
    element('summary', null, 'How tokens are stored'),
    element(
      'p',
      null,
      'Tokens are stored outside synced storage, obfuscated rather than left as readable text, only ' +
        'ever sent to api.github.com, and never handed to a web page. Each is used for five calls and ' +
        'no others: who the account is, which repositories it can see, which open pull requests are ' +
        'yours or want your review, what happened lately in the repositories you subscribe to, and ' +
        'reading and writing the one gist. Obfuscation is not encryption — anyone with access to this ' +
        'profile can still recover them — but a token no longer sits in the profile as searchable text.',
    ),
  );
  return box;
}

/**
 * The same recipe whether or not a token is saved yet, and always at the top of the card: a second
 * organisation is the same three steps again, and what gets pasted lands in the list right beneath.
 */
function recipe() {
  const wrap = element('div', 'recipe');
  wrap.append(
    recipeHead('Fine-grained token', 'recommended'),
    fineSteps({ placeholder: 'github_pat_…', saveLabel: 'Save token', primary: true }),
  );
  return wrap;
}

function noToken(error) {
  const wrap = element('div', 'card-body');
  wrap.append(recipe());
  if (error) wrap.append(element('p', 'error', error));
  tokenNotes.append(classicCaution(), fineprint());
  return wrap;
}

/**
 * What a token has been given, and where: the scopes of a classic token, so an over-broad one cannot
 * hide, and the owner whose private repositories a fine-grained one reaches, so two organisations'
 * tokens can be told apart. One that reaches no private repository says so: every token can list
 * public ones, and a token an organisation has yet to approve can list nothing else.
 */
function tokenDetail(entry) {
  const kind = entry.kind ?? 'token';
  if (entry.scopes.length > 0) return `${kind} — ${entry.scopes.join(', ')}`;
  if (entry.kind !== 'classic' && Array.isArray(entry.owners) && entry.owners.length === 0) {
    return `${kind} — reaches no private repositories yet`;
  }
  return entry.kind ?? 'saved';
}

function tokenList(sync) {
  const wrap = element('div', 'tokens');
  for (const entry of sync.tokens) {
    const row = element('div', 'token');

    const label = element('div', 'token-name');
    label.append(element('b', null, tokenLabel(entry)), element('span', 'token-detail', tokenDetail(entry)));
    if (entry.broad) label.append(element('span', 'token-warn', 'writes'));

    const drop = button('Remove');
    drop.addEventListener('click', () =>
      guard(drop, 'token', async (flash) => {
        const result = await ask({ type: 'gitchop:token:remove', id: entry.id });
        flash('removed');
        current = result;
        render(result);
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
  const box = element('div', 'caution');
  box.append(
    element('b', null, 'Classic token: grants write'),
    element(
      'p',
      null,
      `Marked "writes": ${scopes}. This token can write to every repository the account can reach, in ` +
        'every organisation, and gitchop never uses that. Replace it with a fine-grained token from the ' +
        'steps above and revoke it on GitHub. If it has to stay, keep an expiry on it.',
    ),
  );
  return box;
}

/** The recipe first, then what it has produced so far; the warning about any classic row goes under the box. */
function tokenCard(sync, error) {
  const wrap = element('div', 'card-body');
  const saved = element('div', 'recipe');
  saved.append(recipeHead('Saved tokens'), tokenList(sync));
  wrap.append(recipe(), saved);
  if (error) wrap.append(element('p', 'error', error));
  const warn = broadWarning(sync);
  if (warn) tokenNotes.append(warn);
  tokenNotes.append(fineprint());
  return wrap;
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

/** Without a token there is nothing to write the gist with, so the card only says what it would take. */
function backupNeedsToken() {
  backupNotes.append(
    element(
      'p',
      'note',
      'Needs a token under Tokens: a fine-grained one for your own account, made with the owner left ' +
        'blank, or a classic one with gist. gitchop uses whichever saved token can write the gist.',
    ),
  );
  return tokenGate();
}

function backupOff(sync, error) {
  const wrap = element('div', 'card-body');
  backupNotes.append(
    element(
      'p',
      'note',
      'Leave the field empty and a new secret gist is made from your current links. Paste the id of a ' +
        'gist gitchop made before to adopt it instead; the list in it replaces this one.',
    ),
  );

  const gist = textInput({ placeholder: 'existing gist id (leave empty to create one)', label: 'Gist id' });
  const fields = element('div', 'form');
  fields.append(field('Gist', gist));

  const enable = button('Enable backup', { primary: true });
  enable.addEventListener('click', () =>
    guard(enable, 'backup', async (flash) => {
      if (!(await consent(['bookmarksInfo']))) {
        flash('not allowed');
        return;
      }
      const result = await ask({ type: 'gitchop:sync:connect', gistId: gist.value });
      flash('backing up');
      current = result;
      render(result);
    }),
  );

  const actions = element('div', 'actions');
  actions.append(enable);

  wrap.append(fields);
  if (error ?? sync.lastError) wrap.append(element('p', 'error', error ?? sync.lastError));
  wrap.append(actions);
  return wrap;
}

function backupOn(sync, error) {
  const wrap = element('div', 'card-body');
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
    guard(pull, 'backup', async (flash) => {
      if (sync.dirty && !confirm('There are local changes that have not reached the gist yet. Pull anyway and lose them?')) return;
      const result = await ask({ type: 'gitchop:sync:pull', force: true });
      flash(result.changed ? 'pulled' : 'already current');
      await load();
    }),
  );

  const push = button('Push now');
  push.title = 'Write the local list to the gist';
  push.addEventListener('click', () =>
    guard(push, 'backup', async (flash) => {
      const result = await ask({ type: 'gitchop:sync:push', force: true });
      flash(result.changed ? 'pushed' : 'already current');
      await load();
    }),
  );

  const stop = button('Stop backup');
  stop.title = 'Leave the gist alone and stop writing to it';
  stop.addEventListener('click', () =>
    guard(stop, 'backup', async (flash) => {
      if (!confirm('Stop backing up to the gist? Your tokens and the gist itself are left alone.')) return;
      const result = await ask({ type: 'gitchop:sync:stop' });
      flash('stopped');
      current = result;
      render(result);
    }),
  );

  const actions = element('div', 'actions');
  actions.append(stop, pull, push);

  if (error ?? sync.lastError) wrap.append(element('p', 'error', error ?? sync.lastError));
  wrap.append(actions);
  return wrap;
}

/**
 * Both cards are drawn from the one state the background keeps. An error is shown on the card whose
 * button produced it; the background's own lastError is the gist's, so the backup card carries that.
 */
function render(sync, error, card = 'token') {
  const tokenError = card === 'token' ? error : null;
  const backupError = card === 'backup' ? error : null;
  tokenState(Boolean(sync?.hasToken));

  tokenHost.textContent = '';
  tokenNotes.textContent = '';
  tokenHost.append(sync?.hasToken ? tokenCard(sync, tokenError) : noToken(tokenError));

  backupHost.textContent = '';
  backupNotes.textContent = '';
  if (sync?.connected) backupHost.append(backupOn(sync, backupError));
  else if (sync?.hasToken) backupHost.append(backupOff(sync, backupError));
  else backupHost.append(backupNeedsToken());
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
