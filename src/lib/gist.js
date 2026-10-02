const API = 'https://api.github.com';
const FILE = 'gitchop.json';
const DESCRIPTION = 'gitchop — links and settings';
/** 1 was the links alone. 2 carries the settings beside them, under their storage keys. */
const FORMAT = 2;

/**
 * The gist's file as read back. `links` and `settings` are a stranger's until sanitized.
 * @typedef {{ format: number, links: unknown[], settings: Record<string, unknown>, updatedAt: string | null }} Store
 */

/**
 * `app` is a sign-in: a user token of gitchop's GitHub App, which renews itself.
 * @typedef {'fine-grained' | 'classic' | 'app' | 'unknown'} TokenKind
 */

/**
 * Who a token belongs to, as GitHub said.
 * @typedef {{ login: string | null, scopes: string[], kind: TokenKind, expiresAt: string | null }} Identity
 */

/**
 * @param {number} status
 * @param {string} body
 */
function fail(status, body) {
  if (status === 401) return 'GitHub rejected the token. It may be expired or mistyped.';
  if (status === 403) return 'GitHub refused the request. The token needs gist read and write access.';
  if (status === 404) return 'Gist not found, or the token cannot see it.';
  if (status === 422) return `GitHub could not accept the data: ${body.slice(0, 120)}`;
  return `GitHub returned ${status}: ${body.slice(0, 120)}`;
}

/**
 * @param {string} token
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 */
async function call(token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(fail(response.status, await response.text()));
  return response.json();
}

/**
 * The file as it is written. The links stand on their own, where a reader of the first format
 * looks for them; everything else in the backup goes under `settings`, each under the storage key
 * it lives at, so the file reads like the storage it mirrors.
 * @param {Record<string, unknown> | null | undefined} backup
 * @param {Date} [at]
 * @returns {string}
 */
export function serialise(backup, at = new Date()) {
  const { links = [], ...settings } = backup ?? {};
  return `${JSON.stringify({ app: 'gitchop', format: FORMAT, updatedAt: at.toISOString(), links, settings }, null, 2)}\n`;
}

/**
 * The file read back, whichever format wrote it. Links are required, as they always were; the
 * settings are whatever the file carries, which for a file of the first format is nothing — and
 * nothing means what is local is left alone, not reset. Every value is still a stranger's until
 * the caller has run it through the feature that owns it.
 * @param {string} text
 * @returns {Store}
 */
export function parseStore(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${FILE} is not valid JSON.`);
  }
  if (!Array.isArray(payload?.links)) throw new Error(`${FILE} has no links array.`);
  const settings = payload.settings;
  return {
    format: Number.isInteger(payload.format) ? payload.format : 1,
    links: payload.links,
    settings: settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {},
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
  };
}

const WRITE_SCOPES = /^(repo|workflow|delete_repo|admin:|write:)/;

/**
 * Fine-grained tokens start github_pat_. A GitHub App's user token starts ghu_, and is told apart
 * from the classic family — ghp_, gho_, ghs_, ghr_ — because it reaches only where the app is
 * installed and has no scopes to speak of.
 * @param {string} token
 * @returns {TokenKind}
 */
export function tokenKind(token) {
  if (/^ghu_/.test(token)) return 'app';
  if (/^github_pat_/.test(token)) return 'fine-grained';
  if (/^gh[posr]_/.test(token)) return 'classic';
  return 'unknown';
}

/**
 * @param {string[] | null | undefined} scopes
 * @returns {boolean}
 */
export function scopesGrantWrite(scopes) {
  return (scopes ?? []).some((scope) => WRITE_SCOPES.test(scope));
}

/**
 * What a saved token is called. A classic token is the account's and covers everything it can reach,
 * so the account names it. A fine-grained token speaks for one owner, and every one the same person
 * makes reports the same login, so the owner it reaches is what tells two of them apart — read off
 * the private repositories it lists, or, until it lists any, the owner it was made for as named in
 * the recipe. Two tokens that reach nothing yet would otherwise read as two copies of you.
 * @param {{ kind?: string | null, owners?: string[] | null, target?: string | null, login?: string | null } | null | undefined} entry
 * @returns {string}
 */
export function tokenLabel(entry) {
  // A sign-in is the account's too; where the app is installed is the detail beneath, not the name.
  const account = entry?.kind === 'classic' || entry?.kind === 'app';
  const owners = account ? [] : entry?.owners ?? [];
  if (owners.length > 0) return owners.map((owner) => `@${owner}`).join(', ');
  if (!account && entry?.target) return `@${entry.target}`;
  return entry?.login ? `@${entry.login}` : entry?.kind ?? 'token';
}

/**
 * When a token runs out, from the header GitHub sends with every request made with a token that
 * has an expiry — `2026-12-31 12:00:00 UTC` — as an ISO stamp. Null is a header missing or
 * unreadable, which is a token without one.
 * @param {string | null | undefined} header
 * @returns {string | null}
 */
export function parseExpiry(header) {
  const text = String(header ?? '').trim();
  if (!text) return null;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/.exec(text);
  const at = Date.parse(match ? `${match[1]}T${match[2]}Z` : text);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/**
 * Confirms the token works and says who it belongs to. Classic tokens also report their scopes in
 * a response header, which is the only way to tell the holder what they actually handed over —
 * fine-grained tokens send no such header, and their absence is itself the signal.
 * @param {string} token
 * @returns {Promise<Identity>}
 */
export async function identify(token) {
  const response = await fetch(`${API}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(fail(response.status, await response.text()));

  const user = await response.json();
  const header = response.headers.get('x-oauth-scopes');
  const scopes = header ? header.split(',').map((scope) => scope.trim()).filter(Boolean) : [];
  // The prefix decides first: whether GitHub sends the scopes header, empty, for an app's user
  // token is not documented, and its presence alone would class a sign-in as classic.
  const prefixed = tokenKind(token);
  return {
    login: user.login,
    scopes,
    kind: prefixed === 'app' ? 'app' : header === null ? prefixed : 'classic',
    expiresAt: parseExpiry(response.headers.get('github-authentication-token-expiration')),
  };
}

/**
 * @param {string} token
 * @param {Record<string, unknown>} backup
 * @returns {Promise<{ id: string, url: string }>}
 */
export async function createStore(token, backup) {
  const gist = await call(token, '/gists', {
    method: 'POST',
    body: {
      description: DESCRIPTION,
      public: false,
      files: { [FILE]: { content: serialise(backup) } },
    },
  });
  return { id: gist.id, url: gist.html_url };
}

/**
 * @param {string} token
 * @param {string} gistId
 * @returns {Promise<Store & { url: string }>}
 */
export async function readStore(token, gistId) {
  const gist = await call(token, `/gists/${encodeURIComponent(gistId)}`);
  const file = gist.files?.[FILE];
  if (!file) {
    const names = Object.keys(gist.files ?? {}).join(', ') || 'nothing';
    throw new Error(`That gist has no ${FILE} (it holds ${names}).`);
  }
  if (file.truncated) throw new Error(`${FILE} is too large to read back.`);
  return { ...parseStore(file.content), url: gist.html_url };
}

/**
 * @param {string} token
 * @param {string} gistId
 * @param {Record<string, unknown>} backup
 * @returns {Promise<{ url: string }>}
 */
export async function writeStore(token, gistId, backup) {
  const gist = await call(token, `/gists/${encodeURIComponent(gistId)}`, {
    method: 'PATCH',
    body: { description: DESCRIPTION, files: { [FILE]: { content: serialise(backup) } } },
  });
  return { url: gist.html_url };
}
