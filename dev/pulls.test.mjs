import assert from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULTS,
  LANES,
  SWITCHES,
  age,
  buildQuery,
  mergeLanes,
  sanitizeSettings,
  shapePull,
  splitLanes,
  verdictOf,
} from '../src/lib/pulls.js';

test('settings are three switches, each on or off, defaults as specified', () => {
  assert.deepEqual(sanitizeSettings(), DEFAULTS, 'nothing stored means the defaults');
  assert.deepEqual(sanitizeSettings(null), DEFAULTS);
  assert.deepEqual(sanitizeSettings('junk'), DEFAULTS);
  assert.deepEqual(sanitizeSettings({ enabled: 0, badge: '0', drafts: true }), { enabled: 0, badge: 0, drafts: 1 });
  assert.equal(sanitizeSettings({ enabled: 7 }).enabled, 1, 'anything at or above one is on');
  assert.equal(sanitizeSettings({ badge: {} }).badge, 1, 'a non-number falls back to the default');
  assert.deepEqual(DEFAULTS, { enabled: 1, badge: 1, drafts: 0 }, 'the column and its badge are on, drafts are out');
  for (const item of SWITCHES) assert.ok(item.label && item.hint, `${item.id} carries its settings-page text`);
});

test('the query excludes drafts unless asked not to, and asks for what the lanes need', () => {
  const strict = buildQuery({ drafts: 0 });
  assert.match(strict.variables.requested, /review-requested:@me/);
  assert.match(strict.variables.mine, /author:@me/);
  assert.match(strict.variables.requested, /draft:false/);
  assert.match(strict.variables.mine, /draft:false/);
  assert.doesNotMatch(buildQuery({ drafts: 1 }).variables.mine, /draft:/, 'drafts on means no draft filter at all');
  assert.match(strict.query, /latestReviews/, 'review state comes from the latest review per reviewer');
  assert.match(strict.query, /issueCount/, 'GitHub’s own count backs the "more" figure');
});

test('changes requested outranks approval; comments alone are no verdict', () => {
  assert.equal(verdictOf([{ state: 'APPROVED' }]), 'approved');
  assert.equal(verdictOf([{ state: 'APPROVED' }, { state: 'CHANGES_REQUESTED' }]), 'changes');
  assert.equal(verdictOf([{ state: 'COMMENTED' }]), null);
  assert.equal(verdictOf([]), null);
  assert.equal(verdictOf(undefined), null);
});

const node = (over = {}) => ({
  number: 412,
  title: 'Fix feed source caching',
  url: 'https://github.com/os2display/display-api-service/pull/412',
  isDraft: false,
  updatedAt: '2026-09-11T10:00:00Z',
  repository: { nameWithOwner: 'os2display/display-api-service', isPrivate: true },
  author: { login: 'jekuno' },
  latestReviews: { nodes: [] },
  ...over,
});

test('a pull request is shaped down to what a row needs', () => {
  const shaped = shapePull(node());
  assert.equal(shaped.repoShort, 'display-api-service', 'the owner is dropped; you know which one is yours');
  assert.equal(shaped.repo, 'os2display/display-api-service');
  assert.equal(shaped.private, true);
  assert.equal(shaped.author, 'jekuno');
  assert.equal(shaped.verdict, null);
  assert.equal(shapePull(null), null, 'a null node — a deleted repository — is dropped, not crashed on');
  assert.equal(shapePull({ title: 'no url' }), null);
  assert.equal(shapePull(node({ author: null })).author, '', 'a ghost author is an empty string');
  assert.equal(shapePull(node({ title: 'x'.repeat(200) })).title.length, 140, 'titles are capped');
});

const lanes = splitLanes({
  requested: { issueCount: 7, nodes: [node({ number: 1, url: 'https://github.com/a/b/pull/1', updatedAt: '2026-09-10T00:00:00Z' }), node({ number: 2, url: 'https://github.com/a/b/pull/2', updatedAt: '2026-09-11T00:00:00Z' })] },
  mine: {
    issueCount: 3,
    nodes: [
      node({ number: 10, url: 'https://github.com/a/b/pull/10', latestReviews: { nodes: [{ state: 'APPROVED' }] } }),
      node({ number: 11, url: 'https://github.com/a/b/pull/11', latestReviews: { nodes: [{ state: 'COMMENTED' }] } }),
      node({ number: 12, url: 'https://github.com/a/b/pull/12', latestReviews: { nodes: [{ state: 'CHANGES_REQUESTED' }] } }),
      null,
    ],
  },
});

test('review requests come first; own pull requests split on whether anyone has answered', () => {
  assert.deepEqual(lanes.needsReview.pulls.map((pull) => pull.number), [2, 1], 'newest first');
  assert.equal(lanes.needsReview.total, 7, 'GitHub counted more than it sent');
  assert.deepEqual(lanes.reviewed.pulls.map((pull) => pull.number).sort(), [10, 12]);
  assert.deepEqual(lanes.unreviewed.pulls.map((pull) => pull.number), [11], 'a comment is not an answer');
  assert.equal(lanes.reviewed.total, 2);
  assert.equal(lanes.unreviewed.total, 1);
  assert.deepEqual(splitLanes(undefined).needsReview, { pulls: [], total: 0 }, 'no data is empty lanes, not a throw');
});

test('merged across tokens, the same URL counts once and unseen remainders add up', () => {
  const merged = mergeLanes([
    lanes,
    splitLanes({
      requested: { issueCount: 1, nodes: [node({ number: 2, url: 'https://github.com/a/b/pull/2' })] },
      mine: { issueCount: 0, nodes: [] },
    }),
  ]);
  assert.equal(merged.needsReview.pulls.length, 2, 'the duplicate from the second token is dropped');
  assert.equal(merged.needsReview.total, 7, '2 seen + 5 the first token counted beyond what it sent');
  assert.equal(merged.reviewed.total, 2);
  assert.deepEqual(mergeLanes([]).unreviewed, { pulls: [], total: 0 });
  for (const lane of LANES) assert.ok(lane.id in merged, `${lane.id} is always present`);
  assert.deepEqual(
    LANES.map((lane) => lane.id),
    ['reviewed', 'needsReview', 'unreviewed'],
    'answers to your own work first, then what waits on you, then your work nobody has answered',
  );
});

test('an age is the shortest thing that still says how stale a pull request is', () => {
  const now = Date.parse('2026-09-11T12:00:00Z');
  assert.equal(age('2026-09-11T11:59:40Z', now), 'now');
  assert.equal(age('2026-09-11T11:20:00Z', now), '40m');
  assert.equal(age('2026-09-11T10:00:00Z', now), '2h');
  assert.equal(age('2026-09-08T12:00:00Z', now), '3d');
  assert.equal(age('2026-08-28T12:00:00Z', now), '2w');
  assert.equal(age('2026-06-01T12:00:00Z', now), '3mo');
  assert.equal(age(null, now), '');
  assert.equal(age('garbage', now), '');
});
