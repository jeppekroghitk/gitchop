/**
 * Signing in with GitHub, by the device flow: gitchop asks GitHub for a short code, the user types
 * it on github.com and approves gitchop's app, and gitchop asks GitHub, once per interval, whether
 * that has happened yet. The app is a public GitHub App, so what it is given is the read-only
 * repository permissions the fine-grained recipe asks for, plus Gists for the backup, and only in
 * the accounts where it is installed.
 *
 * The client id is public by nature: it is in every sign-in URL GitHub shows. The device flow is
 * the one flow that needs nothing else, both to sign in and to renew, so there is no client secret
 * anywhere in gitchop, and there must never be one — a secret shipped in an extension is a secret
 * handed to everyone who installs it.
 *
 * Nothing here touches the extension API, so it runs under plain node. Every call to
 * github.com/login is made from the background, which the host permission exempts from CORS; the
 * token endpoint sends no CORS headers, so a page could not make it.
 */

export const CLIENT_ID = 'Iv23liugfptFPUviGlR1';
export const APP_SLUG = 'gitchop-for-github';
export const DEVICE_URL = 'https://github.com/login/device';
export const INSTALL_URL = `https://github.com/apps/${APP_SLUG}/installations/new`;

/**
 * GitHub's install page for one account, by its numeric id, skipping the list of accounts to pick
 * from: adding the app to your own account is then one confirmation.
 * @param {number} accountId
 */
export function installUrlFor(accountId) {
  return `https://github.com/apps/${APP_SLUG}/installations/new/permissions?target_id=${accountId}`;
}
export const REVOKE_URL = 'https://github.com/settings/applications';
/** How close to its end an access token is renewed at the point a request is about to use it. */
export const REFRESH_MARGIN = 5 * 60 * 1000;

const CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** What GitHub documents for an access token and its renewal, used when an answer leaves one out. */
const ACCESS_SECONDS = 28800;
const REFRESH_SECONDS = 15897600;

/**
 * A code as GitHub handed it out. `expiresAt` is epoch milliseconds; `interval` is seconds.
 * @typedef {{ deviceCode: string, userCode: string, verificationUri: string, expiresAt: number, interval: number }} DeviceCode
 */

/**
 * An access token and the single-use token that renews it, each with when it runs out, as ISO stamps.
 * `expiresAt` is null for a token that does not run out, which is what GitHub hands out when the
 * app has expiring tokens switched off; `refresh` is then empty.
 * @typedef {{ access: string, refresh: string, expiresAt: string | null, refreshExpiresAt: string }} TokenPair
 */

/** @typedef {'pending' | 'slow_down' | 'done' | 'expired' | 'denied' | 'disabled' | 'error'} PollStatus */

/** @typedef {{ status: PollStatus, interval?: number, pair?: TokenPair, error?: string }} PollOutcome */

/**
 * One account the app is installed on, and whether on all its repositories or a chosen few.
 * @typedef {{ owner: string, type: 'User' | 'Organization', selection: 'all' | 'selected' }} Installation
 */

/**
 * One POST to github.com/login. The body is a form, and the answer is asked for as JSON; without
 * the Accept header GitHub answers in a query string.
 * @param {string} url
 * @param {Record<string, string>} fields
 * @returns {Promise<Response>}
 */
function post(url, fields) {
  return fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }).toString(),
  });
}

/**
 * The answer's JSON, or a throw. A 5xx, or an answer that is not JSON, is GitHub having a bad
 * moment, not a verdict on the code or the token, so the caller treats it as worth trying again.
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function readJson(response) {
  if (response.status >= 500) throw new Error(`GitHub returned ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error(`GitHub sent something other than JSON (${response.status}).`);
  }
}

/**
 * Asks GitHub for a code to show. Only ever on a click: the app may hand out 50 codes an hour, and
 * that allowance is shared by everyone who uses gitchop.
 * @param {number} [at]
 * @returns {Promise<DeviceCode>}
 */
export async function requestCode(at = Date.now()) {
  const response = await post(CODE_URL, {});
  /** @type {any} */
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  // An unknown client id was seen to come back as a 404 with {"error":"Not Found"}; GitHub does
  // not document it, so it is read as broadly as that.
  if (response.status === 404) throw new Error('GitHub does not know gitchop’s app.');
  if (body?.error === 'device_flow_disabled') throw new Error('GitHub has sign-in by code switched off for gitchop.');
  if (body?.error) throw new Error(`GitHub would not give a code: ${String(body.error_description ?? body.error).slice(0, 160)}`);
  if (!response.ok) throw new Error(`GitHub returned ${response.status} asking for a code.`);
  if (typeof body?.device_code !== 'string' || typeof body?.user_code !== 'string') throw new Error('GitHub sent no code.');
  const seconds = Number(body.expires_in);
  const interval = Number(body.interval);
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: typeof body.verification_uri === 'string' ? body.verification_uri : DEVICE_URL,
    expiresAt: at + (Number.isFinite(seconds) && seconds > 0 ? seconds : 900) * 1000,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
  };
}

/**
 * The pair in a token answer. GitHub states lifetimes in seconds from now; they are kept as stamps,
 * so a stored entry says when it runs out whenever it is read.
 * @param {any} body
 * @param {number} at
 * @returns {TokenPair}
 */
export function pairFrom(body, at) {
  const access = Number(body?.expires_in);
  const refresh = Number(body?.refresh_token_expires_in);
  const renewal = String(body?.refresh_token ?? '');
  // Eight hours is the documented lifetime of a token that comes with a renewal token. One that
  // comes alone and says nothing of a lifetime is from an app with expiring tokens switched off,
  // and does not run out; stamping eight hours on it would drop it then, with nothing to renew it.
  const seconds = Number.isFinite(access) && access > 0 ? access : renewal ? ACCESS_SECONDS : null;
  return {
    access: String(body?.access_token ?? ''),
    refresh: renewal,
    expiresAt: seconds === null ? null : new Date(at + seconds * 1000).toISOString(),
    refreshExpiresAt: new Date(at + (Number.isFinite(refresh) && refresh > 0 ? refresh : REFRESH_SECONDS) * 1000).toISOString(),
  };
}

/**
 * What one poll's answer means. GitHub answers a poll with HTTP 200 whether or not the code was
 * approved — the verdict is in the body — so the body is read, not the status.
 * @param {any} body
 * @param {number} interval
 * @param {number} at
 * @returns {PollOutcome}
 */
export function readOutcome(body, interval, at) {
  if (typeof body?.access_token === 'string' && body.access_token) return { status: 'done', pair: pairFrom(body, at) };
  switch (body?.error) {
    case 'authorization_pending':
      return { status: 'pending', interval };
    case 'slow_down':
      // GitHub was seen to say the new interval; the documented rule is five seconds more.
      return { status: 'slow_down', interval: Number(body.interval) || interval + 5 };
    case 'expired_token':
    case 'token_expired':
      return { status: 'expired' };
    case 'access_denied':
      return { status: 'denied' };
    case 'device_flow_disabled':
      return { status: 'disabled' };
    default:
      return { status: 'error', error: String(body?.error_description ?? body?.error ?? 'GitHub sent an answer gitchop does not understand.') };
  }
}

/**
 * Asks once whether the code has been approved. Throws only when GitHub could not be asked, which
 * is not the end of the code; every answer GitHub gives is an outcome.
 * @param {string} deviceCode
 * @param {number} interval
 * @param {number} [at]
 * @returns {Promise<PollOutcome>}
 */
export async function pollToken(deviceCode, interval, at = Date.now()) {
  const response = await post(TOKEN_URL, { device_code: deviceCode, grant_type: DEVICE_GRANT });
  const body = await readJson(response);
  // Every verdict on a code names itself in `error`. An answer with neither a token nor that —
  // a rate limit's message, say — is no verdict, and ending the flow on it would throw away a code
  // that still works and cost the user one of the app's 50 codes an hour for the next.
  const verdict = typeof body?.error === 'string' || (typeof body?.access_token === 'string' && body.access_token);
  if (!verdict || response.status === 429) throw new Error(`GitHub did not answer the poll (${response.status}).`);
  return readOutcome(body, interval, at);
}

/**
 * The answers to a renewal that mean GitHub will not renew this sign-in, whatever is tried again:
 * the renewal token is spent, revoked or unknown, or the app does not accept it. Anything else is
 * not a verdict on the renewal token, and GitHub has not spent it.
 */
const REFUSALS = new Set([
  'bad_refresh_token',
  'invalid_grant',
  'unauthorized_client',
  'invalid_client',
  'incorrect_client_credentials',
  'unsupported_grant_type',
  'access_denied',
]);

/**
 * Spends a renewal token on a new pair. A renewal token works once: after this call, the old pair is
 * gone on GitHub whatever happens here, so the caller must keep what comes back before anything
 * uses it. A refusal GitHub names is `{ error }` — the renewal is refused for good. Anything else
 * that is not a pair is a throw: GitHub not reached, rate-limited, or answering in a way that is no
 * verdict, and the old pair may still be good.
 * @param {string} refreshToken
 * @param {number} [at]
 * @returns {Promise<{ pair: TokenPair } | { error: string }>}
 */
export async function refreshPair(refreshToken, at = Date.now()) {
  const response = await post(TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refreshToken });
  const body = await readJson(response);
  if (typeof body?.access_token === 'string' && body.access_token) return { pair: pairFrom(body, at) };
  if (typeof body?.error === 'string' && REFUSALS.has(body.error)) return { error: body.error };
  throw new Error(`GitHub did not renew the sign-in (${response.status}${typeof body?.error === 'string' ? `, ${body.error.slice(0, 60)}` : ''}).`);
}

/**
 * Where the app is installed, as the signed-in user may see: every account they can see an install
 * on, their own included. A user token may call this; it lists nothing the user cannot see anyway.
 * @param {string} token
 * @returns {Promise<Installation[]>}
 */
export async function listInstallations(token) {
  const response = await fetch(`${API}/user/installations?per_page=100`, {
    // GitHub lets this be cached for a minute, and it is asked right after the user installs the
    // app: a cached answer would say the install never happened. Revalidated instead, which an
    // unchanged list answers with a 304 that costs no rate limit.
    cache: 'no-cache',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (response.status === 401) throw new Error('GitHub no longer accepts this sign-in.');
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  const body = await response.json();
  /** @type {Installation[]} */
  const found = [];
  for (const install of Array.isArray(body?.installations) ? body.installations : []) {
    const owner = install?.account?.login;
    if (typeof owner !== 'string' || !owner) continue;
    found.push({
      owner,
      type: install.account.type === 'Organization' ? 'Organization' : 'User',
      selection: install.repository_selection === 'selected' ? 'selected' : 'all',
    });
  }
  return found;
}

/**
 * The owners that matter to this user but have not installed the app, each once, in the order given.
 * Casing is GitHub's own and does not decide anything.
 * @param {Installation[] | null | undefined} installations
 * @param {(string | null | undefined)[]} candidates
 * @returns {string[]}
 */
export function missingInstalls(installations, candidates) {
  const installed = new Set((installations ?? []).map((install) => install.owner.toLowerCase()));
  /** @type {string[]} */
  const missing = [];
  for (const candidate of candidates ?? []) {
    const owner = String(candidate ?? '').trim().replace(/^@/, '');
    if (!owner) continue;
    const key = owner.toLowerCase();
    if (installed.has(key) || missing.some((seen) => seen.toLowerCase() === key)) continue;
    missing.push(owner);
  }
  return missing;
}
