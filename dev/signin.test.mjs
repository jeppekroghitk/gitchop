import assert from 'node:assert';
import { test } from 'node:test';
import { newVaultKey, seal, unseal } from '../src/lib/vault.js';

// The whole background, as background.test.mjs drives it, with a GitHub that knows the device
// flow. Its own process, so its own stubs: storage kept in memory (session storage too), every
// event a list of listeners, alarms recorded, and a fetch that routes by method and URL, keeps
// every call it saw, and logs each write to storage.local beside them, so the order of the two
// can be asserted.
const listeners = {};
const on = (name) => ({ addListener: (fn) => (listeners[name] ??= []).push(fn) });
/** Every fetch and every storage.local write, in the order they happened. */
const events = [];
/** How long a write to storage.local takes, so a write not waited for shows up as one. */
let writeDelay = 0;
const area = (name) => {
  const data = {};
  return {
    data,
    async get(keys) {
      const out = {};
      for (const key of keys == null ? Object.keys(data) : [keys].flat()) if (key in data) out[key] = structuredClone(data[key]);
      return out;
    },
    async set(values) {
      if (name === 'local' && writeDelay) await new Promise((resolve) => setTimeout(resolve, writeDelay));
      if (name === 'local') events.push({ type: 'set', values: structuredClone(values) });
      for (const [key, value] of Object.entries(values)) data[key] = structuredClone(value);
    },
    async remove(keys) {
      for (const key of [keys].flat()) delete data[key];
    },
  };
};
const alarms = { created: [], cleared: [] };
let hostAccess = true;
globalThis.chrome = {
  storage: { local: area('local'), sync: area('sync'), session: area('session'), onChanged: on('storage.onChanged') },
  alarms: {
    get: async () => undefined,
    create: async (name, info) => {
      alarms.created.push({ name, info });
    },
    clear: async (name) => {
      alarms.cleared.push(name);
      return true;
    },
    onAlarm: on('alarms.onAlarm'),
  },
  runtime: {
    onMessage: on('runtime.onMessage'),
    onInstalled: on('runtime.onInstalled'),
    onStartup: on('runtime.onStartup'),
    openOptionsPage: async () => {},
    getManifest: () => ({ name: 'gitchop', version: '0.0.0' }),
  },
  action: { onClicked: on('action.onClicked'), setBadgeText: async () => {}, setTitle: async () => {} },
  permissions: { contains: async () => hostAccess, onAdded: on('permissions.onAdded'), onRemoved: on('permissions.onRemoved') },
};
const { local, session, sync } = globalThis.chrome.storage;

/** @type {(status: number, body: unknown) => Response} */
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** One test's GitHub: a function of the request that answers, or returns nothing for the default. */
let route = null;
/** What the token endpoint says, in turn; the last one repeats. */
let tokenAnswers = [];
let codes = 0;
const installs = [
  { account: { login: 'me', type: 'User' }, repository_selection: 'all' },
  { account: { login: 'itk-dev', type: 'Organization' }, repository_selection: 'selected' },
];

function defaults(request) {
  const { method, host, path } = request;
  if (host === 'github.com' && path === '/login/device/code') {
    codes += 1;
    return json(200, { device_code: `DEV${codes}`, user_code: `CODE-000${codes}`, verification_uri: 'https://github.com/login/device', expires_in: 899, interval: 5 });
  }
  if (host === 'github.com' && path === '/login/oauth/access_token') {
    const next = tokenAnswers.length > 1 ? tokenAnswers.shift() : tokenAnswers[0];
    if (typeof next === 'function') return next(request);
    return json(200, next ?? { error: 'authorization_pending' });
  }
  if (host !== 'api.github.com') return json(404, { message: 'Not Found' });
  if (path === '/user') return json(200, { login: 'me' });
  if (path === '/user/installations') return json(200, { total_count: installs.length, installations: installs });
  if (path === '/user/repos') return json(200, []);
  if (path === '/graphql') return json(200, { data: {} });
  if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return json(200, { full_name: path.slice(7), html_url: `https://github.com${path.slice(6)}`, default_branch: 'main', private: false });
  if (/^\/repos\/[^/]+\/[^/]+\/(commits|pulls|issues|releases)$/.test(path)) return json(200, []);
  if (path.startsWith('/gists/') && method === 'PATCH') return json(200, { html_url: 'https://gist.github.com/g1' });
  if (path.startsWith('/gists/')) return json(200, { html_url: 'https://gist.github.com/g1', files: { 'gitchop.json': { content: '{"links":[]}' } } });
  return json(404, { message: 'Not Found' });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const request = {
    url: url.href,
    method: init.method ?? 'GET',
    host: url.host,
    path: url.pathname,
    auth: new Headers(init.headers ?? {}).get('authorization'),
    body: typeof init.body === 'string' ? init.body : null,
  };
  events.push({ type: 'fetch', ...request });
  const custom = route ? await route(request) : undefined;
  return custom ?? defaults(request);
};

await import('../src/background/index.js');

function send(message) {
  return new Promise((resolve) => {
    const answered = listeners['runtime.onMessage'][0](message, {}, resolve);
    if (!answered) resolve(undefined);
  });
}

const fetches = () => events.filter((event) => event.type === 'fetch');
const codePosts = () => fetches().filter((call) => call.path === '/login/device/code');
const tokenPosts = () => fetches().filter((call) => call.path === '/login/oauth/access_token');
const refreshPosts = () => tokenPosts().filter((call) => new URLSearchParams(call.body).get('grant_type') === 'refresh_token');
const apiCalls = () => fetches().filter((call) => call.host === 'api.github.com');
const stored = () => local.data.sync;
const appEntry = () => stored()?.tokens?.find((entry) => entry.kind === 'app');

/** Everything back to a fresh profile, between tests. */
function reset() {
  for (const store of [local, session, sync]) for (const key of Object.keys(store.data)) delete store.data[key];
  events.length = 0;
  alarms.created.length = 0;
  alarms.cleared.length = 0;
  route = null;
  tokenAnswers = [];
  hostAccess = true;
  writeDelay = 0;
}

/** The sign-in GitHub would answer the token endpoint with. */
const pair = (n) => ({ access_token: `ghu_${n}`, refresh_token: `ghr_${n}`, expires_in: 28800, refresh_token_expires_in: 15897600, token_type: 'bearer' });

/** Lets the code be asked about now, as if its interval had passed. */
function intervalPassed() {
  session.data.signin.nextPollAt = 0;
}

/**
 * A profile with a sign-in saved as a renewal would have left it, and any tokens beside it.
 * @param {{ access?: string, refresh?: string, expiresIn?: number, refreshIn?: number, pats?: string[], gistId?: string, needsSignIn?: boolean, installations?: { owner: string, type: string, selection: string }[] }} options
 */
async function seedApp({ access = 'ghu_old', refresh = 'ghr_old', expiresIn = 8 * 3600 * 1000, refreshIn = 180 * 86400 * 1000, pats = [], gistId, needsSignIn = false, installations = [{ owner: 'me', type: 'User', selection: 'all' }] } = {}) {
  const vaultKey = newVaultKey();
  const tokens = [
    {
      id: 'app-id',
      kind: 'app',
      login: 'me',
      scopes: [],
      owners: installations.map((install) => install.owner),
      target: null,
      expiresAt: new Date(Date.now() + expiresIn).toISOString(),
      sealed: await seal(access, vaultKey),
      sealedRefresh: await seal(refresh, vaultKey),
      refreshExpiresAt: new Date(Date.now() + refreshIn).toISOString(),
      installations,
      needsSignIn,
      signInError: needsSignIn ? 'bad_refresh_token' : null,
    },
  ];
  for (const [index, secret] of pats.entries()) {
    tokens.push({ id: `pat-${index}`, kind: secret.startsWith('ghp_') ? 'classic' : 'fine-grained', login: 'me', scopes: [], owners: null, target: null, expiresAt: null, sealed: await seal(secret, vaultKey) });
  }
  local.data.sync = { tokens, vaultKey, gistId: gistId ?? null };
}

async function openPair() {
  const { vaultKey } = stored();
  const entry = appEntry();
  return { access: await unseal(entry.sealed, vaultKey), refresh: await unseal(entry.sealedRefresh, vaultKey) };
}

async function until(check, what) {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('a code is handed out without its device code, and a live one is handed out again', async () => {
  reset();
  const code = await send({ type: 'gitchop:signin:start' });
  assert.deepEqual(Object.keys(code).sort(), ['expiresAt', 'interval', 'ok', 'userCode', 'verificationUri'], 'the page never sees the device code');
  assert.equal(code.interval, 5);
  assert.equal(session.data.signin.deviceCode, `DEV${codes}`, 'the device code is kept in session storage');
  assert.ok(!JSON.stringify(local.data).includes('DEV'), 'and nowhere in storage.local');
  assert.equal(alarms.created.at(-1).name, 'gitchop-signin', 'the alarm that finishes a flow with the tab closed is set');

  const again = await send({ type: 'gitchop:signin:start' });
  assert.equal(again.userCode, code.userCode, 'a reload or a second tab gets the same code');
  assert.equal(codePosts().length, 1, 'and GitHub is not asked for another');
  assert.deepEqual(await send({ type: 'gitchop:signin:pending' }), { ok: true, code: { userCode: code.userCode, verificationUri: code.verificationUri, expiresAt: code.expiresAt, interval: 5 } });
});

test('without access to github.com there is no code, and GitHub is not asked', async () => {
  reset();
  hostAccess = false;
  assert.deepEqual(await send({ type: 'gitchop:signin:start' }), { ok: false, error: 'gitchop needs access to github.com to sign in. Grant it above.' });
  assert.equal(codePosts().length, 0);
});

test('waiting for approval, and asked again too soon, GitHub is not bothered', async () => {
  reset();
  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  tokenAnswers = [{ error: 'authorization_pending' }];
  const first = await send({ type: 'gitchop:signin:poll' });
  assert.equal(first.status, 'pending');
  assert.equal(first.interval, 5);
  assert.equal(tokenPosts().length, 1);
  const second = await send({ type: 'gitchop:signin:poll' });
  assert.equal(second.status, 'pending', 'asked again before the interval, the answer is still pending');
  assert.equal(tokenPosts().length, 1, 'without a fetch');
  const body = new URLSearchParams(tokenPosts()[0].body);
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(body.get('device_code'), session.data.signin.deviceCode);
});

test('slow_down stretches the interval as GitHub says, or by five seconds', async () => {
  reset();
  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  tokenAnswers = [{ error: 'slow_down', interval: 10 }];
  assert.equal((await send({ type: 'gitchop:signin:poll' })).interval, 10);
  assert.equal(session.data.signin.interval, 10, 'and it is kept for the next ask');
  intervalPassed();
  tokenAnswers = [{ error: 'slow_down' }];
  const slower = await send({ type: 'gitchop:signin:poll' });
  assert.equal(slower.status, 'slow_down');
  assert.equal(slower.interval, 15);
});

for (const [error, status] of [
  ['expired_token', 'expired'],
  ['access_denied', 'denied'],
  ['device_flow_disabled', 'disabled'],
  ['incorrect_device_code', 'error'],
]) {
  test(`${error} ends the flow as ${status}`, async () => {
    reset();
    await send({ type: 'gitchop:signin:start' });
    intervalPassed();
    tokenAnswers = [{ error }];
    const reply = await send({ type: 'gitchop:signin:poll' });
    assert.equal(reply.status, status);
    if (status === 'error') assert.equal(reply.error, 'incorrect_device_code');
    assert.equal(session.data.signin, undefined, 'the code is forgotten');
    assert.ok(alarms.cleared.includes('gitchop-signin'), 'and the alarm with it');
  });
}

test('GitHub out of reach is not the end of the code', async () => {
  reset();
  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  tokenAnswers = [() => Promise.reject(new TypeError('NetworkError when attempting to fetch resource.'))];
  const reply = await send({ type: 'gitchop:signin:poll' });
  assert.equal(reply.status, 'network');
  assert.ok(session.data.signin, 'the code is kept');
  assert.ok(session.data.signin.nextPollAt > Date.now(), 'and asked about again after the interval');
});

test('an approved code is a sign-in, stored first, sealed, and replaced in place the next time', async () => {
  reset();
  const vaultKey = newVaultKey();
  local.data.sync = { vaultKey, tokens: [{ id: 'pat', kind: 'fine-grained', login: 'me', scopes: [], owners: ['os2display'], target: null, expiresAt: null, sealed: await seal('github_pat_x', vaultKey) }] };
  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  tokenAnswers = [pair('one')];
  const reply = await send({ type: 'gitchop:signin:poll' });
  assert.equal(reply.status, 'done');
  const [first] = reply.state.tokens;
  assert.equal(first.kind, 'app', 'the sign-in goes first');
  assert.equal(first.login, 'me', 'named from /user');
  assert.deepEqual(first.owners, ['me', 'itk-dev'], 'reaching where it is installed');
  assert.deepEqual(first.installations, [
    { owner: 'me', type: 'User', selection: 'all' },
    { owner: 'itk-dev', type: 'Organization', selection: 'selected' },
  ]);
  assert.ok(!('sealed' in first) && !('sealedRefresh' in first), 'the page is told nothing secret');
  const text = JSON.stringify(local.data);
  assert.ok(!text.includes('ghu_') && !text.includes('ghr_'), 'neither token is stored as readable text');
  assert.deepEqual(await openPair(), { access: 'ghu_one', refresh: 'ghr_one' });
  assert.equal(session.data.signin, undefined, 'the code is forgotten');
  assert.equal(apiCalls().find((call) => call.path === '/user').auth, 'Bearer ghu_one');
  assert.ok(!tokenPosts().some((call) => /secret/.test(call.body)), 'no client secret, ever');

  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  tokenAnswers = [pair('two')];
  const again = await send({ type: 'gitchop:signin:poll' });
  assert.equal(again.state.tokens.filter((entry) => entry.kind === 'app').length, 1, 'one sign-in, not two');
  assert.equal(again.state.tokens[0].id, first.id, 'signing in again keeps the id');
  assert.deepEqual(await openPair(), { access: 'ghu_two', refresh: 'ghr_two' });
});

test('a whole sign-in, start to renewal', async () => {
  reset();
  const code = await send({ type: 'gitchop:signin:start' });
  assert.match(code.userCode, /^CODE-/);
  intervalPassed();
  tokenAnswers = [{ error: 'authorization_pending' }];
  assert.equal((await send({ type: 'gitchop:signin:poll' })).status, 'pending');
  intervalPassed();
  tokenAnswers = [{ error: 'slow_down', interval: 10 }];
  assert.equal((await send({ type: 'gitchop:signin:poll' })).interval, 10);
  intervalPassed();
  tokenAnswers = [pair('whole')];
  const done = await send({ type: 'gitchop:signin:poll' });
  assert.equal(done.status, 'done');
  assert.equal(done.state.tokens[0].login, 'me');
  assert.equal(done.state.hasToken, true);

  const checked = await send({ type: 'gitchop:signin:installations' });
  assert.deepEqual(checked.tokens[0].owners, ['me', 'itk-dev']);

  // Eight hours on, the next request renews it first.
  local.data.sync.tokens[0].expiresAt = new Date(Date.now() - 1000).toISOString();
  tokenAnswers = [pair('renewed8h')];
  events.length = 0;
  await send({ type: 'gitchop:pulls:refresh' });
  assert.equal(refreshPosts().length, 1);
  assert.equal(new URLSearchParams(refreshPosts()[0].body).get('refresh_token'), 'ghr_whole');
  assert.equal(apiCalls().find((call) => call.path === '/graphql').auth, 'Bearer ghu_renewed8h');
  assert.deepEqual(await openPair(), { access: 'ghu_renewed8h', refresh: 'ghr_renewed8h' });
  assert.ok(Date.parse(appEntry().expiresAt) > Date.now() + 7 * 3600 * 1000, 'good for another eight hours');
});

test('with the tab closed, the alarm finishes the flow', async () => {
  reset();
  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  tokenAnswers = [pair('alarm')];
  listeners['alarms.onAlarm'][0]({ name: 'gitchop-signin' });
  await until(() => appEntry() && session.data.signin === undefined && appEntry().login === 'me', 'the alarm to finish the flow');
  assert.deepEqual(await openPair(), { access: 'ghu_alarm', refresh: 'ghr_alarm' });
});

let race = null;
test('a sign-in run out is renewed once, however many ask at once', async () => {
  reset();
  await seedApp({ expiresIn: -60 * 1000, gistId: 'g1' });
  sync.data.news = { enabled: 1, hour: 8, days: 1, repos: ['me/repo'] };
  const before = appEntry().sealedRefresh;
  tokenAnswers = [pair('fresh')];
  writeDelay = 15;
  await Promise.all([
    send({ type: 'gitchop:pulls:refresh' }),
    send({ type: 'gitchop:contributions:refresh' }),
    send({ type: 'gitchop:news:refresh', force: true }),
    send({ type: 'gitchop:sync:push', force: true }),
  ]);
  assert.equal(refreshPosts().length, 1, 'exactly one renewal');
  const body = new URLSearchParams(refreshPosts()[0].body);
  assert.equal(body.get('refresh_token'), 'ghr_old');
  assert.ok(!body.has('client_secret'), 'and no client secret');
  assert.deepEqual(await openPair(), { access: 'ghu_fresh', refresh: 'ghr_fresh' }, 'the new pair is what is stored');
  const authed = apiCalls().filter((call) => call.auth);
  assert.ok(authed.length >= 4, 'each feature asked GitHub');
  assert.deepEqual([...new Set(authed.map((call) => call.auth))], ['Bearer ghu_fresh'], 'every call went with the new token, none with the old');
  assert.ok(apiCalls().some((call) => call.path === '/gists/g1' && call.method === 'PATCH'), 'the gist was written with it');
  race = { before };
  writeDelay = 0;
});

test('the new pair is stored before any request is handed the new token', () => {
  assert.ok(race, 'runs on the previous test’s events');
  const written = events.findIndex((event) => event.type === 'set' && event.values.sync?.tokens?.find((entry) => entry.kind === 'app')?.sealedRefresh !== race.before && event.values.sync);
  const used = events.findIndex((event) => event.type === 'fetch' && event.auth === 'Bearer ghu_fresh');
  assert.ok(written >= 0 && used >= 0);
  assert.ok(written < used, `stored at event ${written}, first used at event ${used}`);
  assert.ok(events.findIndex((event) => event.type === 'fetch' && event.path === '/login/oauth/access_token') < written, 'and only after GitHub answered');
});

test('a 401 renews the sign-in and asks again, once', async () => {
  reset();
  await seedApp({ access: 'ghu_rej1', refresh: 'ghr_rej1' });
  route = (request) => (request.path === '/user/installations' && request.auth === 'Bearer ghu_rej1' ? json(401, { message: 'Bad credentials' }) : undefined);
  tokenAnswers = [pair('after401')];
  const reply = await send({ type: 'gitchop:signin:installations' });
  assert.equal(reply.ok, true, 'the caller never saw the 401');
  assert.equal(refreshPosts().length, 1);
  assert.deepEqual(apiCalls().filter((call) => call.path === '/user/installations').map((call) => call.auth), ['Bearer ghu_rej1', 'Bearer ghu_after401'], 'asked again with the new token');
  assert.deepEqual(await openPair(), { access: 'ghu_after401', refresh: 'ghr_after401' });
});

test('two 401s at once are one renewal', async () => {
  reset();
  await seedApp({ access: 'ghu_rej2', refresh: 'ghr_rej2' });
  route = (request) => (request.path === '/user/installations' && request.auth === 'Bearer ghu_rej2' ? json(401, { message: 'Bad credentials' }) : undefined);
  tokenAnswers = [pair('shared')];
  const replies = await Promise.all([send({ type: 'gitchop:signin:installations' }), send({ type: 'gitchop:signin:installations' })]);
  assert.deepEqual(replies.map((reply) => reply.ok), [true, true]);
  assert.equal(refreshPosts().length, 1, 'one renewal for both');
});

test('a 401 on the new token is the answer, not a loop', async () => {
  reset();
  await seedApp({ access: 'ghu_rej3', refresh: 'ghr_rej3' });
  route = (request) => (request.path === '/user/installations' ? json(401, { message: 'Bad credentials' }) : undefined);
  tokenAnswers = [pair('stillbad')];
  const reply = await send({ type: 'gitchop:signin:installations' });
  assert.equal(reply.ok, false);
  assert.equal(refreshPosts().length, 1, 'renewed once');
  assert.equal(apiCalls().filter((call) => call.path === '/user/installations').length, 2, 'and asked again once');
});

test('a renewal GitHub refuses marks the sign-in, keeps it, and leaves the other tokens working', async () => {
  reset();
  await seedApp({ expiresIn: -1000, pats: ['ghp_pat'] });
  tokenAnswers = [{ error: 'bad_refresh_token', error_description: 'The refresh token passed is incorrect or expired.' }];
  await send({ type: 'gitchop:pulls:refresh' });
  const entry = appEntry();
  assert.equal(entry.needsSignIn, true);
  assert.equal(entry.signInError, 'bad_refresh_token');
  const state = await send({ type: 'gitchop:sync:state' });
  assert.equal(state.tokens[0].needsSignIn, true, 'the card is told');
  assert.ok(apiCalls().some((call) => call.path === '/graphql' && call.auth === 'Bearer ghp_pat'), 'the classic token is still used');
  assert.ok(!apiCalls().some((call) => call.auth?.includes('ghu_')), 'the refused sign-in is not');

  events.length = 0;
  await send({ type: 'gitchop:pulls:refresh' });
  assert.equal(refreshPosts().length, 0, 'and not renewed again');
  assert.ok(!apiCalls().some((call) => call.auth?.includes('ghu_')));
});

test('with only a refused sign-in, nothing goes out bearing it', async () => {
  reset();
  await seedApp({ needsSignIn: true });
  await send({ type: 'gitchop:pulls:refresh' });
  await send({ type: 'gitchop:contributions:refresh' });
  assert.equal(apiCalls().length, 0);
  assert.equal(refreshPosts().length, 0);
});

test('a renewal that cannot reach GitHub marks nothing, and the old token is used while it lasts', async () => {
  reset();
  await seedApp({ expiresIn: 60 * 1000 });
  tokenAnswers = [() => Promise.reject(new TypeError('offline'))];
  await send({ type: 'gitchop:pulls:refresh' });
  assert.equal(refreshPosts().length, 1, 'it tried');
  assert.equal(appEntry().needsSignIn, false, 'nothing marked');
  assert.ok(apiCalls().some((call) => call.path === '/graphql' && call.auth === 'Bearer ghu_old'), 'the unexpired token is used');
  assert.deepEqual(await openPair(), { access: 'ghu_old', refresh: 'ghr_old' });
});

test('a renewal token past its six months is not spent', async () => {
  reset();
  await seedApp({ expiresIn: -1000, refreshIn: -1000 });
  await send({ type: 'gitchop:pulls:refresh' });
  assert.equal(refreshPosts().length, 0, 'no call');
  assert.equal(appEntry().needsSignIn, true);
  assert.equal(appEntry().signInError, 'lapsed');
});

test('an index build that started before a renewal does not roll the pair back', async () => {
  reset();
  await seedApp({ access: 'ghu_build', refresh: 'ghr_build', pats: ['github_pat_org'] });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  route = (request) => {
    if (request.path === '/user/repos' && request.auth === 'Bearer ghu_build') return held.then(() => json(200, []));
    if (request.path === '/user/repos' && request.auth === 'Bearer github_pat_org') return json(200, [{ full_name: 'itk-dev/secret', html_url: 'https://github.com/itk-dev/secret', private: true }]);
    if (request.path === '/user/installations' && request.auth === 'Bearer ghu_build') return json(401, { message: 'Bad credentials' });
    return undefined;
  };
  tokenAnswers = [pair('during')];
  const building = send({ type: 'gitchop:index:build' });
  await until(() => apiCalls().some((call) => call.path === '/user/repos'), 'the build to be listing');
  const checked = await send({ type: 'gitchop:signin:installations' });
  assert.equal(checked.ok, true, 'renewed while the build waits');
  assert.deepEqual(await openPair(), { access: 'ghu_during', refresh: 'ghr_during' });
  release();
  const built = await building;
  assert.equal(built.ok, true);
  assert.equal(built.count, 1);
  assert.deepEqual(await openPair(), { access: 'ghu_during', refresh: 'ghr_during' }, 'the build’s write kept the new pair');
  assert.equal(refreshPosts().length, 1, 'renewed once');
  assert.deepEqual(stored().tokens.find((entry) => entry.id === 'pat-0').owners, ['itk-dev'], 'and the token’s owners still landed');
  assert.deepEqual(appEntry().owners, ['me', 'itk-dev'], 'as did where the app is installed');
});

test('a change built from tokens loaded before a renewal keeps the renewed pair', async () => {
  reset();
  await seedApp({ access: 'ghu_stale', refresh: 'ghr_stale' });
  const { loadTokens, updateTokens } = await import('../src/background/tokens.js');
  const stale = (await loadTokens()).map((open) => {
    const entry = { ...open };
    delete entry.secret;
    return entry;
  });
  route = (request) => (request.path === '/user/installations' && request.auth === 'Bearer ghu_stale' ? json(401, {}) : undefined);
  tokenAnswers = [pair('renewed')];
  await send({ type: 'gitchop:signin:installations' });
  await updateTokens(() => stale.map((entry) => ({ ...entry, login: 'renamed' })));
  assert.equal(appEntry().login, 'renamed', 'the change lands');
  assert.deepEqual(await openPair(), { access: 'ghu_renewed', refresh: 'ghr_renewed' }, 'but not the pair it was loaded with');
});

test('configuration writes take turns, so none is lost to another', async () => {
  reset();
  await seedApp();
  const { writeAppPair, writeConfig } = await import('../src/background/config.js');
  writeDelay = 10;
  await Promise.all([writeConfig({ gistTokenId: 'pat-0' }), writeAppPair('app-id', { expiresAt: '2030-01-01T00:00:00.000Z' }), writeConfig({ dirty: true })]);
  writeDelay = 0;
  assert.equal(stored().gistTokenId, 'pat-0');
  assert.equal(stored().dirty, true);
  assert.equal(appEntry().expiresAt, '2030-01-01T00:00:00.000Z', 'a renewal’s write survives the writes around it');
});

test('signing out forgets a flow under way; a refused sign-in stays saved but is no token', async () => {
  reset();
  await seedApp({ needsSignIn: true, gistId: 'g1' });
  const refused = await send({ type: 'gitchop:sync:state' });
  assert.equal(refused.hasToken, false, 'a refused sign-in is no token to work with');
  assert.equal(refused.tokens.length, 1, 'but it stays, for signing in again');
  assert.equal(refused.gistId, 'g1', 'and so does the backup it would write');
  await send({ type: 'gitchop:signin:start' });
  assert.ok(session.data.signin);
  assert.equal(session.data.signin.replaceId, 'app-id', 'signing in again would replace it');
  const after = await send({ type: 'gitchop:token:remove', id: 'app-id' });
  assert.equal(after.hasToken, false);
  assert.equal(after.gistId, null, 'nothing left, so the backup stops');
  assert.equal(session.data.signin, undefined, 'the code is forgotten');
  assert.ok(alarms.cleared.includes('gitchop-signin'), 'and its alarm');
});

test('a sign-in token pasted by hand is refused', async () => {
  reset();
  assert.deepEqual(await send({ type: 'gitchop:token:save', token: 'ghu_pasted' }), { ok: false, error: 'That is a sign-in token. Use Sign in with GitHub instead.' });
  assert.equal(apiCalls().length, 0);
});

test('a search goes out with the token that sees the most of the owner it names', async () => {
  reset();
  await seedApp({ access: 'ghu_search', pats: ['github_pat_elsewhere'] });
  await send({ type: 'gitchop:repos', query: 'me/thing' });
  assert.equal(apiCalls().at(-1).auth, 'Bearer ghu_search', 'the sign-in, installed on @me, where the other token does not reach');
  reset();
  await seedApp({ access: 'ghu_search', pats: ['ghp_classic'] });
  await send({ type: 'gitchop:repos', query: 'me/thing' });
  assert.ok(apiCalls().every((call) => call.auth === 'Bearer ghp_classic'), 'the classic token where both reach');
  events.length = 0;
  await send({ type: 'gitchop:repos', query: 'thing' });
  assert.ok(apiCalls().every((call) => call.auth === 'Bearer ghp_classic'), 'a bare word with the widest reach');
});

test('a sign-in on selected repositories does not hide one the classic token can see', async () => {
  reset();
  await seedApp({ access: 'ghu_sel', pats: ['ghp_classic'], installations: [{ owner: 'itk-dev', type: 'Organization', selection: 'selected' }] });
  route = (request) => {
    if (request.path !== '/repos/itk-dev/secret') return undefined;
    if (request.auth !== 'Bearer ghp_classic') return json(404, { message: 'Not Found' });
    return json(200, { full_name: 'itk-dev/secret', html_url: 'https://github.com/itk-dev/secret', default_branch: 'main', private: true });
  };
  const { results } = await send({ type: 'gitchop:repos', query: 'itk-dev/secret' });
  assert.deepEqual(results.map((repo) => repo.fullName), ['itk-dev/secret']);
  assert.ok(apiCalls().every((call) => call.auth === 'Bearer ghp_classic'), 'the sign-in is not asked');
});

test('a refused sign-in alone hides the pull request column and contributions instead of freezing them', async () => {
  reset();
  await seedApp({ needsSignIn: true });
  local.data.pullsCache = { fetchedAt: new Date(Date.now() - 3600 * 1000).toISOString(), drafts: 0, lanes: { needsReview: { total: 3, pulls: [] } } };
  const pulls = await send({ type: 'gitchop:pulls' });
  assert.equal(pulls.ok, true, pulls.error);
  assert.equal(pulls.hasToken, false);
  assert.equal(pulls.show, false, 'no column with lanes it can no longer refresh');
  const contributions = await send({ type: 'gitchop:contributions' });
  assert.equal(contributions.show, false);
  assert.equal(apiCalls().length, 0, 'and nothing asked of GitHub with it');
});

/** A gate a fake GitHub answer waits on, so a test can act while the request is in flight. */
function gate() {
  let open;
  const shut = new Promise((resolve) => {
    open = resolve;
  });
  return { shut, open: () => open() };
}

const isRenewal = (request) => request.path === '/login/oauth/access_token' && new URLSearchParams(request.body).get('grant_type') === 'refresh_token';
const isPoll = (request) => request.path === '/login/oauth/access_token' && !isRenewal(request);

for (const [answer, what] of [
  [{ error: 'bad_refresh_token' }, 'refused'],
  [pair('oldgrant'), 'granted'],
]) {
  test(`a renewal ${what} after a new sign-in took its place leaves the new sign-in alone`, async () => {
    reset();
    await seedApp({ access: 'ghu_first', refresh: 'ghr_first', expiresIn: 60 * 1000 });
    const held = gate();
    route = async (request) => {
      if (isRenewal(request)) {
        await held.shut;
        return json(200, answer);
      }
      if (isPoll(request)) return json(200, pair('second'));
      return undefined;
    };
    const searching = send({ type: 'gitchop:repos', query: 'thing' });
    await until(() => refreshPosts().length === 1, 'the renewal to be in flight');
    await send({ type: 'gitchop:signin:start' });
    intervalPassed();
    assert.equal((await send({ type: 'gitchop:signin:poll' })).status, 'done');
    held.open();
    await searching;
    assert.equal(appEntry().needsSignIn, false, 'not marked signed out');
    assert.deepEqual(await openPair(), { access: 'ghu_second', refresh: 'ghr_second' }, 'and still the new sign-in’s pair');
    events.length = 0;
    route = null;
    await send({ type: 'gitchop:pulls:refresh' });
    assert.deepEqual([...new Set(apiCalls().map((call) => call.auth))], ['Bearer ghu_second'], 'which is what goes out next');
  });
}

test('a renewal that could not be written does not come back over a new sign-in', async () => {
  reset();
  await seedApp({ expiresIn: -1000 });
  tokenAnswers = [pair('renewed')];
  const realSet = local.set;
  let failNext = true;
  local.set = async (values) => {
    if (failNext && values.sync?.tokens?.some((entry) => entry.kind === 'app' && Date.parse(entry.expiresAt) > Date.now())) {
      failNext = false;
      throw new Error('quota');
    }
    return realSet.call(local, values);
  };
  await send({ type: 'gitchop:pulls:refresh' });
  local.set = realSet;
  assert.equal(failNext, false, 'the renewal’s write failed');
  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  tokenAnswers = [pair('newsignin')];
  assert.equal((await send({ type: 'gitchop:signin:poll' })).status, 'done');
  events.length = 0;
  await send({ type: 'gitchop:pulls:refresh' });
  assert.deepEqual(await openPair(), { access: 'ghu_newsignin', refresh: 'ghr_newsignin' });
  assert.deepEqual([...new Set(apiCalls().map((call) => call.auth))], ['Bearer ghu_newsignin']);
});

test('Cancel while a poll is waiting on GitHub: the code is not written back', async () => {
  reset();
  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  const held = gate();
  route = async (request) => {
    if (!isPoll(request)) return undefined;
    await held.shut;
    return json(200, { error: 'authorization_pending' });
  };
  const polling = send({ type: 'gitchop:signin:poll' });
  await until(() => tokenPosts().length === 1, 'the poll to be in flight');
  await send({ type: 'gitchop:signin:cancel' });
  held.open();
  assert.equal((await polling).status, 'none');
  assert.equal(session.data.signin, undefined, 'the cancelled code stays gone');
  assert.deepEqual(await send({ type: 'gitchop:signin:pending' }), { ok: true, code: null });
});

for (const [cancel, what] of [
  [() => send({ type: 'gitchop:signin:cancel' }), 'Cancel'],
  [() => send({ type: 'gitchop:token:remove', id: 'app-id' }), 'Sign out'],
]) {
  test(`${what} while GitHub is approving: the approval is not kept`, async () => {
    reset();
    await seedApp({ needsSignIn: true });
    await send({ type: 'gitchop:signin:start' });
    intervalPassed();
    const held = gate();
    route = async (request) => {
      if (!isPoll(request)) return undefined;
      await held.shut;
      return json(200, pair('unwanted'));
    };
    const polling = send({ type: 'gitchop:signin:poll' });
    await until(() => tokenPosts().length === 1, 'the poll to be in flight');
    await cancel();
    held.open();
    const reply = await polling;
    assert.equal(reply.status, 'none');
    const entry = appEntry();
    if (what === 'Sign out') assert.equal(entry, undefined, 'signed out stays signed out');
    else assert.equal(entry.needsSignIn, true, 'the old entry is as it was');
    assert.ok(!apiCalls().some((call) => call.auth === 'Bearer ghu_unwanted'), 'and the token is never used');
  });
}

test('Cancel while GitHub is handing out a code: the code is never kept', async () => {
  reset();
  const held = gate();
  route = async (request) => {
    if (request.path !== '/login/device/code') return undefined;
    await held.shut;
    return undefined;
  };
  const starting = send({ type: 'gitchop:signin:start' });
  await until(() => codePosts().length === 1, 'the code request to be in flight');
  await send({ type: 'gitchop:signin:cancel' });
  held.open();
  assert.equal((await starting).ok, false);
  assert.equal(session.data.signin, undefined);
});

test('a renewal GitHub rate-limits marks nothing', async () => {
  reset();
  await seedApp({ expiresIn: 60 * 1000 });
  tokenAnswers = [() => json(429, { message: 'Too many requests' })];
  await send({ type: 'gitchop:pulls:refresh' });
  assert.equal(refreshPosts().length, 1);
  assert.equal(appEntry().needsSignIn, false);
  assert.ok(apiCalls().some((call) => call.auth === 'Bearer ghu_old'), 'the old token goes on while it lasts');
});

test('a poll GitHub rate-limits keeps the code', async () => {
  reset();
  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  tokenAnswers = [() => json(429, { message: 'rate limited' })];
  assert.equal((await send({ type: 'gitchop:signin:poll' })).status, 'network');
  assert.ok(session.data.signin, 'the code is kept for the next ask');
});

test('a sign-in whose token does not expire is never dropped for its age, and a refusal of it says so', async () => {
  reset();
  await send({ type: 'gitchop:signin:start' });
  intervalPassed();
  tokenAnswers = [{ access_token: 'ghu_forever', token_type: 'bearer' }];
  assert.equal((await send({ type: 'gitchop:signin:poll' })).status, 'done');
  assert.equal(appEntry().expiresAt, null, 'no expiry stamped on it');
  assert.equal(appEntry().sealedRefresh, undefined);
  events.length = 0;
  await send({ type: 'gitchop:pulls:refresh' });
  assert.ok(apiCalls().some((call) => call.auth === 'Bearer ghu_forever'), 'it is used');
  assert.equal(refreshPosts().length, 0, 'and never renewed');

  route = (request) => (request.auth === 'Bearer ghu_forever' ? json(401, { message: 'Bad credentials' }) : undefined);
  await send({ type: 'gitchop:pulls:refresh' });
  assert.equal(appEntry().needsSignIn, true, 'revoked on GitHub, it is marked signed out');
  assert.equal(appEntry().signInError, 'rejected');
});
