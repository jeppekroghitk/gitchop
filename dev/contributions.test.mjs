// The year is local time, so the clock the tests run against is pinned first.
process.env.TZ = 'Europe/Copenhagen';

import assert from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULTS,
  SWITCHES,
  YEARS_BACK,
  bestOf,
  buildQuery,
  sanitizeSettings,
  shapeContributions,
  yearWindow,
  yearWindows,
} from '../src/lib/contributions.js';

test('settings are one switch, on or off, on by default', () => {
  assert.deepEqual(sanitizeSettings(), DEFAULTS, 'nothing stored means the defaults');
  assert.deepEqual(sanitizeSettings(null), DEFAULTS);
  assert.deepEqual(sanitizeSettings('junk'), DEFAULTS);
  assert.deepEqual(DEFAULTS, { enabled: 1 }, 'the number is in the menu until switched off');
  assert.equal(sanitizeSettings({ enabled: '0' }).enabled, 0);
  assert.equal(sanitizeSettings({ enabled: 7 }).enabled, 1, 'anything at or above one is on');
  assert.equal(sanitizeSettings({ enabled: {} }).enabled, 1, 'a non-number falls back to the default');
  for (const item of SWITCHES) assert.ok(item.label && item.hint, `${item.id} carries its settings-page text`);
});

const at = Date.parse('2026-09-22T10:00:00+02:00');
const thisYear = yearWindow(at);
const windows = yearWindows(at);

test('this year’s window runs from the first instant of January, local time, to now', () => {
  assert.equal(thisYear.year, 2026);
  assert.equal(thisYear.from, '2025-12-31T23:00:00.000Z', 'midnight in Copenhagen on January the 1st, which is still New Year’s Eve in UTC');
  assert.equal(thisYear.to, new Date(at).toISOString());
  assert.equal(yearWindow(Date.parse('2027-01-01T00:30:00+01:00')).year, 2027, 'half past midnight on New Year’s Day is the new year here, whatever UTC says');
  assert.equal(yearWindow(Date.parse('2026-01-01T00:00:00+01:00')).from, new Date(Date.parse('2026-01-01T00:00:00+01:00')).toISOString(), 'the window can start now');
});

test('a year that is over runs to the last instant of its December the 31st', () => {
  const lastYear = yearWindow(at, 1);
  assert.equal(lastYear.year, 2025);
  assert.equal(lastYear.from, '2024-12-31T23:00:00.000Z');
  assert.equal(lastYear.to, '2025-12-31T22:59:59.999Z', 'the instant before New Year in Copenhagen');
  assert.equal(yearWindow(at, 2).to, '2024-12-31T22:59:59.999Z', 'a leap year is still one calendar year');
});

test('the windows are this year and the three before it, newest first', () => {
  assert.equal(YEARS_BACK, 3);
  assert.deepEqual(windows.map((window) => window.year), [2026, 2025, 2024, 2023]);
  assert.deepEqual(windows[0], thisYear);
  assert.deepEqual(yearWindows(at, 0), [thisYear], 'none back is this year alone');
});

test('the query asks the viewer for one number per year, each under its own alias, plus who they are and since when', () => {
  const query = buildQuery(windows);
  assert.match(query.query, /viewer/);
  assert.match(query.query, /\blogin\b/);
  assert.match(query.query, /\bcreatedAt\b/, 'the account’s birthday says which years existed');
  for (let index = 0; index < windows.length; index += 1) {
    assert.match(query.query, new RegExp(`y${index}: contributionsCollection\\(from: \\$from${index}, to: \\$to${index}\\) \\{ contributionCalendar \\{ totalContributions \\} \\}`));
    assert.equal(query.variables[`from${index}`], windows[index].from);
    assert.equal(query.variables[`to${index}`], windows[index].to);
  }
  assert.equal(Object.keys(query.variables).length, 8, 'two variables per year, nothing else');
  assert.match(query.query, /^query\(\$from0: DateTime!, \$to0: DateTime!, \$from1/, 'every variable is declared');
});

test('the answer is shaped into this year’s total, a login, and every year that came back, newest first', () => {
  const calendar = (total) => ({ contributionCalendar: { totalContributions: total } });
  const answer = (totals, over = {}) => ({
    viewer: { login: 'jeppekrogh', createdAt: '2019-03-04T12:00:00Z', ...Object.fromEntries(totals.map((total, index) => [`y${index}`, total === undefined ? null : calendar(total)])), ...over },
  });
  const shaped = shapeContributions(answer([1234, 1802, 1540, 903]), windows);
  assert.deepEqual(shaped, {
    login: 'jeppekrogh',
    total: 1234,
    years: [
      { year: 2026, total: 1234 },
      { year: 2025, total: 1802 },
      { year: 2024, total: 1540 },
      { year: 2023, total: 903 },
    ],
  });
  assert.equal(shapeContributions(answer(['12']), windows).total, 12, 'a numeric string is a number');
  assert.equal(shapeContributions(answer([-3]), windows).total, 0, 'never below nought');
  assert.equal(shapeContributions(answer([0]), windows).total, 0, 'nought is an answer, not a failure');
  assert.equal(shapeContributions(answer([5], { login: null }), windows).login, '', 'no login is an empty string');
  assert.equal(shapeContributions(null, windows), null);
  assert.equal(shapeContributions({}, windows), null);
  assert.equal(shapeContributions({ viewer: { login: 'x' } }, windows), null, 'no calendar for this year is no answer');
  assert.equal(shapeContributions(answer(['lots']), windows), null, 'a count that is not a number is no answer');
  assert.deepEqual(
    shapeContributions(answer([1234, undefined, 1540, 903]), windows).years.map((entry) => entry.year),
    [2026, 2024, 2023],
    'a past year GitHub refused is left out, not counted as nought',
  );
  assert.deepEqual(
    shapeContributions(answer([1234, 1802, 1540, 903], { createdAt: '2024-11-30T00:00:00Z' }), windows).years.map((entry) => entry.year),
    [2026, 2025, 2024],
    'years before the account existed are left out; the year it was made in stays',
  );
  assert.equal(shapeContributions(answer([7, 8], { createdAt: 'garbage' }), windows).years.length, 2, 'an unreadable birthday cuts nothing');
  assert.deepEqual(shapeContributions(answer([7]), undefined).years, [], 'no windows means no years, and the total still stands');
  assert.equal(shapeContributions(answer([7]), undefined).total, 7);
});

test('the highest count for this year wins, and brings its past years with it', () => {
  assert.deepEqual(
    bestOf([{ login: 'a', total: 10, years: [] }, null, { login: 'a', total: 42, years: [{ year: 2026, total: 42 }] }, { login: 'a', total: 7, years: [] }]),
    { login: 'a', total: 42, years: [{ year: 2026, total: 42 }] },
  );
  assert.deepEqual(bestOf([{ login: 'a', total: 0, years: [] }]), { login: 'a', total: 0, years: [] }, 'a single nought is still the answer');
  assert.equal(bestOf([]), null);
  assert.equal(bestOf([null, undefined]), null);
  assert.equal(bestOf(), null);
});
