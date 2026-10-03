// The edition hour is local time, so the clock the tests run against is pinned first.
process.env.TZ = 'Europe/Copenhagen';

import assert from 'node:assert';
import { test } from 'node:test';
import {
  DAYS,
  DEFAULTS,
  HOUR,
  LOOKBACK_DAYS,
  SWITCHES,
  describeSince,
  editionTime,
  editionWindow,
  emptyDigest,
  isCurrentEdition,
  isQuiet,
  isRepoName,
  isSubscribed,
  listPhrase,
  nextEditionTime,
  pageSize,
  proseFor,
  proseText,
  sanitizeSettings,
  shapeCommits,
  shapeIssues,
  shapePulls,
  shapeReleases,
  toggleRepo,
} from '../src/lib/news.js';

test('settings are one switch, an hour on the clock, and a list of well-formed repository names', () => {
  assert.deepEqual(sanitizeSettings(), DEFAULTS, 'nothing stored means the defaults');
  assert.deepEqual(sanitizeSettings(null), DEFAULTS);
  assert.deepEqual(sanitizeSettings('junk'), DEFAULTS);
  assert.deepEqual(DEFAULTS, { enabled: 1, hour: 8, days: 1, repos: [] }, 'on, at eight, a day at a time, following nothing yet');
  assert.equal(sanitizeSettings({ enabled: '0' }).enabled, 0);
  assert.equal(sanitizeSettings({ hour: 23 }).hour, 23);
  assert.equal(sanitizeSettings({ hour: 24 }).hour, HOUR.value, 'an hour off the clock is the default');
  assert.equal(sanitizeSettings({ hour: 7.5 }).hour, HOUR.value, 'a whole hour or nothing');
  assert.equal(sanitizeSettings({ days: 7 }).days, 7, 'up to a week');
  assert.equal(sanitizeSettings({ days: '3' }).days, 3, 'a numeric string is a number');
  assert.equal(sanitizeSettings({ days: 8 }).days, DAYS.value, 'more than a week is the default');
  assert.equal(sanitizeSettings({ days: 0 }).days, DAYS.value, 'no span at all is the default');
  assert.equal(sanitizeSettings({ days: 2.5 }).days, DAYS.value, 'whole days or nothing');
  assert.equal(DAYS.max, LOOKBACK_DAYS, 'the slider stops where the catch-up does');
  assert.ok(DAYS.label && DAYS.hint && HOUR.label && HOUR.hint, 'both sliders carry their settings-page text');
  assert.deepEqual(
    sanitizeSettings({ repos: ['itk-dev/economics', ' ITK-dev/Economics ', 'not a repo', 'a/b/c', 42, 'os2display/display-api-service'] }).repos,
    ['itk-dev/economics', 'os2display/display-api-service'],
    'case is one repository, junk is dropped, trimming happens first',
  );
  assert.equal(sanitizeSettings({ repos: Array.from({ length: 40 }, (_, i) => `owner/repo-${i}`) }).repos.length, 30, 'capped');
  for (const item of SWITCHES) assert.ok(item.label && item.hint, `${item.id} carries its settings-page text`);
});

test('a repository name is an owner and a name, as GitHub allows them', () => {
  assert.ok(isRepoName('itk-dev/economics'));
  assert.ok(isRepoName('Leantime/leantime.io'));
  assert.ok(!isRepoName('economics'), 'no owner');
  assert.ok(!isRepoName('itk-dev/'), 'no name');
  assert.ok(!isRepoName('-itk/economics'), 'owners cannot start with a hyphen');
  assert.ok(!isRepoName('itk dev/economics'));
  assert.ok(!isRepoName(null));
});

test('subscribing and unsubscribing give the same list back when nothing changes', () => {
  const following = sanitizeSettings({ repos: ['itk-dev/economics'] });
  assert.ok(isSubscribed(following, 'ITK-DEV/ECONOMICS'), 'membership ignores case');
  assert.ok(!isSubscribed(following, 'itk-dev/gitchop'));
  assert.deepEqual(toggleRepo(following, 'itk-dev/gitchop', true), ['itk-dev/economics', 'itk-dev/gitchop']);
  assert.equal(toggleRepo(following, 'ITK-dev/economics', true), following.repos, 'already there: untouched');
  assert.deepEqual(toggleRepo(following, 'ITK-dev/economics', false), []);
  assert.equal(toggleRepo(following, 'itk-dev/gitchop', false), following.repos, 'not there: untouched');
  assert.throws(() => toggleRepo(following, 'nonsense', true), /owner\/repository/);
  assert.throws(() => toggleRepo({ repos: Array.from({ length: 30 }, (_, i) => `o/r${i}`) }, 'o/one-more', true), /at most 30/);
});

const at = (text) => Date.parse(text);

test('the edition is the most recent eight o’clock that has passed, local time', () => {
  assert.equal(editionTime(at('2026-09-17T09:30:00+02:00'), 8), at('2026-09-17T08:00:00+02:00'), 'past eight: today');
  assert.equal(editionTime(at('2026-09-17T07:59:00+02:00'), 8), at('2026-09-16T08:00:00+02:00'), 'before eight: yesterday');
  assert.equal(editionTime(at('2026-09-17T08:00:00+02:00'), 8), at('2026-09-17T08:00:00+02:00'), 'on the hour counts');
  assert.equal(nextEditionTime(at('2026-09-17T09:30:00+02:00'), 8), at('2026-09-18T08:00:00+02:00'), 'the alarm goes tomorrow');
  assert.equal(nextEditionTime(at('2026-09-17T07:59:00+02:00'), 8), at('2026-09-17T08:00:00+02:00'), 'or in a minute');
  assert.equal(
    nextEditionTime(at('2026-10-24T09:00:00+02:00'), 8) - editionTime(at('2026-10-24T09:00:00+02:00'), 8),
    25 * 60 * 60 * 1000,
    'across the autumn clock change the next edition is still at eight, so that day is 25 hours long',
  );
});

const now = at('2026-09-17T09:30:00+02:00');
const fresh = editionWindow(now, 8);
const monday = at('2026-09-21T09:00:00+02:00');
const friday = editionWindow(at('2026-09-18T09:00:00+02:00'), 8);
const week = editionWindow(now, 8, null, 7);

test('the window is yesterday at eight on an ordinary day, back to the previous edition after a break', () => {
  assert.deepEqual(fresh, { since: '2026-09-16T06:00:00.000Z', until: '2026-09-17T06:00:00.000Z' }, 'no previous edition: one day');

  assert.deepEqual(
    editionWindow(monday, 8, friday),
    { since: friday.until, until: '2026-09-21T06:00:00.000Z' },
    'after a weekend away, Monday reaches back to Friday',
  );
  assert.deepEqual(editionWindow(now, 8, fresh), fresh, 'asked again for the same edition, the window stays put');
  assert.deepEqual(
    editionWindow(now, 8, { since: '2026-09-15T06:00:00.000Z', until: fresh.until }),
    { since: '2026-09-15T06:00:00.000Z', until: fresh.until },
    'a same-edition refresh keeps a longer window too',
  );
  const away = editionWindow(at('2026-09-01T09:00:00+02:00'), 8);
  assert.equal(
    editionWindow(now, 8, away).since,
    new Date(at(fresh.until) - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    'a fortnight away is capped at a week',
  );
  assert.deepEqual(editionWindow(now, 8, { since: 'junk', until: 'junk' }), fresh, 'an unreadable previous edition is no edition');
  assert.deepEqual(
    editionWindow(at('2026-09-17T21:00:00+02:00'), 20, fresh),
    { since: '2026-09-16T18:00:00.000Z', until: '2026-09-17T18:00:00.000Z' },
    'moving the hour later the same day: a plain day ending at the new hour',
  );
});

test('a longer span reaches back as many days as asked, drawn afresh when the span changes', () => {
  assert.deepEqual(week, { since: '2026-09-10T06:00:00.000Z', until: fresh.until }, 'a week: the last seven days, ending at eight');
  assert.deepEqual(editionWindow(now, 8, { ...fresh, days: 1 }, 7), week, 'an edition made up for a day says nothing about a week');
  assert.deepEqual(editionWindow(now, 8, { ...week, days: 7 }, 7), week, 'asked again for the same week, the window stays put');
  assert.deepEqual(editionWindow(now, 8, { ...week, days: 7 }, 1), fresh, 'back to a day: a plain day, whatever the week covered');
  assert.deepEqual(editionWindow(now, 8, fresh, 1), fresh, 'an edition from before the span existed counts as a day');
  assert.deepEqual(
    editionWindow(monday, 8, { ...friday, days: 2 }, 2),
    { since: friday.until, until: '2026-09-21T06:00:00.000Z' },
    'two days would stop at Saturday; the weekend away still reaches back to Friday',
  );
  assert.equal(editionWindow(monday, 8, { ...friday, days: 3 }, 3).since, friday.until, 'three days is exactly Friday to Monday');
  assert.equal(editionWindow(now, 8, null, 30).since, week.since, 'more than a week is a week');
  assert.equal(editionWindow(now, 8, null, 0).since, fresh.since, 'less than a day is a day');
});

test('the edition on file is current when it is the one Settings would make up now', () => {
  const daily = sanitizeSettings({ hour: 8, days: 1 });
  const weekly = sanitizeSettings({ hour: 8, days: 7 });
  assert.ok(isCurrentEdition({ ...fresh, days: 1 }, daily, now), 'this morning, a day');
  assert.ok(isCurrentEdition(fresh, daily, now), 'an edition from before the span existed is a day');
  assert.ok(!isCurrentEdition({ ...fresh, days: 7 }, daily, now), 'a week on file when a day is asked is not current');
  assert.ok(!isCurrentEdition({ ...week, days: 7 }, daily, now));
  assert.ok(isCurrentEdition({ ...week, days: 7 }, weekly, now));
  assert.ok(!isCurrentEdition(fresh, sanitizeSettings({ hour: 20, days: 1 }), now), 'another hour is another edition');
  assert.ok(!isCurrentEdition(null, daily, now));
  assert.ok(!isCurrentEdition({ since: 'junk', until: 'junk' }, daily, now));
});

test('the page is fifty for a day, GitHub’s hundred for anything longer, clock changes notwithstanding', () => {
  assert.equal(pageSize(fresh), 50, "a day's window takes a page of fifty");
  assert.equal(pageSize(week), 100, 'a week asks for the largest page GitHub gives');
  assert.equal(pageSize(editionWindow(monday, 8, friday)), 100, 'so does a weekend away');
  assert.equal(pageSize({ since: '2026-10-24T06:00:00.000Z', until: '2026-10-25T07:00:00.000Z' }), 50, 'a 25-hour day across the clock change is still a day');
});

test('the header’s one fact says since when', () => {
  assert.equal(describeSince('2026-09-16T06:00:00.000Z', now), 'since yesterday 08:00');
  assert.equal(describeSince('2026-09-18T06:00:00.000Z', monday), 'since Friday 08:00');
  assert.equal(describeSince('2026-09-01T06:00:00.000Z', now), 'since 1 Sep 08:00');
  assert.equal(describeSince('2026-09-17T06:00:00.000Z', now), 'since 08:00', 'the same day is just the hour');
  assert.equal(describeSince(null, now), '');
  assert.equal(describeSince('garbage', now), '');
});

// Shaping: what GitHub sends, filtered to the window, cut down to what a row needs.
const window = fresh;
const inside = '2026-09-16T12:00:00Z';
const before = '2026-09-15T12:00:00Z';
const commit = (date, over = {}) => ({
  sha: 'abc',
  author: { login: 'tuj' },
  commit: { message: 'Fix the thing\n\nLonger body', author: { name: 'Thomas', date }, committer: { date } },
  ...over,
});
const commits = shapeCommits(
  [
    commit(inside, { commit: { message: 'Newest first', author: { name: 'T', date: inside }, committer: { date: inside } } }),
    commit(inside, { author: { login: 'TUJ' } }),
    commit(inside, { author: null, commit: { message: 'Unlinked', author: { name: 'Someone Else', date: inside }, committer: { date: inside } } }),
    commit(before),
  ],
  window,
  'main',
);

test('commits are filtered to the window, with who made them', () => {
  assert.equal(commits.count, 3, 'the one before the window is dropped');
  assert.deepEqual(commits.authors, ['tuj', 'Someone Else'], 'logins deduplicate without case; an unlinked commit falls back to the name');
  assert.equal(commits.branch, 'main');
  assert.equal(commits.recent.length, 3, 'every commit rides along for the popover');
  assert.deepEqual(commits.recent[0], { sha: 'abc', message: 'Newest first', author: 'tuj', url: '' }, 'the first line of the message, and who');
  assert.equal(commits.recent[2].author, 'Someone Else');
  assert.equal(commits.more, false);
  assert.equal(shapeCommits(Array.from({ length: 300 }, () => commit(inside)), window, 'main').more, true, 'three full pages: the fetch stopped before the day did');
  assert.deepEqual(shapeCommits(null, window, ''), { count: 0, authors: [], branch: '', recent: [], more: false });
});

const pr = (number, over = {}) => ({
  number,
  title: `PR ${number}`,
  html_url: `https://github.com/a/b/pull/${number}`,
  user: { login: 'tuj' },
  state: 'open',
  created_at: before,
  merged_at: null,
  closed_at: null,
  ...over,
});
const pulls = shapePulls(
  [
    pr(1, { state: 'closed', merged_at: inside, closed_at: inside, created_at: inside }),
    pr(2, { created_at: inside }),
    pr(3, { state: 'closed', closed_at: inside }),
    pr(4),
    pr(5, { state: 'closed', merged_at: before, closed_at: before }),
    { title: 'no url' },
    null,
  ],
  window,
);
const flood = shapePulls(Array.from({ length: 50 }, (_, i) => pr(i, { created_at: inside, updated_at: inside })), window);

test('pull requests are sorted into merged, opened and closed inside the window', () => {
  assert.deepEqual(pulls.merged.map((pull) => pull.number), [1], 'opened and merged inside the window shows once, as merged');
  assert.deepEqual(pulls.opened.map((pull) => pull.number), [2]);
  assert.deepEqual(pulls.closed.map((pull) => pull.number), [3], 'closed without merging');
  assert.deepEqual(pulls.merged[0], { number: 1, title: 'PR 1', url: 'https://github.com/a/b/pull/1', author: 'tuj' });
  assert.equal(pulls.more, false, 'a short page is the whole day');
  assert.equal(flood.opened.length, 50, 'nothing is cut here — the popover scrolls');
  assert.ok(flood.more, 'a full page whose oldest item still moved inside the window may have left some behind');
  assert.ok(!shapePulls(Array.from({ length: 50 }, (_, i) => pr(i, { updated_at: before })), window).more, 'a full page older than the window has shown everything');
  assert.ok(!shapePulls(Array.from({ length: 50 }, (_, i) => pr(i, { created_at: inside, updated_at: inside })), window, 100).more, 'fifty of a hundred asked for is not a full page');
  assert.ok(shapePulls(Array.from({ length: 100 }, (_, i) => pr(i, { created_at: inside, updated_at: inside })), window, 100).more, 'a hundred of a hundred is');
});

const issues = shapeIssues(
  [
    pr(10, { created_at: inside, html_url: 'https://github.com/a/b/issues/10' }),
    pr(11, { state: 'closed', closed_at: inside, html_url: 'https://github.com/a/b/issues/11' }),
    pr(12, { created_at: inside, pull_request: { url: 'x' } }),
    pr(13),
  ],
  window,
);

test('issues are opened and closed inside the window, pull requests left out', () => {
  assert.deepEqual(issues.opened.map((issue) => issue.number), [10]);
  assert.deepEqual(issues.closed.map((issue) => issue.number), [11]);
});

const releases = shapeReleases(
  [
    { tag_name: 'v2.4.0', name: 'Pull requests beside the menu', html_url: 'https://github.com/a/b/releases/tag/v2.4.0', published_at: inside, draft: false, prerelease: false },
    { tag_name: 'v2.5.0-rc1', name: '', html_url: 'https://github.com/a/b/releases/tag/v2.5.0-rc1', published_at: inside, draft: false, prerelease: true },
    { tag_name: 'v3', name: 'Draft', html_url: 'https://github.com/a/b/releases/tag/v3', published_at: null, draft: true },
    { tag_name: 'v2.3.0', name: 'Old', html_url: 'https://github.com/a/b/releases/tag/v2.3.0', published_at: before, draft: false },
  ],
  window,
);

test('drafts and old releases are out; prereleases are in and say so', () => {
  assert.deepEqual(
    releases.map((release) => [release.tag, release.prerelease]),
    [['v2.4.0', false], ['v2.5.0-rc1', true]],
    'drafts and old releases are out; prereleases are in and say so',
  );
});

// Prose: a release outranks everything, then the commits as one count, then pull requests, then issues.
const digest = { ...emptyDigest('itk-dev/economics'), commits, pulls, issues, releases };

test('a quiet day is no prose, and the menu says so', () => {
  assert.ok(!isQuiet(digest));
  assert.ok(isQuiet(emptyDigest('a/b')));
  assert.ok(isQuiet(null));
  assert.deepEqual(proseFor(emptyDigest('a/b'), window), [], 'a quiet day is no prose, and the menu says so');
});

test('the prose leads with a release, then the commits, then pull requests, then issues, each fact a chip', () => {
  const prose = proseFor(digest, window);
  assert.equal(
    proseText(prose),
    'Released v2.4.0 and v2.5.0-rc1. 3 commits to main by tuj and Someone Else. ' +
      '1 pull request merged, 1 opened and 1 closed without merging. 1 issue opened and 1 closed.',
  );
  const chips = prose.filter((segment) => segment.chip);
  assert.deepEqual(
    chips.map((segment) => [segment.text, segment.chip.kind]),
    [
      ['v2.4.0 and v2.5.0-rc1', 'release'],
      ['3 commits', 'commits'],
      ['1 pull request merged', 'pull'],
      ['1 opened', 'pull'],
      ['1 closed', 'pull'],
      ['1 issue opened', 'issue'],
      ['1 closed', 'issue'],
    ],
    'the noun rides on the first part of a clause only',
  );
  assert.equal(chips[0].chip.url, 'https://github.com/itk-dev/economics/releases', 'two releases point at the list');
  assert.deepEqual(
    chips[0].chip.items.map((item) => [item.title, item.detail]),
    [['v2.4.0 — Pull requests beside the menu', 'release'], ['v2.5.0-rc1', 'prerelease']],
  );
  assert.equal(
    chips[1].chip.url,
    `https://github.com/itk-dev/economics/commits/main?since=${encodeURIComponent(window.since)}&until=${encodeURIComponent(window.until)}`,
    'the commits chip opens GitHub’s own list, cut to the window',
  );
  assert.equal(chips[1].chip.items.length, 3, 'every commit is in the popover');
  assert.equal(chips[1].chip.more, false);
  assert.deepEqual(chips[1].chip.items[0], { title: 'Newest first', detail: 'abc · tuj', url: '' }, 'the message, then sha and who');
  assert.equal(
    chips[2].chip.url,
    `https://github.com/itk-dev/economics/pulls?q=${encodeURIComponent('is:pr is:merged merged:2026-09-16T06:00:00Z..2026-09-17T06:00:00Z')}`,
    'a search cut to the window, with the milliseconds GitHub will not take dropped',
  );
  assert.deepEqual(chips[2].chip.items, [{ title: 'PR 1', detail: '#1 · tuj', url: 'https://github.com/a/b/pull/1' }]);
  assert.match(decodeURIComponent(chips[4].chip.url), /is:pr is:closed is:unmerged closed:/, 'closed means closed without merging');
  assert.match(decodeURIComponent(chips[5].chip.url), /\/issues\?q=is:issue created:/);
  assert.match(decodeURIComponent(chips[6].chip.url), /is:issue is:closed closed:/);
});

test('a single fact reads in the singular, pointing at the thing itself', () => {
  const single = proseFor({ ...emptyDigest('a/b'), releases: [releases[0]] }, window);
  assert.equal(proseText(single), 'Released v2.4.0 — Pull requests beside the menu.', 'one release: its tag is the chip, its name follows');
  assert.equal(single[1].chip.url, 'https://github.com/a/b/releases/tag/v2.4.0', 'and it points at the release itself');
  assert.equal(proseText(proseFor({ ...emptyDigest('a/b'), releases: [releases[1]] }, window)), 'Published prerelease v2.5.0-rc1.');
  assert.equal(
    proseText(proseFor({ ...emptyDigest('a/b'), commits: { count: 1, authors: ['solo'], branch: '', recent: [] } }, window)),
    '1 commit by solo.',
    'singular, and no branch when none is known',
  );
  assert.equal(
    proseText(proseFor({ ...emptyDigest('a/b'), pulls: { merged: [], opened: [], closed: pulls.closed } }, window)),
    '1 pull request closed without merging.',
  );
  assert.equal(proseText(proseFor({ ...emptyDigest('a/b'), issues: { opened: [], closed: issues.closed } }, window)), '1 issue closed.');
});

test('a busy fact lists every one, and a cut page says there is more', () => {
  const busy = {
    ...emptyDigest('a/b'),
    pulls: { merged: Array.from({ length: 12 }, (_, i) => ({ number: i, title: `Merged ${i}`, url: `https://github.com/a/b/pull/${i}`, author: 'x' })), opened: [], closed: [] },
  };
  const [mergedChip] = proseFor(busy, window).filter((segment) => segment.chip);
  assert.equal(mergedChip.text, '12 pull requests merged');
  assert.equal(mergedChip.chip.items.length, 12, 'a busy fact lists every one; the popover scrolls');
  assert.equal(mergedChip.chip.more, false, 'and nothing points at GitHub for more, since there is no more');
  const [floodChip] = proseFor({ ...emptyDigest('a/b'), pulls: flood }, window).filter((segment) => segment.chip);
  assert.equal(floodChip.text, '50 pull requests opened');
  assert.ok(floodChip.chip.more, 'a cut page carries the flag into the popover');
});

test('names are listed as a sentence would, three at most before a count', () => {
  assert.equal(listPhrase([]), '');
  assert.equal(listPhrase(['tuj']), 'tuj');
  assert.equal(listPhrase(['tuj', 'jekuno']), 'tuj and jekuno');
  assert.equal(listPhrase(['tuj', 'jekuno', 'marcel']), 'tuj, jekuno and marcel', 'three are named, not two and one more');
  assert.equal(listPhrase(['tuj', 'jekuno', 'marcel', 'anna']), 'tuj, jekuno and 2 more');
});
