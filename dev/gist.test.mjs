import assert from 'node:assert';
import { parseExpiry, parseStore, serialise } from '../src/lib/gist.js';

// When a token runs out, from the header GitHub sends with every request made with it.
assert.equal(parseExpiry('2026-12-31 12:00:00 UTC'), '2026-12-31T12:00:00.000Z', "GitHub's header, as an ISO stamp");
assert.equal(parseExpiry(' 2026-12-31 12:00:00 UTC '), '2026-12-31T12:00:00.000Z', 'whitespace around it is nothing');
assert.equal(parseExpiry('2026-12-31T12:00:00Z'), '2026-12-31T12:00:00.000Z', 'an ISO stamp is taken as it is');
assert.equal(parseExpiry(null), null, 'no header is a token without an expiry');
assert.equal(parseExpiry(''), null);
assert.equal(parseExpiry('never'), null, 'an unreadable header is no expiry either');

const at = new Date('2026-09-28T08:00:00.000Z');
const backup = {
  links: [{ id: 'a', icon: '🔔', label: 'Notifications', url: 'https://github.com/notifications' }],
  panel: { enabled: 1 },
  news: { enabled: 1, hour: 8, repos: ['itk-dev/economics'] },
  effects: { enabled: 1, colour: 0 },
};

// The file: the links on their own, everything else under settings, each under its storage key.
const text = serialise(backup, at);
const file = JSON.parse(text);
assert.equal(file.app, 'gitchop');
assert.equal(file.format, 2, 'the settings joined the links in the second format');
assert.equal(file.updatedAt, at.toISOString());
assert.deepEqual(file.links, backup.links, 'the links stand where the first format put them');
assert.deepEqual(file.settings, { panel: backup.panel, news: backup.news, effects: backup.effects }, 'the rest sits under settings');
assert.ok(!('links' in file.settings), 'the links are not repeated under settings');
assert.ok(text.endsWith('\n'), 'the file ends in a newline, as a file should');
assert.deepEqual(JSON.parse(serialise({}, at)).links, [], 'no links is an empty list, never a missing one');

// Read back, the file is the backup it was.
const read = parseStore(text);
assert.equal(read.format, 2);
assert.deepEqual(read.links, backup.links);
assert.deepEqual(read.settings, file.settings);
assert.equal(read.updatedAt, at.toISOString());

// A file of the first format is links and nothing else: no settings, so nothing local is touched.
const old = parseStore(JSON.stringify({ app: 'gitchop', format: 1, updatedAt: '2026-01-01T00:00:00.000Z', links: backup.links }));
assert.equal(old.format, 1);
assert.deepEqual(old.links, backup.links);
assert.deepEqual(old.settings, {}, 'a first-format file carries no settings');
assert.equal(parseStore(JSON.stringify({ links: [] })).format, 1, 'no format at all is the first');

// The gist is the one input gitchop does not author, so its shape is checked before its contents.
assert.throws(() => parseStore('not json'), /not valid JSON/);
assert.throws(() => parseStore('{"app":"gitchop"}'), /no links array/);
assert.throws(() => parseStore('{"links":{}}'), /no links array/);
assert.deepEqual(parseStore('{"links":[],"settings":[1,2]}').settings, {}, 'settings that are not an object are none');
assert.deepEqual(parseStore('{"links":[],"settings":"x"}').settings, {});
assert.equal(parseStore('{"links":[],"updatedAt":5}').updatedAt, null, 'a stamp that is not a string is no stamp');

console.log('gist ok');
