import assert from 'node:assert';
import { test } from 'node:test';
import { CLIENT_ID, missingInstalls, pairFrom, pollToken, readOutcome, refreshPair, requestCode } from '../src/lib/signin.js';

const at = Date.parse('2026-10-02T08:00:00.000Z');

/** Answers every fetch with one response, and keeps what was asked. */
function answering(status, body, calls = []) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

test('a poll’s answer is read from its body, whatever the status said', () => {
  const pair = { access_token: 'ghu_a', refresh_token: 'ghr_b', expires_in: 28800, refresh_token_expires_in: 15897600 };
  assert.deepEqual(readOutcome(pair, 5, at), { status: 'done', pair: pairFrom(pair, at) });
  assert.deepEqual(readOutcome({ error: 'authorization_pending' }, 5, at), { status: 'pending', interval: 5 });
  assert.deepEqual(readOutcome({ error: 'slow_down', interval: 10 }, 5, at), { status: 'slow_down', interval: 10 }, 'the interval GitHub names');
  assert.deepEqual(readOutcome({ error: 'slow_down' }, 5, at), { status: 'slow_down', interval: 10 }, 'or five seconds more');
  assert.deepEqual(readOutcome({ error: 'expired_token' }, 5, at), { status: 'expired' });
  assert.deepEqual(readOutcome({ error: 'token_expired' }, 5, at), { status: 'expired' });
  assert.deepEqual(readOutcome({ error: 'access_denied' }, 5, at), { status: 'denied' });
  assert.deepEqual(readOutcome({ error: 'device_flow_disabled' }, 5, at), { status: 'disabled' });
  assert.deepEqual(readOutcome({ error: 'incorrect_device_code', error_description: 'The device_code provided is not valid.' }, 5, at), {
    status: 'error',
    error: 'The device_code provided is not valid.',
  });
  assert.deepEqual(readOutcome({ error: 'unsupported_grant_type' }, 5, at), { status: 'error', error: 'unsupported_grant_type' });
  assert.equal(readOutcome({ error: 'incorrect_client_credentials' }, 5, at).status, 'error');
  assert.equal(readOutcome(null, 5, at).status, 'error', 'nothing at all is an error, not a hang');
});

test('a pair says when each half runs out, as stamps', () => {
  assert.deepEqual(pairFrom({ access_token: 'ghu_a', refresh_token: 'ghr_b', expires_in: 3600, refresh_token_expires_in: 7200 }, at), {
    access: 'ghu_a',
    refresh: 'ghr_b',
    expiresAt: '2026-10-02T09:00:00.000Z',
    refreshExpiresAt: '2026-10-02T10:00:00.000Z',
  });
  const unsaid = pairFrom({ access_token: 'ghu_a', refresh_token: 'ghr_b' }, at);
  assert.equal(unsaid.expiresAt, '2026-10-02T16:00:00.000Z', 'eight hours when GitHub does not say');
  assert.equal(Date.parse(unsaid.refreshExpiresAt) - at, 15897600 * 1000, 'and the documented six months for the renewal');
  assert.equal(pairFrom({ access_token: 'ghu_a', refresh_token: 'ghr_b', expires_in: 'soon' }, at).expiresAt, '2026-10-02T16:00:00.000Z', 'a lifetime that is not a number is not one');
  const lasting = pairFrom({ access_token: 'ghu_forever' }, at);
  assert.equal(lasting.expiresAt, null, 'a token that comes alone, with no lifetime, does not run out');
  assert.equal(lasting.refresh, '');
  assert.equal(pairFrom({ access_token: 'ghu_a', expires_in: 3600 }, at).expiresAt, '2026-10-02T09:00:00.000Z', 'a lifetime GitHub states is kept, renewal or not');
});

test('the owners still without the app, once each, in the order given', () => {
  const installations = [{ owner: 'Me', type: 'User', selection: 'all' }, { owner: 'itk-dev', type: 'Organization', selection: 'selected' }];
  assert.deepEqual(missingInstalls(installations, ['me', 'ITK-dev', 'os2display', '@os2forms', 'OS2display', '', null]), ['os2display', 'os2forms']);
  assert.deepEqual(missingInstalls(null, ['me']), ['me'], 'not knowing is not installed');
});

test('asking for a code sends the client id and nothing secret', async () => {
  const calls = answering(200, { device_code: 'dev', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 899, interval: 5 });
  const code = await requestCode(at);
  assert.deepEqual(code, { deviceCode: 'dev', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresAt: at + 899000, interval: 5 });
  assert.equal(calls[0].url, 'https://github.com/login/device/code');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  assert.equal(calls[0].init.body, `client_id=${CLIENT_ID}`);
  assert.doesNotMatch(calls[0].init.body, /secret/);
});

test('a code GitHub will not give is a sentence', async () => {
  answering(404, { error: 'Not Found' });
  await assert.rejects(requestCode(at), { message: 'GitHub does not know gitchop’s app.' });
  answering(400, { error: 'device_flow_disabled' });
  await assert.rejects(requestCode(at), /switched off/);
  answering(200, { nothing: true });
  await assert.rejects(requestCode(at), /no code/);
});

test('a poll throws only when GitHub could not be asked', async () => {
  const calls = answering(200, { error: 'authorization_pending' });
  assert.deepEqual(await pollToken('dev', 5, at), { status: 'pending', interval: 5 });
  assert.equal(calls[0].url, 'https://github.com/login/oauth/access_token');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].init.body)), {
    client_id: CLIENT_ID,
    device_code: 'dev',
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  answering(502, 'Bad gateway');
  await assert.rejects(pollToken('dev', 5, at), /502/);
  answering(200, 'not json');
  await assert.rejects(pollToken('dev', 5, at), /other than JSON/);
});

test('a poll answered with no verdict keeps the code, by throwing', async () => {
  answering(429, { message: 'rate limited' });
  await assert.rejects(pollToken('dev', 5, at), /429/);
  answering(200, { message: 'something odd' });
  await assert.rejects(pollToken('dev', 5, at), /200/);
  answering(429, { error: 'slow_down', interval: 10 });
  await assert.rejects(pollToken('dev', 5, at), /429/, 'a rate limit is not the end of the code, whatever it says');
  answering(400, { error: 'incorrect_device_code' });
  assert.equal((await pollToken('dev', 5, at)).status, 'error', 'a verdict GitHub names still ends it');
});

test('a renewal sends the renewal token and no secret, and a refusal is an error, not a throw', async () => {
  const calls = answering(200, { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 15897600 });
  const renewed = await refreshPair('ghr_old', at);
  assert.equal('pair' in renewed && renewed.pair.access, 'ghu_new');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].init.body)), { client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: 'ghr_old' });
  answering(200, { error: 'bad_refresh_token' });
  assert.deepEqual(await refreshPair('ghr_old', at), { error: 'bad_refresh_token' });
  answering(503, 'down');
  await assert.rejects(refreshPair('ghr_old', at), /503/);
});

test('only a refusal GitHub names ends a sign-in; a rate limit or an odd answer is a throw', async () => {
  answering(400, { error: 'invalid_grant' });
  assert.deepEqual(await refreshPair('ghr_old', at), { error: 'invalid_grant' });
  answering(429, { message: 'Too many requests' });
  await assert.rejects(refreshPair('ghr_old', at), /429/);
  answering(403, { message: 'API rate limit exceeded' });
  await assert.rejects(refreshPair('ghr_old', at), /403/);
  answering(200, { message: 'something odd' });
  await assert.rejects(refreshPair('ghr_old', at), /200/);
  answering(400, { error: 'something_new' });
  await assert.rejects(refreshPair('ghr_old', at), /something_new/, 'an error code gitchop does not know is no verdict either');
});
