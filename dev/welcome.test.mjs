import assert from 'node:assert';
import { test } from 'node:test';

// The background reads the browser off globalThis the moment it is imported, so the browser stands
// in first: storage in memory, every event a list of listeners, and a record of every tab opened
// and every time Settings was.
const listeners = {};
const on = (name) => ({ addListener: (fn) => (listeners[name] ??= []).push(fn) });
const area = () => {
  const data = {};
  return {
    data,
    async get(keys) {
      const out = {};
      for (const key of keys == null ? Object.keys(data) : [keys].flat()) if (key in data) out[key] = structuredClone(data[key]);
      return out;
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) data[key] = structuredClone(value);
    },
    async remove(keys) {
      for (const key of [keys].flat()) delete data[key];
    },
  };
};
const tabs = [];
let optionsOpened = 0;
const local = area();
const sync = area();
globalThis.chrome = {
  storage: { local, sync, onChanged: on('storage.onChanged') },
  alarms: { get: async () => undefined, create: async () => {}, clear: async () => {}, onAlarm: on('alarms.onAlarm') },
  runtime: {
    onMessage: on('runtime.onMessage'),
    onInstalled: on('runtime.onInstalled'),
    onStartup: on('runtime.onStartup'),
    openOptionsPage: async () => {
      optionsOpened += 1;
    },
    getURL: (path) => `chrome-extension://gitchop/${path}`,
  },
  tabs: {
    create: async (properties) => {
      tabs.push(properties);
      return {};
    },
  },
  action: { onClicked: on('action.onClicked'), setBadgeText: async () => {}, setTitle: async () => {} },
  permissions: { contains: async () => true, onAdded: on('permissions.onAdded'), onRemoved: on('permissions.onRemoved') },
};
globalThis.fetch = async () => new Response('{"message":"Not Found"}', { status: 404 });

await import('../src/background/index.js');
// After the stand-in, like the entry: src/lib/links.js reads the browser off globalThis as it loads.
const { onPress, opensWelcome, predatesWelcome, showsMenuHint } = await import('../src/lib/welcome.js');
const { afterLostPoll, afterPoll, countdown, ownerReach } = await import('../src/lib/signin-flow.js');

const WELCOME = 'chrome-extension://gitchop/src/welcome/welcome.html';

function send(message, sender = {}) {
  return new Promise((resolve) => {
    const answered = listeners['runtime.onMessage'][0](message, sender, resolve);
    if (!answered) resolve(undefined);
  });
}

/** Clicks the toolbar button and waits for wherever it went. */
async function click() {
  listeners['action.onClicked'][0]();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function reset() {
  tabs.length = 0;
  optionsOpened = 0;
  for (const key of Object.keys(local.data)) delete local.data[key];
}

const someToken = { tokens: [{ id: 't1', kind: 'fine-grained', login: 'me', scopes: [], owners: null, target: null, expiresAt: null, sealed: 'x' }] };

test('a first install opens nothing, and seeds the links', async () => {
  reset();
  await listeners['runtime.onInstalled'][0]({ reason: 'install' });
  assert.deepEqual(tabs, [], 'no tab: the welcome waits for the first press of the key on GitHub');
  assert.equal(optionsOpened, 0, 'nor Settings');
  assert.ok(Array.isArray(sync.data.links) && sync.data.links.length > 0, 'the default links are there to press the dot for');
});

test('the first press is owed the welcome until there is a sign-in, a token or it was put aside', async () => {
  reset();
  assert.equal((await send({ type: 'gitchop:welcome' })).first, true, 'a fresh profile: the welcome, in place of the menu');

  // Continue without signing in, or the end of the welcome, sends this; Escape and the close
  // button only close it, so it greets the next press again.
  assert.deepEqual(await send({ type: 'gitchop:welcome:done' }), { ok: true });
  assert.equal(local.data.welcomed, true, 'the mark the content script reads straight from storage');
  assert.equal((await send({ type: 'gitchop:welcome' })).first, false, 'put aside: the next press is the menu, for good');

  reset();
  local.data.sync = structuredClone(someToken);
  assert.equal((await send({ type: 'gitchop:welcome' })).first, false, 'a token saved: never the welcome');

  reset();
  local.data.sync = { tokens: [{ ...someToken.tokens[0], kind: 'app', needsSignIn: true }] };
  assert.equal((await send({ type: 'gitchop:welcome' })).first, false, 'a sign-in GitHub has since refused still counts');
});

test('the overlay signs in where it is when nothing is left to prompt for, and hands it to the page otherwise', async () => {
  const { contains } = globalThis.chrome.permissions;
  try {
    assert.deepEqual(await send({ type: 'gitchop:signin:access' }), { ok: true, granted: true }, 'Chrome, hosts granted');

    globalThis.chrome.permissions.contains = async (set) => !set.origins;
    assert.deepEqual(await send({ type: 'gitchop:signin:access' }), { ok: true, granted: false }, 'hosts missing: the page, which can ask');

    globalThis.chrome.runtime.getBrowserInfo = async () => ({ name: 'Firefox', version: '140.0' });
    globalThis.chrome.permissions.contains = async (set) => !set.data_collection;
    assert.deepEqual(await send({ type: 'gitchop:signin:access' }), { ok: true, granted: false }, 'Firefox without consent to hold a token: the page');

    globalThis.chrome.permissions.contains = async () => true;
    assert.deepEqual(await send({ type: 'gitchop:signin:access' }), { ok: true, granted: true }, 'Firefox with both');

    globalThis.chrome.permissions.contains = async () => {
      throw new Error('no such key');
    };
    assert.deepEqual(await send({ type: 'gitchop:signin:access' }), { ok: true, granted: false }, 'a Firefox that cannot answer is not let through: nothing later checks the consent');

    delete globalThis.chrome.runtime.getBrowserInfo;
    assert.deepEqual(await send({ type: 'gitchop:signin:access' }), { ok: true, granted: true }, 'a Chrome that cannot answer is; the background checks the host again');
  } finally {
    globalThis.chrome.permissions.contains = contains;
    delete globalThis.chrome.runtime.getBrowserInfo;
  }
});

test('an update opens nothing, and an update from before the welcome leaves the next press the menu', async () => {
  reset();
  await listeners['runtime.onInstalled'][0]({ reason: 'update', previousVersion: '2.9.0' });
  await listeners['runtime.onInstalled'][0]({ reason: 'browser_update' });
  assert.deepEqual(tabs, [], 'no tab on an update of gitchop or of the browser');
  const after = await send({ type: 'gitchop:welcome' });
  assert.equal(after.first, false, 'someone who has pressed the key for months gets the menu, not the welcome');
  assert.equal(after.hint, true, 'the sign-in row is left to show, the one new thing they see');

  reset();
  await listeners['runtime.onInstalled'][0]({ reason: 'update', previousVersion: '2.10.0' });
  assert.equal((await send({ type: 'gitchop:welcome' })).first, true, 'an update from a version with the welcome leaves it owed if it was');

  reset();
  await listeners['runtime.onInstalled'][0]({ reason: 'browser_update' });
  assert.equal((await send({ type: 'gitchop:welcome' })).first, true, 'an update of the browser changes nothing');
});

test('a first sign-in or token is the welcome done, so taking every token away later does not bring it back', async () => {
  reset();
  const changed = (oldValue, newValue) => {
    for (const listener of listeners['storage.onChanged']) listener({ sync: { oldValue, newValue } }, 'local');
  };
  changed(undefined, structuredClone(someToken));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(local.data.welcomed, true);
  assert.equal((await send({ type: 'gitchop:welcome' })).first, false, 'no tokens now, but no welcome either');

  reset();
  changed(structuredClone(someToken), { tokens: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(local.data.welcomed, undefined, 'a token leaving marks nothing');
});

test('the toolbar button opens the welcome until there is a sign-in, a token or the welcome was put aside', async () => {
  reset();
  await click();
  assert.deepEqual(tabs, [{ url: WELCOME }], 'nothing yet: the welcome');
  assert.equal(optionsOpened, 0);

  reset();
  assert.deepEqual(await send({ type: 'gitchop:welcome:done' }), { ok: true });
  await click();
  assert.deepEqual(tabs, [], 'the welcome put aside: no welcome');
  assert.equal(optionsOpened, 1, 'but Settings, as before');

  reset();
  local.data.sync = structuredClone(someToken);
  await click();
  assert.deepEqual(tabs, [], 'a token saved: Settings');
  assert.equal(optionsOpened, 1);

  reset();
  local.data.sync = { tokens: [{ ...someToken.tokens[0], kind: 'app', needsSignIn: true }] };
  await click();
  assert.equal(optionsOpened, 1, 'a sign-in GitHub has since refused still counts: Settings is where it is fixed');
});

test('the menu ends in the sign-in row while there is no token, until it is waved away', async () => {
  reset();
  assert.equal((await send({ type: 'gitchop:welcome' })).hint, true, 'a fresh profile: the row');

  await send({ type: 'gitchop:welcome:done' });
  assert.equal((await send({ type: 'gitchop:welcome' })).hint, true, 'putting the welcome aside leaves the row, the one reminder left');

  local.data.sync = structuredClone(someToken);
  assert.equal((await send({ type: 'gitchop:welcome' })).hint, false, 'a token saved: no row');

  reset();
  assert.deepEqual(await send({ type: 'gitchop:welcome:hint:dismiss' }), { ok: true });
  assert.equal((await send({ type: 'gitchop:welcome' })).hint, false, 'waved away: no row');
});

test('the overlay opens the welcome’s page at the browser’s question, as a child of the asking tab', async () => {
  reset();
  assert.deepEqual(await send({ type: 'gitchop:welcome:open', at: 'consent' }, { tab: { id: 7 } }), { ok: true });
  assert.deepEqual(tabs, [{ url: `${WELCOME}#consent`, openerTabId: 7 }], 'the page goes back to tab 7 once it is answered');

  reset();
  assert.deepEqual(await send({ type: 'gitchop:welcome:open' }), { ok: true });
  assert.deepEqual(tabs, [{ url: WELCOME }], 'from no tab: the page from its beginning');
});

test('what a press decides, with nothing awaited', () => {
  assert.equal(onPress({ owed: true, menuSeen: false }), 'welcome');
  assert.equal(onPress({ owed: false, menuSeen: false }), 'menu');
  assert.equal(onPress({ owed: null, menuSeen: false }), 'ask', 'not heard yet: the menu’s data, which carries the answer, decides');
  assert.equal(onPress({ owed: true, menuSeen: true }), 'menu', 'never the welcome after the menu in the same tab');
  assert.equal(onPress({ owed: null, menuSeen: true }), 'menu');
});

test('which updates come from before the welcome', () => {
  for (const version of ['2.9.0', '2.9.3', '2.0.0', '1.4', undefined, 'nonsense']) assert.equal(predatesWelcome(version), true, String(version));
  for (const version of ['2.10.0', '2.10.1', '2.11.0', '3.0.0']) assert.equal(predatesWelcome(version), false, version);
});

test('the rules on their own', () => {
  assert.equal(opensWelcome({ tokens: 0, welcomed: false }), true);
  assert.equal(opensWelcome({ tokens: 0, welcomed: true }), false);
  assert.equal(opensWelcome({ tokens: 1, welcomed: false }), false);
  assert.equal(opensWelcome(null), true, 'nothing known is a fresh profile');
  assert.equal(showsMenuHint({ tokens: 0, hintDismissed: false, welcomed: true }), true);
  assert.equal(showsMenuHint({ tokens: 0, hintDismissed: true }), false);
  assert.equal(showsMenuHint({ tokens: 2, hintDismissed: false }), false);
});

const flow = { phase: 'code', code: { userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresAt: '2026-01-01T00:15:00Z', interval: 5 }, interval: 5, status: 'waiting' };

test('what a poll’s answer does to the flow, for both pages that sign in', () => {
  assert.deepEqual(afterPoll(flow, { ok: true, status: 'slow_down', interval: 10, error: null, state: null }), { flow: { ...flow, interval: 10, status: 'waiting' }, verdict: 'waiting' });
  assert.deepEqual(afterPoll({ ...flow, status: 'network' }, { ok: true, status: 'pending', interval: 0, error: null, state: null }).flow.status, 'waiting', 'an answer is back in touch');
  assert.equal(afterPoll(flow, { ok: true, status: 'network', interval: 5, error: 'x', state: null }).flow.status, 'network');
  assert.deepEqual(afterPoll(flow, { ok: true, status: 'done', interval: 5, error: null, state: null }), { flow: null, verdict: 'signed-in' });
  assert.deepEqual(afterPoll(flow, { ok: true, status: 'none', interval: 0, error: null, state: null }), { flow: null, verdict: 'gone' });
  for (const status of ['expired', 'denied', 'disabled']) {
    assert.deepEqual(afterPoll(flow, { ok: true, status, interval: 5, error: null, state: null }), { flow: { phase: status, interval: 5 }, verdict: 'ended' });
  }
  assert.deepEqual(afterPoll(flow, { ok: true, status: 'error', interval: 5, error: 'bad code', state: null }).flow, { phase: 'error', interval: 5, error: 'bad code' });
  assert.equal(afterLostPoll(flow).status, 'network');
  assert.equal(countdown('2026-01-01T00:15:00Z', Date.parse('2026-01-01T00:00:05Z')), 'Code expires in 14:55');
});

test('who the sign-in reaches: installs, owners a saved token covers, and the rest', () => {
  const app = { id: 'a', kind: 'app', login: 'me', installations: [{ owner: 'me', type: 'User', selection: 'all' }] };
  const pat = { id: 'p', kind: 'fine-grained', owners: ['itk-dev'], target: 'itk-dev' };
  const reach = ownerReach({ tokens: [app, pat] }, app, ['itk-dev', 'Leantime', 'ME']);
  assert.deepEqual(reach.installs.map((install) => install.owner), ['me']);
  assert.deepEqual(reach.covered, ['itk-dev'], 'reached by the saved token');
  assert.deepEqual(reach.uncovered, ['Leantime'], 'the account itself is not asked for twice, whatever its casing');
  assert.equal(reach.total, 3);
  assert.equal(reach.reached, 2);
  assert.equal(reach.classic, false);
});
