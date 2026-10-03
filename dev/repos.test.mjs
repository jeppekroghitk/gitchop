import assert from 'node:assert';
import { test } from 'node:test';
import { matchIndex, ownersFromLinks, pickSearchToken, privateOwnersOf, queryOwner, rankForOwner, reaches } from '../src/lib/repos.js';
import { tokenLabel } from '../src/lib/gist.js';

test('the owners to favour are read off the links', () => {
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
});

test('the index is matched exact name first, then prefixes shortest-first, then substrings', () => {
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
});

test('the owners of private repositories come first seen first, once each', () => {
  assert.deepEqual(
    privateOwnersOf([
      { fullName: 'itk-dev/economics', private: true },
      { fullName: 'ITK-dev/eco', private: true },
      { fullName: 'os2display/client', private: true },
      { fullName: 'os2forms/public-thing', private: false },
      { fullName: 'bare', private: true },
      {},
    ]),
    ['itk-dev', 'os2display'],
    'owners come first seen first, once each whatever the casing; public repositories and a name without a slash say nothing',
  );
  assert.deepEqual(
    privateOwnersOf([{ fullName: 'itk-dev/a', private: false }, { fullName: 'os2display/b', private: false }]),
    [],
    'a token awaiting approval lists only public repositories, which names no owner',
  );
  assert.deepEqual(privateOwnersOf([]), []);
  assert.deepEqual(privateOwnersOf(undefined), []);
});

test('a token is named for the owner it reaches, or the account it belongs to', () => {
  assert.equal(tokenLabel({ login: 'me', kind: 'fine-grained', owners: ['itk-dev'] }), '@itk-dev', 'a fine-grained token is named for the owner it reaches');
  assert.equal(tokenLabel({ login: 'me', kind: 'classic', owners: ['me', 'itk-dev'] }), '@me', 'a classic token is the account’s whatever it reaches');
  assert.equal(tokenLabel({ login: 'me', kind: 'fine-grained', owners: [] }), '@me', 'reaching nothing falls back to who made it');
  assert.equal(tokenLabel({ login: 'me', kind: 'fine-grained', owners: null }), '@me', 'so does not knowing');
  assert.equal(tokenLabel({ login: 'me', kind: 'fine-grained', owners: [], target: 'itk-dev' }), '@itk-dev', 'reaching nothing yet, it is named for the owner it was made for');
  assert.equal(tokenLabel({ login: 'me', kind: 'fine-grained', owners: null, target: 'itk-dev' }), '@itk-dev');
  assert.equal(tokenLabel({ login: 'me', kind: 'fine-grained', owners: ['os2display'], target: 'itk-dev' }), '@os2display', 'what it reaches beats what it was made for');
  assert.equal(tokenLabel({ login: 'me', kind: 'classic', owners: [], target: 'itk-dev' }), '@me', 'a classic token is the account’s, whatever the recipe said');
  assert.equal(tokenLabel({ login: null, kind: 'fine-grained', owners: null }), 'fine-grained');
  assert.equal(tokenLabel({ login: null, kind: null }), 'token');
});

test('a sign-in is named for the account, not for where the app is installed', () => {
  assert.equal(tokenLabel({ kind: 'app', login: 'me', owners: ['itk-dev'] }), '@me');
  assert.equal(tokenLabel({ kind: 'app', login: 'me', owners: [], target: 'itk-dev' }), '@me', 'a target means nothing to a sign-in');
});

const classic = { id: 'classic', kind: 'classic', owners: null, target: null };
const fine = { id: 'fine', kind: 'fine-grained', owners: ['itk-dev'], target: null };
const fineUnlisted = { id: 'fine-target', kind: 'fine-grained', owners: null, target: 'os2display' };
const app = { id: 'app', kind: 'app', owners: ['me', 'itk-dev'], installations: [{ owner: 'me' }, { owner: 'ITK-dev' }] };
const appElsewhere = { id: 'app', kind: 'app', owners: ['me'], installations: [{ owner: 'me' }] };

test('what each kind of token reaches', () => {
  assert.equal(reaches(classic, 'anyone'), true, 'a classic token reaches everything the account does');
  assert.equal(reaches(app, 'itk-dev'), true, 'a sign-in reaches where the app is installed, whatever the casing');
  assert.equal(reaches(app, 'os2display'), false, 'and nowhere else');
  assert.equal(reaches({ kind: 'app', installations: null }, 'me'), false, 'not knowing where it is installed is not reaching');
  assert.equal(reaches(fine, 'ITK-DEV'), true, 'a fine-grained token reaches the owner it listed');
  assert.equal(reaches(fine, 'os2display'), false);
  assert.equal(reaches(fineUnlisted, 'os2display'), true, 'until it lists one, the owner it was made for stands in');
  assert.equal(reaches({ kind: 'fine-grained', owners: ['itk-dev'], target: 'os2display' }, 'os2display'), false, 'what it lists beats what it was made for');
  assert.equal(reaches(classic, ''), false, 'no owner is reached by nobody');
});

test('a search names an owner by owner/name or by a github.com address', () => {
  assert.equal(queryOwner('itk-dev/economics'), 'itk-dev');
  assert.equal(queryOwner('  https://github.com/itk-dev/economics/  '), 'itk-dev');
  assert.equal(queryOwner('https://github.com/itk-dev/economics/pull/12'), 'itk-dev', 'deeper in a repository still names its owner');
  assert.equal(queryOwner('https://github.com/itk-dev'), 'itk-dev', 'an account page names the account');
  assert.equal(queryOwner('https://github.com/settings/tokens'), null, 'a page of GitHub’s own names nobody');
  assert.equal(queryOwner('economics'), null, 'a bare word names nobody');
  assert.equal(queryOwner(''), null);
});

test('the tokens for an owner come narrowest first, then the rest as saved', () => {
  const tokens = [classic, fine, app];
  assert.deepEqual(rankForOwner(tokens, 'itk-dev').map((entry) => entry.id), ['app', 'fine', 'classic'], 'the app installed there, then the token made for it, then the classic one');
  assert.deepEqual(rankForOwner([classic, fine, appElsewhere], 'itk-dev').map((entry) => entry.id), ['fine', 'classic', 'app'], 'an app not installed on the owner falls behind those that reach it');
  assert.deepEqual(rankForOwner([fineUnlisted, appElsewhere], 'someone').map((entry) => entry.id), ['fine-target', 'app'], 'reaching nobody, they stay as saved');
  assert.deepEqual(rankForOwner(tokens, null).map((entry) => entry.id), ['classic', 'fine', 'app'], 'no owner, no reordering');
});

test('a search goes with the widest reach into what it names, or the widest reach overall', () => {
  assert.equal(pickSearchToken([app, fine, classic], 'economics')?.id, 'classic', 'a bare word goes with the classic token');
  assert.equal(pickSearchToken([fine, app], 'economics')?.id, 'app', 'without one, with the sign-in');
  assert.equal(pickSearchToken([fine, fineUnlisted], 'economics')?.id, 'fine', 'without either, with the first saved');
  assert.equal(pickSearchToken([fine, appElsewhere], 'itk-dev/economics')?.id, 'fine', 'a named owner goes with the token that reaches it');
  assert.equal(pickSearchToken([classic, app], 'https://github.com/itk-dev/economics')?.id, 'classic', 'the classic token before the sign-in where both reach');
  assert.equal(pickSearchToken([fine, app], 'itk-dev/economics')?.id, 'app', 'an installation on all repositories before a fine-grained token');
  assert.equal(pickSearchToken([appElsewhere, fineUnlisted], 'someone/economics')?.id, 'app', 'reaching nobody, the first saved');
  assert.equal(pickSearchToken([], 'economics'), null, 'no tokens, no token');
});

test('an installation on selected repositories does not shrink a search a classic or fine-grained token could make', () => {
  // Searching with only the sign-in would leave out every repository outside its selection that
  // the other token can see, and GitHub would say nothing of them.
  const selected = { id: 'selected', kind: 'app', owners: ['itk-dev'], installations: [{ owner: 'itk-dev', selection: 'selected' }] };
  assert.equal(pickSearchToken([selected, classic], 'itk-dev/secret')?.id, 'classic');
  assert.equal(pickSearchToken([selected, fine], 'itk-dev/secret')?.id, 'fine');
  assert.equal(pickSearchToken([selected], 'itk-dev/secret')?.id, 'selected', 'alone, it is still the one that reaches');
  assert.deepEqual(rankForOwner([classic, selected], 'itk-dev').map((entry) => entry.id), ['selected', 'classic'], 'the news still tries it first, and falls through on a 404');
});

test('with tokens alone, a bare word goes with the classic token even when a fine-grained one was saved first', () => {
  // A deliberate change from searching with whatever was saved first: the classic token sees every
  // repository the fine-grained one does, and more.
  assert.equal(pickSearchToken([fine, classic], 'economics')?.id, 'classic');
  assert.equal(pickSearchToken([fine, classic], 'itk-dev/economics')?.id, 'classic', 'a named owner too, since the fine-grained one may have been made for a few repositories');
  assert.deepEqual(rankForOwner([classic, fine], 'itk-dev').map((entry) => entry.id), ['fine', 'classic'], 'while the news tries the fine-grained one first, and falls through on a 404');
});
