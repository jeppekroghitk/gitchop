import { tokenLabel } from '../lib/gist.js';
import { api } from '../lib/links.js';
import { send } from '../lib/messages.js';
import { show, tokenGate, tokenState } from './pages.js';
import { resumeAfterCache, resumeSignIn, signInBlock, stopSignIn } from './signin.js';

/** @import { Answer, Message, MessageType } from '../background/messages.js' */

/**
 * read:user is what lets a classic token count private contributions; GitHub's schema ties them to
 * that scope, not to repo.
 */
const TOKEN_CLASSIC = 'https://github.com/settings/tokens/new?scopes=repo,gist,read:user&description=gitchop';
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

const tokenHost = /** @type {HTMLElement} */ (document.getElementById('sync'));
const tokensHost = /** @type {HTMLElement} */ (document.getElementById('pat-card'));
const backupHost = /** @type {HTMLElement} */ (document.getElementById('backup'));
/** Under each card: the cautions, the fine print, and what the backup would take. */
const tokenNotes = /** @type {HTMLElement} */ (document.getElementById('token-notes'));
const tokensNotes = /** @type {HTMLElement} */ (document.getElementById('pat-notes'));
const backupNotes = /** @type {HTMLElement} */ (document.getElementById('backup-notes'));
/** The rail's Access tokens: on the rail once a token is saved or the page is asked for, not before. */
const tokensRail = /** @type {HTMLElement} */ (document.getElementById('rail-tokens'));

let busy = false;
/** @type {Answer<'gitchop:sync:state'> | null} */
let current = null;
let onTokenChange = () => {};
/**
 * Fills the recipe's owner, from the sign-in block's "add a token for @org". Set as the card draws.
 * @type {(owner: string) => void}
 */
let prefillOwner = () => {};
let resumed = false;

/**
 * Each card has its own status corner, so a saved token and a pushed gist do not fight over one.
 * @param {HTMLElement} node
 */
function flasher(node) {
  /** @type {number | null} */
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
  token: flasher(/** @type {HTMLElement} */ (document.getElementById('sync-status'))),
  backup: flasher(/** @type {HTMLElement} */ (document.getElementById('backup-status'))),
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

/**
 * @template {MessageType} T
 * @param {Message<T>} message
 * @returns {Promise<Answer<T>>}
 */
async function ask(message) {
  const response = await send(message);
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

/** The sign-in card's quieter link, as the sign-in block draws its own. */
function quietLink(text, href) {
  const node = link(text, href);
  node.className = 'quiet';
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

/**
 * One part of the token form: a plain title, the controls, and a line on what to know.
 * @param {string} title
 * @param {Node[]} controls
 * @param {HTMLElement} [note]
 */
function part(title, controls, note) {
  const box = element('div', 'pat-part');
  const head = element('span', 'pat-title', title);
  const row = element('div', 'pat-row');
  row.append(...controls);
  box.append(head, row);
  if (note) box.append(note);
  return box;
}

function hint(text) {
  return element('p', 'pat-hint', text);
}

/**
 * The way to a fine-grained token, in the order it happens: name the owner, open GitHub's form for
 * that owner, paste what comes back. The link follows the owner typed first, and the form it opens
 * arrives with the permissions gitchop needs already ticked for that owner — blank is the account
 * itself, whose token also carries the backup's gist. Saving comes last, so the whole thing reads top
 * to bottom.
 */
function fineForm() {
  const form = element('div', 'pat-form');

  const owner = textInput({ placeholder: 'organisation, exact name', label: 'Owner of the fine-grained token' });
  owner.className = 'owner';
  const one = part(
    'Who it is for',
    [owner],
    hint('The exact name of the organisation, as in github.com/‹name›. Leave it blank for a token on your own account.'),
  );

  const anchor = element('a', 'btn btn-edge');
  anchor.target = '_blank';
  anchor.rel = 'noreferrer';
  const ticked = hint('');
  const two = part('Create it on GitHub', [anchor], ticked);

  const token = textInput({ password: true, placeholder: 'github_pat_…', label: 'GitHub token' });
  const save = button('Save token', { primary: true });
  save.addEventListener('click', () =>
    guard(save, 'token', async (flash) => {
      if (!(await consent(['authenticationInfo']))) {
        flash('not allowed');
        return;
      }
      // The owner named first travels with the token: it is what the row is called until the
      // token lists a private repository that says otherwise.
      const result = await ask({ type: 'gitchop:token:save', token: token.value, owner: ownerName(owner.value) });
      flash('saved');
      current = result;
      render(result);
      onTokenChange();
    }),
  );
  const three = part('Paste it here', [token, save], hint('Add another token for each organisation.'));

  const follow = () => {
    const target = ownerName(owner.value);
    anchor.href = fineTokenUrl(target);
    anchor.textContent = target ? `Open GitHub’s form for @${target}` : 'Open GitHub’s form';
    ticked.textContent = target
      ? `It opens for @${target} with Pull requests, Issues and Contents ticked, read-only. Pick the repositories and an expiry, and leave the owner as it is: changing it there clears the ticks.`
      : 'It opens for your account with Pull requests, Issues and Contents ticked, read-only, and Gists for the backup. Pick the repositories and an expiry, and leave the owner as it is.';
  };
  owner.addEventListener('input', follow);
  follow();

  form.append(hint('A fine-grained, read-only token reaches one owner: your account or one organisation.'), one, two, three);
  /** @param {string} name */
  const prefill = (name) => {
    owner.value = name;
    follow();
    owner.focus();
  };
  return { form, prefill };
}

/**
 * The classic token is kept reachable, because some organisations still allow nothing else, but it is
 * warned against rather than offered: repo is write everywhere the account reaches.
 */
function classicCaution() {
  const box = element('div', 'caution caution-quiet');
  box.append(
    element('b', null, 'Avoid classic tokens'),
    element(
      'p',
      null,
      'A classic token cannot be read-only: its repo scope can write to every repository your account ' +
        'reaches, and gitchop only ever reads. Make one only if your organisation allows neither the ' +
        'app nor fine-grained tokens.',
    ),
    element(
      'p',
      'caution-aside',
      'Signing in and fine-grained tokens count only the private contributions they can see; a classic ' +
        'token with read:user counts them all.',
    ),
    quietLink('Make a classic token anyway', TOKEN_CLASSIC),
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
        'ever sent to api.github.com, and never handed to a web page. They are used for these calls and ' +
        'no others: who the account is, which repositories it can see, searching repositories, which ' +
        'open pull requests are yours or want your review, what happened lately in the repositories you ' +
        'subscribe to, your contributions count, where gitchop’s app is installed, and reading and ' +
        'writing the one gist. Obfuscation is not encryption — anyone with access to this profile can ' +
        'still recover them — but a token no longer sits in the profile as searchable text.',
    ),
    element(
      'p',
      null,
      'Signing in talks to github.com/login/device/code and github.com/login/oauth/access_token, from ' +
        'the background only. A sign-in keeps a renewal token, sealed the same way, which goes only to ' +
        'github.com/login/oauth/access_token, every eight hours or so, for a fresh token. There is no ' +
        'client secret anywhere in gitchop.',
    ),
  );
  return box;
}

/**
 * The same form whether or not a token is saved yet: a second organisation is the same three parts
 * again, and what gets pasted lands in the list above. The owner can be filled from outside, so the
 * sign-in's "use a token instead" for an organisation lands on the right form.
 */
function recipe() {
  const wrap = element('div', 'recipe');
  const { form, prefill } = fineForm();
  wrap.append(form);
  return { node: wrap, prefill };
}

/**
 * Opens Access tokens: puts it on the rail, which it is kept off until a token is saved, and shows
 * it, with the form for an organisation filled in when one is named.
 * @param {string} [owner]
 */
function openTokens(owner) {
  tokensRail.hidden = false;
  show('tokens');
  if (owner) prefillOwner(owner);
}

/** How the sign-in block reaches back into the card. */
const signInHooks = {
  ask,
  guard,
  flash: (text) => flash.token(text),
  rerender: (sync) => {
    current = sync;
    render(sync);
    onTokenChange();
  },
  openAdvanced: (owner) => openTokens(owner),
};

/**
 * What a token has been given, and where: the scopes of a classic token, so an over-broad one cannot
 * hide, and the owner whose private repositories a fine-grained one reaches, so two organisations'
 * tokens can be told apart. One that reaches no private repository says so: every token can list
 * public ones, and a token an organisation has yet to approve can list nothing else.
 */
function tokenDetail(entry) {
  const kind = entry.kind ?? 'token';
  let detail = entry.kind ?? 'saved';
  if (entry.scopes.length > 0) detail = `${kind} — ${entry.scopes.join(', ')}`;
  else if (entry.kind !== 'classic' && Array.isArray(entry.owners) && entry.owners.length === 0) {
    detail = `${kind} — reaches no private repositories yet`;
  }
  const ends = expiry(entry.expiresAt);
  return ends ? `${detail} · ${ends}` : detail;
}

/** Whether a saved token has run out: an expired one can read nothing, and its row should say so first. */
function isExpired(entry) {
  const at = Date.parse(entry?.expiresAt ?? '');
  return !Number.isNaN(at) && at <= Date.now();
}

/**
 * When the token runs out, as GitHub told us: the date, or the days left once it is close enough
 * to act on, or that it already has. Nothing for a token without an expiry, or one saved before
 * the expiry was read — building the index reads it then.
 */
function expiry(iso) {
  const at = Date.parse(iso ?? '');
  if (Number.isNaN(at)) return '';
  const left = at - Date.now();
  if (left <= 0) return 'expired';
  const days = Math.ceil(left / (24 * 60 * 60 * 1000));
  if (days <= 14) return `expires in ${days} day${days === 1 ? '' : 's'}`;
  return `expires ${new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function tokenList(entries) {
  const wrap = element('div', 'tokens');
  for (const entry of entries) {
    const row = element('div', 'token');

    const label = element('div', 'token-name');
    label.append(element('b', null, tokenLabel(entry)), element('span', 'token-detail', tokenDetail(entry)));
    if (entry.broad) label.append(element('span', 'token-warn', 'writes'));
    if (isExpired(entry)) label.append(element('span', 'token-warn', 'expired'));

    const drop = element('button', 'quiet', 'Remove');
    drop.type = 'button';
    drop.setAttribute('aria-label', `Remove the token ${tokenLabel(entry)}`);
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
        'every organisation, and gitchop never uses that. Sign in with GitHub, or replace it with a ' +
        'fine-grained token, and revoke it on GitHub. If it has to stay, keep an expiry on it.',
    ),
  );
  return box;
}

/**
 * Signing in first, then the personal access tokens already saved, then the way to another; the
 * warning about any classic row and the fine print go under the box. The sign-in block draws itself
 * from the same state, plus a flow in progress it keeps across redraws.
 */
function tokenCard(sync, error) {
  const wrap = element('div', 'card-body');
  wrap.append(signInBlock(sync, signInHooks));
  if (error) wrap.append(element('p', 'error', error));
  // Tokens have a page of their own; from here, one quiet line says where, for whoever looks.
  const elsewhere = element('p', 'note');
  const go = element('button', 'quiet', 'Access tokens');
  go.type = 'button';
  go.addEventListener('click', () => openTokens());
  elsewhere.append('An organisation that will not add the app? Personal access tokens are under ', go, '.');
  tokenNotes.append(elsewhere, fineprint());
  return wrap;
}

/**
 * Access tokens: the saved ones, and the form for another, always open here. Tokens are the way
 * for what signing in does not cover, so they sit on a page of their own, off the rail until used.
 * @param {Answer<'gitchop:sync:state'> | null} sync
 * @param {string | null | undefined} error
 */
function tokensCard(sync, error) {
  const wrap = element('div', 'card-body');
  const pats = (sync?.tokens ?? []).filter((entry) => entry.kind !== 'app');
  if (pats.length > 0) {
    const saved = element('div', 'saved');
    saved.append(element('h3', 'saved-title', pats.length === 1 ? 'Saved token' : 'Saved tokens'), tokenList(pats));
    wrap.append(saved);
  }
  const { node, prefill } = recipe();
  prefillOwner = prefill;
  const add = element('div', 'advanced-open');
  add.append(element('h3', 'saved-title', pats.length > 0 ? 'Add another token' : 'Add a token'), node);
  wrap.append(add);
  if (error) wrap.append(element('p', 'error', error));
  const warn = sync ? broadWarning(sync) : null;
  if (warn) tokensNotes.append(warn);
  tokensNotes.append(classicCaution(), fineprint());
  if (pats.length > 0) tokensRail.hidden = false;
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
      'Needs a sign-in or a token under Sign-in. Signing in with GitHub covers the backup, as does a ' +
        'fine-grained token for your own account, made with the owner left blank, or a classic one with ' +
        'gist. gitchop uses whichever can write the gist.',
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
      'Leave the field empty and a new secret gist is made from your links and settings. Paste the id ' +
        'of a gist gitchop made before to adopt it instead; what it holds replaces what is here.',
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
  pull.title = 'Replace the links and settings here with the gist’s';
  pull.addEventListener('click', () =>
    guard(pull, 'backup', async (flash) => {
      if (sync.dirty && !confirm('There are local changes that have not reached the gist yet. Pull anyway and lose them?')) return;
      const result = await ask({ type: 'gitchop:sync:pull', force: true });
      flash(result.changed ? 'pulled' : 'already current');
      await load();
    }),
  );

  const push = button('Push now');
  push.title = 'Write the links and settings here to the gist';
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
  tokenHost.append(tokenCard(sync, tokenError));
  tokensHost.textContent = '';
  tokensNotes.textContent = '';
  tokensHost.append(tokensCard(sync, tokenError));

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
    return;
  }
  if (!resumed) {
    resumed = true;
    resumeSignIn(current, signInHooks);
  }
}

/** Saving a link marks the config dirty in the background; reflect that without a reload. */
export function watch(afterTokenChange) {
  if (afterTokenChange) onTokenChange = afterTokenChange;
  // The background's alarm finishes a sign-in left waiting; this page stops asking as it goes.
  window.addEventListener('pagehide', () => stopSignIn());
  // Back from the back-forward cache, the page is as it was left but no longer asking, so a code
  // still on screen is asked about again.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) resumeAfterCache();
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sync) load();
  });
}
