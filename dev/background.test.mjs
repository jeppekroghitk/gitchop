import assert from 'node:assert';
import { test } from 'node:test';

// The background reads the browser off globalThis the moment it is imported, and wraps the global
// fetch, so both stand in before the import: storage kept in memory, every event a list of
// listeners, and a GitHub that knows nothing.
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
const badges = [];
globalThis.chrome = {
  storage: { local: area(), sync: area(), onChanged: on('storage.onChanged') },
  alarms: { get: async () => undefined, create: async () => {}, clear: async () => {}, onAlarm: on('alarms.onAlarm') },
  runtime: { onMessage: on('runtime.onMessage'), onInstalled: on('runtime.onInstalled'), onStartup: on('runtime.onStartup'), openOptionsPage: async () => {} },
  action: { onClicked: on('action.onClicked'), setBadgeText: async (badge) => badges.push(badge), setTitle: async () => {} },
  permissions: { contains: async () => true, onAdded: on('permissions.onAdded'), onRemoved: on('permissions.onRemoved') },
};
globalThis.fetch = async () => new Response('{"message":"Not Found"}', { status: 404 });

await import('../src/background/index.js');

// Every listener is in place by the time the entry has been evaluated, before anything it started
// has had a chance to settle: an event page or service worker woken by an event delivers it only
// to the listeners already there. So the count is taken straight after the import, not when the
// test that checks it gets its turn.
const firstPass = Object.fromEntries(Object.entries(listeners).map(([name, list]) => [name, list.length]));

test('every listener is in place by the time the entry has been evaluated', () => {
  assert.deepEqual(
    firstPass,
    {
      'runtime.onMessage': 1,
      'runtime.onInstalled': 1,
      'runtime.onStartup': 2,
      'alarms.onAlarm': 1,
      'action.onClicked': 1,
      'permissions.onAdded': 1,
      'permissions.onRemoved': 1,
      'storage.onChanged': 1,
    },
    'every listener is added on the first pass through the entry',
  );
});

function send(message) {
  return new Promise((resolve) => {
    const answered = listeners['runtime.onMessage'][0](message, {}, resolve);
    if (!answered) resolve(undefined);
  });
}

test('a message nobody handles is left for someone else', async () => {
  assert.equal(await send({ type: 'gitchop:nothing' }), undefined, 'a message nobody handles is left for someone else');
  assert.equal(await send(null), undefined, 'and so is no message at all');
});

test('a fresh profile answers with no tokens and no gist', async () => {
  const synced = await send({ type: 'gitchop:sync:state' });
  assert.equal(synced.ok, true);
  assert.deepEqual(synced.tokens, [], 'a fresh profile has no tokens');
  assert.equal(synced.connected, false);
});

test('a failure answers with its sentence', async () => {
  assert.deepEqual(await send({ type: 'gitchop:token:save', token: '  ' }), { ok: false, error: 'A token is required.' }, 'a failure answers with its sentence');
});

test('the panel switch is stored where the gist will find it', async () => {
  assert.deepEqual(await send({ type: 'gitchop:panel' }), { ok: true, settings: { enabled: 1 }, show: true });
  assert.deepEqual(await send({ type: 'gitchop:panel:settings', patch: { enabled: 0 } }), { ok: true, settings: { enabled: 0 }, show: false });
  assert.deepEqual(globalThis.chrome.storage.sync.data.panel, { enabled: 0 }, 'the switch is stored where the gist will find it');
});

test('no token means no pull request column and no snapshot', async () => {
  const pulls = await send({ type: 'gitchop:pulls' });
  assert.equal(pulls.show, false, 'no token means no pull request column');
  assert.equal(pulls.lanes.every((lane) => lane.pulls === null), true, 'and no snapshot to draw from');
});

test('an empty index and no budget before GitHub has answered', async () => {
  assert.deepEqual(await send({ type: 'gitchop:index:state' }), { ok: true, count: 0, privateCount: 0, owners: [], failures: [], builtAt: null });
  assert.deepEqual(await send({ type: 'gitchop:rate' }), { ok: true, scopes: [] }, 'no answer from GitHub yet, so no budget to show');
});

test('with access granted and nothing waiting, the badge is blank', () => {
  assert.deepEqual(badges.at(-1), { text: '' }, 'with access granted and nothing waiting, the badge is blank');
});
