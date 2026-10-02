import assert from 'node:assert';
import { test } from 'node:test';
// The menu's pure parts, in a module of their own that touches nothing of the page, so it imports
// under plain node.
import { countdown, diffRows, gaugeRows, laneRows, orderRepos, standsPanel } from '../src/content/menu/rows.js';

const repo = (fullName, owned = true) => ({ fullName, url: `https://github.com/${fullName}`, description: '', private: false, archived: false, owned });
const names = (list) => list.map((entry) => entry.fullName);
const index = ['ITK-Leantime/leantime', 'ITK-Leantime/leantime-mcp', 'ITK-Leantime/leantime-timetable', 'ITK-Leantime/leantime-omnisearch', 'ITK-Leantime/leantime_databridge'].map((name) => repo(name));

test('the rows under Repositories are the index first, then GitHub, no repeats, five at most', () => {
  assert.deepEqual(names(orderRepos('leantime', index, [repo('Leantime/leantime', false)], 5)), names(index), 'a bare word: the index fills the five slots and GitHub waits behind them');
  assert.deepEqual(names(orderRepos('economics', [repo('itk-dev/economics')], [repo('ITK-DEV/economics', false), repo('someone/economics', false)], 5)), ['itk-dev/economics', 'someone/economics'], 'the same repository from both sides is one row, in the index’s casing');
  assert.deepEqual(orderRepos('x', [], [], 5), []);
  assert.deepEqual(orderRepos('x', undefined, undefined, 5), [], 'no results from either side is no rows');
});

test('an exact owner/repository, from either side, is the first row whatever else matches', () => {
  assert.deepEqual(
    names(orderRepos('leantime/leantime', index, [repo('Leantime/leantime', false)], 5)),
    ['Leantime/leantime', 'ITK-Leantime/leantime', 'ITK-Leantime/leantime-mcp', 'ITK-Leantime/leantime-timetable', 'ITK-Leantime/leantime-omnisearch'],
    'GitHub’s direct hit goes first and the fifth index match makes room',
  );
  assert.deepEqual(
    names(orderRepos('itk-leantime/leantime-mcp', index, [], 5))[0],
    'ITK-Leantime/leantime-mcp',
    'an exact match inside the index moves to the top, case aside',
  );
  assert.deepEqual(names(orderRepos('https://github.com/Leantime/leantime/', index, [repo('Leantime/leantime', false)], 5))[0], 'Leantime/leantime', 'a pasted address is its owner/repository');
  assert.deepEqual(names(orderRepos('  Leantime/leantime  ', index, [repo('Leantime/leantime', false)], 5))[0], 'Leantime/leantime', 'whitespace around it is nothing');
  assert.deepEqual(names(orderRepos('leantime/leantime', index, [], 5)), names(index), 'no exact hit anywhere: the order stands');
  assert.deepEqual(names(orderRepos('leantime/leantime', index, [repo('Leantime/leantime', false)], 2)), ['Leantime/leantime', 'ITK-Leantime/leantime'], 'the limit applies after the exact hit is placed');
});

const lane = (id, pulls, over = {}) => ({ id, title: id, empty: `nothing in ${id}`, slots: 2, all: 'https://github.com/pulls', total: pulls?.length ?? null, pulls, ...over });
const pr = (repo, number, over = {}) => ({ number, url: `https://github.com/${repo}/pull/${number}`, title: `#${number}`, repo, repoShort: repo.split('/')[1], age: '1h', verdict: null, ...over });
const keyOf = (laneId, pull) => `pull:${laneId}:${pull.url.toLowerCase()}`;
const keys = (data) => laneRows(data).map((row) => row.key);

const a = pr('itk-dev/economics', 1);
const b = pr('itk-dev/economics', 2);
const c = pr('itk-dev/gitchop', 3);
const before = { lanes: [lane('reviewed', [a]), lane('needsReview', [b, c]), lane('unreviewed', [])] };
const tailed = { lanes: [lane('needsReview', [b], { total: 4 })] };

// The pull request column as keyed rows: each lane its heading, its rows, and a quiet line or a
// tail as it needs; skeletons before the snapshot; one line for a failure before anything loaded.
test('the pull request column is keyed rows, lane by lane', () => {
  assert.deepEqual(
    keys(before),
    ['section:reviewed', keyOf('reviewed', a), 'section:needsReview', keyOf('needsReview', b), keyOf('needsReview', c), 'section:unreviewed', 'empty:unreviewed'],
    'each lane is its heading, its rows, and a quiet line when it holds none',
  );
  assert.deepEqual(
    keys({ lanes: [lane('reviewed', null), lane('needsReview', null, { slots: 1 })] }),
    ['section:reviewed', 'ghost:reviewed:0', 'ghost:reviewed:1', 'section:needsReview', 'ghost:needsReview:0'],
    'before the snapshot a lane is its skeletons',
  );
  assert.equal(keys(tailed).at(-1), 'more:needsReview', 'past what was fetched a lane ends in its tail');
  assert.equal(laneRows(tailed).at(-1).count, 3, 'which says how many are beyond');
  assert.equal(keys({ lanes: [lane('needsReview', [b], { total: 4, all: 'javascript:alert(1)' })] }).at(-1), keyOf('needsReview', b), 'a tail that is not a safe link is no tail');
  assert.deepEqual(keys({ error: 'GitHub did not answer.', lanes: [lane('reviewed', null)] }), ['error'], 'a failure before anything loaded is one line in place of the lanes');
  assert.equal(keys({ error: 'GitHub did not answer.', lanes: [lane('reviewed', [a])] })[0], 'section:reviewed', 'a failure over a snapshot keeps the snapshot');
  assert.deepEqual(keys({}), [], 'no answer at all is no rows');
  assert.deepEqual(keys(null), [], 'nor is nothing');
  assert.equal(keys({ lanes: [lane('reviewed', [pr('ITK-Dev/Economics', 1)])] })[1], keyOf('reviewed', a), 'the key is the address, case aside');
  assert.equal(laneRows(before)[1].pull, a, 'a row carries its pull request');
  assert.equal(laneRows(before)[6].text, 'nothing in unreviewed', 'and a quiet line its lane’s words');
});

// Between two paints: what goes, what comes, in drawn order. A row is what it is, not what it says.
test('between two paints, what goes and what comes, in drawn order', () => {
  let diff = diffRows(keys(before), laneRows({ lanes: [lane('reviewed', [a]), lane('needsReview', [c]), lane('unreviewed', [])] }));
  assert.deepEqual(diff, { gone: [keyOf('needsReview', b)], added: [] }, 'the pull request just reviewed leaves Waiting on you and nothing else moves');
  diff = diffRows(keys(before), laneRows({ lanes: [lane('reviewed', [a]), lane('needsReview', []), lane('unreviewed', [])] }));
  assert.deepEqual(diff.gone, [keyOf('needsReview', b), keyOf('needsReview', c)], 'both leave, top to bottom');
  assert.deepEqual(diff.added, ['empty:needsReview'], 'and the quiet line arrives in the lane that emptied');
  const d = pr('itk-dev/gitchop', 4);
  diff = diffRows(keys({ lanes: [lane('reviewed', []), lane('unreviewed', [d])] }), laneRows({ lanes: [lane('reviewed', [{ ...d, verdict: 'approved' }]), lane('unreviewed', [])] }));
  assert.deepEqual(diff.gone, ['empty:reviewed', keyOf('unreviewed', d)], 'a verdict on one of yours: it leaves Waiting on others, and the quiet line under Feedback goes');
  assert.deepEqual(diff.added, [keyOf('reviewed', d), 'empty:unreviewed'], 'it arrives under Feedback, and Waiting on others gets its quiet line');
  const ticked = { lanes: before.lanes.map((entry) => ({ ...entry, pulls: entry.pulls?.map((item) => ({ ...item, age: '2h', title: 'renamed on GitHub' })) })) };
  assert.deepEqual(diffRows(keys(before), laneRows(ticked)), { gone: [], added: [] }, 'ages ticking on and a title edited move nothing');
  assert.deepEqual(diffRows(keys(tailed), laneRows({ lanes: [lane('needsReview', [b], { total: 2 })] })), { gone: [], added: [] }, 'a tail that shrinks is the same tail');
  assert.deepEqual(diffRows(keys(tailed), laneRows({ lanes: [lane('needsReview', [b], { total: 1 })] })).gone, ['more:needsReview'], 'one no longer needed goes');
  assert.deepEqual(diffRows(keys({ lanes: [lane('reviewed', null)] }), laneRows({ lanes: [lane('reviewed', [a])] })), { gone: ['ghost:reviewed:0', 'ghost:reviewed:1'], added: [keyOf('reviewed', a)] }, 'the snapshot replaces the skeletons');
  assert.deepEqual(diffRows([], laneRows(before)).added, keys(before), 'the first paint is all arrivals');
});

// The gauge: a bar per budget as of now, filling with what is used, back at nothing once its allowance has turned.
test('the gauge’s count-down says how long until an allowance turns', () => {
  assert.equal(countdown(38_400), '39s', 'seconds, rounded up');
  assert.equal(countdown(60_000), '1m');
  assert.equal(countdown(41 * 60_000 - 1), '41m');
  assert.equal(countdown(3_600_000), '1h', 'an hour is the most an allowance waits');
  assert.equal(countdown(-5), '0s', 'never from the past');
});

test('the gauge is a bar per budget as of now, back at nothing once its allowance has turned', () => {
  const t = 1_760_000_000_000;
  const budget = (id, label, remaining, limit, resetAt) => ({ id, label, remaining, limit, resetAt });
  const state = {
    scopes: [{ id: 'jeppe', label: 'jeppe', resources: [budget('graphql', 'graphql', 4912, 5000, t + 41 * 60_000), budget('search', 'search', 2, 30, t + 38_000)] }],
  };
  let gauge = gaugeRows(state, t);
  assert.deepEqual(gauge, [
    { scope: '', name: 'graphql', used: 88, limit: 5000, share: 88 / 5000, percent: 2, resetIn: '41m', high: false },
    { scope: '', name: 'search', used: 28, limit: 30, share: 28 / 30, percent: 94, resetIn: '38s', high: true },
  ], 'one scope goes unnamed; the figure is rounded up; past nine tenths used is high');
  gauge = gaugeRows(state, t + 39_000);
  assert.deepEqual(gauge[1], { scope: '', name: 'search', used: 0, limit: 30, share: 0, percent: 0, resetIn: '', high: false }, 'an allowance that has turned is back at nothing, with no count-down');
  assert.equal(gauge[0].resetIn, '41m', 'the other still counts down');
  assert.equal(gaugeRows({ scopes: [{ id: 'x', label: 'x', resources: [budget('graphql', 'graphql', 4999, 5000, t + 1)] }] }, t)[0].percent, 1, 'any use at all shows; nought means untouched');
  assert.equal(gaugeRows({ scopes: [{ id: 'x', label: 'x', resources: [budget('graphql', 'graphql', 0, 5000, t + 1)] }] }, t)[0].percent, 100, 'all of it used is the whole bar');
  const two = { scopes: [...state.scopes, { id: 'anonymous', label: 'no token', resources: [budget('core', 'rest', 57, 60, t + 60_000)] }] };
  assert.deepEqual(gaugeRows(two, t).map((row) => row.scope), ['jeppe', 'jeppe', 'no token'], 'two scopes are named on every line, for the gauge to head them');
  assert.deepEqual(gaugeRows(null, t), [], 'no answer is no gauge');
  assert.deepEqual(gaugeRows({ scopes: [] }, t), []);
  assert.deepEqual(gaugeRows({ scopes: [{ id: 'x', label: 'x', resources: [budget('core', 'rest', 70, 0, t + 1)] }] }, t)[0].limit, 1, 'an allowance of nothing is never divided by');
  assert.equal(gaugeRows({ scopes: [{ id: 'x', label: 'x', resources: [budget('core', 'rest', 70, 60, t + 1)] }] }, t)[0].used, 0, 'more left than the allowance is nothing used');
  assert.equal(gaugeRows({ scopes: [{ id: 'x', label: 'x', resources: [budget('core', 'rest', -4, 60, t + 1)] }] }, t)[0].used, 60, 'less than nothing left is all of it used');
});

test('the panel stands unless switched off, and even then only steps aside for a column that stands', () => {
  assert.equal(standsPanel(null, null, null), true, 'no answer about the panel is the panel');
  assert.equal(standsPanel({ show: true }, { show: true }, null), true);
  assert.equal(standsPanel({ show: false }, { show: true }, null), false, 'switched off beside the pull requests, it goes');
  assert.equal(standsPanel({ show: false }, null, { show: true, repos: ['a/b'] }), false, 'beside news with something subscribed, it goes');
  assert.equal(standsPanel({ show: false }, null, { show: true, repos: [] }), true, 'news with nothing subscribed is no column, so the panel stays');
  assert.equal(standsPanel({ show: false }, { show: false }, null), true, 'with no column at all it is never nothing');
});
