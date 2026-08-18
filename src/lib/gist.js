const API = 'https://api.github.com';
const FILE = 'gitchop.json';
const DESCRIPTION = 'gitchop — saved links';
const FORMAT = 1;

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

function serialise(links) {
  return `${JSON.stringify({ app: 'gitchop', format: FORMAT, updatedAt: new Date().toISOString(), links }, null, 2)}\n`;
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
  return { login: user.login, scopes, kind: header === null ? tokenKind(token) : 'classic' };
}

export async function createStore(token, links) {
  const gist = await call(token, '/gists', {
    method: 'POST',
    body: {
      description: DESCRIPTION,
      public: false,
      files: { [FILE]: { content: serialise(links) } },
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

  let payload;
  try {
    payload = JSON.parse(file.content);
  } catch {
    throw new Error(`${FILE} is not valid JSON.`);
  }
  if (!Array.isArray(payload?.links)) throw new Error(`${FILE} has no links array.`);

  return { links: payload.links, updatedAt: payload.updatedAt ?? null, url: gist.html_url };
}

export async function writeStore(token, gistId, links) {
  const gist = await call(token, `/gists/${encodeURIComponent(gistId)}`, {
    method: 'PATCH',
    body: { description: DESCRIPTION, files: { [FILE]: { content: serialise(links) } } },
  });
  return { url: gist.html_url };
}
