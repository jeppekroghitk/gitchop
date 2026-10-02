import assert from 'node:assert';
import { test } from 'node:test';
import { ANONYMOUS, RESOURCES, noteRate, presentRate, readRate, scopeOf } from '../src/lib/rate.js';

const headers = (over = {}) =>
  new Headers({
    'X-RateLimit-Limit': '5000',
    'X-RateLimit-Remaining': '4912',
    'X-RateLimit-Used': '88',
    'X-RateLimit-Reset': '1760000000',
    'X-RateLimit-Resource': 'graphql',
    ...over,
  });

test('one answer’s headers become one reading, whatever the case of the names', () => {
  const reading = readRate(headers(), 1000);
  assert.deepEqual(reading, { resource: 'graphql', limit: 5000, remaining: 4912, used: 88, resetAt: 1760000000000, at: 1000 });
  assert.equal(readRate(headers({ 'X-RateLimit-Resource': 'Search' })).resource, 'search', 'the budget’s name is lowercased');
  assert.equal(readRate(new Headers({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '57', 'x-ratelimit-reset': '1760000000' })).resource, 'core', 'an answer that names no budget was charged to the main one');
  assert.equal(readRate(new Headers({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '57', 'x-ratelimit-reset': '1760000000' })).used, 3, 'used is worked out when not said');
  assert.equal(readRate(headers({ 'X-RateLimit-Remaining': '-3' })).remaining, 0, 'never below nothing');
  assert.equal(readRate(headers({ 'X-RateLimit-Remaining': '9000' })).remaining, 5000, 'never above the allowance');
  assert.equal(readRate(new Headers({ 'content-type': 'application/json' })), null, 'an answer with no budget headers says nothing');
  assert.equal(readRate(headers({ 'X-RateLimit-Limit': '0' })), null, 'nor one with an allowance of nothing');
  assert.equal(readRate(null), null);
  assert.equal(readRate({}), null, 'something that is not headers at all');
});

const at = (remaining, resetAt = 1760000000000, resource = 'graphql') => ({ resource, limit: 5000, remaining, used: 5000 - remaining, resetAt, at: 0 });

test('the table keeps a reading per budget per scope, the latest word winning however the answers arrived', () => {
  let table = noteRate({}, 'me', at(4912));
  assert.deepEqual(table, { me: { graphql: { limit: 5000, remaining: 4912, used: 88, resetAt: 1760000000000, at: 0 } } });
  assert.equal(noteRate(table, 'me', at(4930)), table, 'an answer that came back late, from before the last, changes nothing');
  assert.equal(noteRate(table, 'me', at(4912)), table, 'nor the same word again');
  assert.equal(noteRate(table, 'me', at(4900)).me.graphql.remaining, 4900, 'a lower remaining is the later word');
  assert.equal(noteRate(table, 'me', at(4999, 1760003600000)).me.graphql.remaining, 4999, 'a new allowance replaces the old whatever it holds');
  assert.equal(noteRate(table, 'me', at(10, 1759996400000)), table, 'a reading from an allowance already turned over is no word');
  table = noteRate(table, 'me', at(29, 1760000060000, 'search'));
  assert.deepEqual(Object.keys(table.me), ['graphql', 'search'], 'budgets sit side by side');
  table = noteRate(table, ANONYMOUS, { ...at(57), limit: 60, resource: 'core' });
  assert.deepEqual(Object.keys(table), ['me', ANONYMOUS], 'and so do scopes');
  assert.equal(noteRate(table, 'me', null), table, 'nothing read is nothing noted');
  assert.equal(noteRate(table, '', at(1)), table, 'nor anything under no scope');
  assert.equal(noteRate(undefined, 'me', at(1)).me.graphql.remaining, 1, 'a table from nothing');
});

test('a token’s readings are kept under its login, or its id until GitHub has said who it is', () => {
  assert.equal(scopeOf({ id: 'abc', login: 'jeppe' }), 'jeppe');
  assert.equal(scopeOf({ id: 'abc', login: null }), 'abc');
  assert.equal(scopeOf(null), '');
});

// The budgets as the gauge lists them: tokens in their order, each login once, the nameless last,
// only what has a reading, and within a scope the budgets gitchop draws on first.
test('the budgets are listed as the gauge shows them', () => {
  assert.deepEqual(RESOURCES.map((entry) => entry.id), ['graphql', 'core', 'search']);
  const table = {
    jeppe: { search: at(29, 1760000060000, 'search'), graphql: at(4912), code_search: { limit: 10, remaining: 9, resetAt: 1, at: 0 } },
    org: { core: { limit: 5000, remaining: 4000, used: 1000, resetAt: 1760000000000, at: 0 } },
    gone: { core: at(1) },
    [ANONYMOUS]: { core: { limit: 60, remaining: 57, used: 3, resetAt: 1760000000000, at: 0 } },
  };
  const tokens = [{ id: 't1', login: 'jeppe' }, { id: 't2', login: 'jeppe' }, { id: 't3', login: 'org' }, { id: 't4', login: null }];
  const shown = presentRate(table, tokens);
  assert.deepEqual(shown.map((scope) => scope.id), ['jeppe', 'org', ANONYMOUS], 'two tokens of one login are one scope; a token with no reading has no line; a login no token has any more is gone');
  assert.deepEqual(shown.map((scope) => scope.label), ['jeppe', 'org', 'no token']);
  assert.deepEqual(shown[0].resources.map((entry) => entry.id), ['graphql', 'search', 'code_search'], 'the known budgets in their order, then whatever else GitHub named');
  assert.deepEqual(shown[0].resources[0], { id: 'graphql', label: 'graphql', limit: 5000, remaining: 4912, resetAt: 1760000000000 });
  assert.equal(shown[0].resources[1].label, 'search');
  assert.equal(shown[0].resources[2].label, 'code_search', 'an unknown budget is named as GitHub names it');
  assert.equal(shown[1].resources[0].label, 'rest', 'the main budget is called what it is');
  assert.deepEqual(presentRate(table, []), [{ id: ANONYMOUS, label: 'no token', resources: [{ id: 'core', label: 'rest', limit: 60, remaining: 57, resetAt: 1760000000000 }] }], 'with no token only the nameless budgets are left');
  assert.deepEqual(presentRate({}, tokens), [], 'nothing read yet is nothing to show');
  assert.deepEqual(presentRate(null, null), []);
  assert.deepEqual(presentRate({ jeppe: 'junk' }, tokens), [], 'a scope that is not a table is nothing');
});
