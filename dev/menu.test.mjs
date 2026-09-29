import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The menu is a classic content script; its pure parts hang off window.__gitchop once it has run.
const source = readFileSync(fileURLToPath(new URL('../src/content/menu.js', import.meta.url)), 'utf8');
const window = {};
new Function('window', 'document', 'matchMedia', 'location', source)(window, {}, () => ({ matches: false }), {});
const { orderRepos } = window.__gitchop;

const repo = (fullName, owned = true) => ({ fullName, url: `https://github.com/${fullName}`, description: '', private: false, archived: false, owned });
const names = (list) => list.map((entry) => entry.fullName);

// The rows under Repositories: the index first, then GitHub, no repeats, five at most.
const index = ['ITK-Leantime/leantime', 'ITK-Leantime/leantime-mcp', 'ITK-Leantime/leantime-timetable', 'ITK-Leantime/leantime-omnisearch', 'ITK-Leantime/leantime_databridge'].map((name) => repo(name));
assert.deepEqual(names(orderRepos('leantime', index, [repo('Leantime/leantime', false)], 5)), names(index), 'a bare word: the index fills the five slots and GitHub waits behind them');
assert.deepEqual(names(orderRepos('economics', [repo('itk-dev/economics')], [repo('ITK-DEV/economics', false), repo('someone/economics', false)], 5)), ['itk-dev/economics', 'someone/economics'], 'the same repository from both sides is one row, in the index’s casing');
assert.deepEqual(orderRepos('x', [], [], 5), []);
assert.deepEqual(orderRepos('x', undefined, undefined, 5), [], 'no results from either side is no rows');

// An exact owner/repository, from either side, is the first row whatever else matches.
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

console.log('menu ok');
