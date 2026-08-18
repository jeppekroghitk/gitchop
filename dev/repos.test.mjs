import assert from 'node:assert';
import { matchIndex, ownersFromLinks } from '../src/lib/repos.js';

assert.deepEqual(
  ownersFromLinks([
    { url: 'https://github.com/itk-dev' },
    { url: 'https://github.com/os2display/display-admin-client' },
    { url: 'https://github.com/notifications' },
    { url: 'https://github.com/{repoFull}/actions' },
    { url: 'https://github.com/issues/assigned' },
    { url: 'https://github.com/ITK-dev' },
    { url: 'not a url' },
    {},
  ]),
  ['itk-dev', 'os2display'],
  'organisations and repo owners count; GitHub features, placeholders and duplicates do not',
);

assert.deepEqual(ownersFromLinks([]), []);
assert.deepEqual(ownersFromLinks(undefined), []);

assert.deepEqual(
  ownersFromLinks([{ url: 'https://www.github.com/one/x' }, { url: 'http://github.com/two' }]),
  ['one', 'two'],
  'www and http forms still resolve',
);

assert.equal(
  ownersFromLinks(Array.from({ length: 9 }, (unused, index) => ({ url: `https://github.com/org${index}` }))).length,
  5,
  'the qualifier list is capped',
);

assert.deepEqual(
  ownersFromLinks([{ url: 'https://gitlab.com/someone/thing' }]),
  [],
  'only github.com owners are favoured',
);

const index = [
  { fullName: 'itk-dev/economics', private: true },
  { fullName: 'itk-dev/economics-legacy', private: true },
  { fullName: 'someone/my-economics-fork', private: false },
  { fullName: 'itk-dev/eco', private: true },
  { fullName: 'other/unrelated', private: false },
];

assert.deepEqual(
  matchIndex(index, 'eco').map((repo) => repo.fullName),
  ['itk-dev/eco', 'itk-dev/economics', 'itk-dev/economics-legacy', 'someone/my-economics-fork'],
  'exact name first, then prefixes shortest-first, then substrings',
);

assert.deepEqual(
  matchIndex(index, 'itk-dev/economics').map((repo) => repo.fullName),
  ['itk-dev/economics', 'itk-dev/economics-legacy'],
  'a full owner/name match wins outright',
);

assert.deepEqual(matchIndex(index, 'e', 5), [], 'one character is not enough to match on');
assert.deepEqual(matchIndex(index, 'nothinghere'), []);
assert.deepEqual(matchIndex(undefined, 'eco'), [], 'no index is not an error');
assert.equal(matchIndex(index, 'eco', 2).length, 2, 'the limit is respected');

console.log('repos.js: all assertions passed');
