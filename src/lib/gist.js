const API = 'https://api.github.com';
const FILE = 'gitchop.json';
const DESCRIPTION = 'gitchop — links and settings';
/** 1 was the links alone. 2 carries the settings beside them, under their storage keys. */
const FORMAT = 2;

function fail(status, body) {
  if (status === 401) return 'GitHub rejected the token. It may be expired or mistyped.';
  if (status === 403) return 'GitHub refused the request. The token needs gist read and write access.';
  if (status === 404) return 'Gist not found, or the token cannot see it.';
  if (status === 422) return `GitHub could not accept the data: ${body.slice(0, 120)}`;
  return `GitHub returned ${status}: ${body.slice(0, 120)}`;
}

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

/** Fine-grained tokens start github_pat_; the classic family is ghp_, gho_, ghu_, ghs_, ghr_. */
export function tokenKind(token) {
  if (/^github_pat_/.test(token)) return 'fine-grained';
  if (/^gh[pousr]_/.test(token)) return 'classic';
  return 'unknown';
}

export function scopesGrantWrite(scopes) {
  return (scopes ?? []).some((scope) => WRITE_SCOPES.test(scope));
}

/**
 * What a saved token is called. A classic token is the account's and covers everything it can reach,
 * so the account names it. A fine-grained token speaks for one owner, and every one the same person
 * makes reports the same login, so the owner it reaches is what tells two of them apart — read off
 * the private repositories it lists, or, until it lists any, the owner it was made for as named in
 * the recipe. Two tokens that reach nothing yet would otherwise read as two copies of you.
 */
export function tokenLabel(entry) {
  const owners = entry?.kind === 'classic' ? [] : entry?.owners ?? [];
  if (owners.length > 0) return owners.map((owner) => `@${owner}`).join(', ');
  if (entry?.kind !== 'classic' && entry?.target) return `@${entry.target}`;
  return entry?.login ? `@${entry.login}` : entry?.kind ?? 'token';
}

/**
 * When a token runs out, from the header GitHub sends with every request made with a token that
 * has an expiry — `2026-12-31 12:00:00 UTC` — as an ISO stamp. Null is a header missing or
 * unreadable, which is a token without one.
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
  return {
    login: user.login,
    scopes,
    kind: header === null ? tokenKind(token) : 'classic',
    expiresAt: parseExpiry(response.headers.get('github-authentication-token-expiration')),
  };
}

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

export async function writeStore(token, gistId, backup) {
  const gist = await call(token, `/gists/${encodeURIComponent(gistId)}`, {
    method: 'PATCH',
    body: { description: DESCRIPTION, files: { [FILE]: { content: serialise(backup) } } },
  });
  return { url: gist.html_url };
}
