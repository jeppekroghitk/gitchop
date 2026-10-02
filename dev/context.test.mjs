import assert from 'node:assert';
import { test } from 'node:test';
import * as gc from '../src/content/context.js';
import { isSafeUrl } from '../src/lib/links.js';

// The page is read when the context is, not when the module loads, so these stand in for it.
let branchInDom = '';
globalThis.document = { querySelector: () => (branchInDom ? { textContent: branchInDom } : null) };
globalThis.location = { pathname: '/', href: '' };

function at(pathname, branch = '') {
  globalThis.location.pathname = pathname;
  globalThis.location.href = `https://github.com${pathname}`;
  branchInDom = branch;
  return gc.readContext();
}

test('the context is read off the page: owner, repository, branch, path and number', () => {
  let ctx = at('/itk-dev/gitchop');
  assert.equal(ctx.owner, 'itk-dev');
  assert.equal(ctx.repoFull, 'itk-dev/gitchop');
  assert.equal(ctx.branch, '');

  ctx = at('/itk-dev/gitchop/blob/main/src/content/main.js', 'main');
  assert.equal(ctx.branch, 'main');
  assert.equal(ctx.path, 'src/content/main.js');

  ctx = at('/itk-dev/gitchop/tree/feature/chop-it/src', 'feature/chop-it');
  assert.equal(ctx.branch, 'feature/chop-it');
  assert.equal(ctx.path, 'src');

  ctx = at('/itk-dev/gitchop/blob/main/README.md');
  assert.equal(ctx.branch, 'main', 'falls back to the path segment with no DOM hint');
  assert.equal(ctx.path, 'README.md');

  ctx = at('/itk-dev/gitchop/pull/42/files', 'main');
  assert.equal(ctx.number, '42');

  ctx = at('/notifications');
  assert.equal(ctx.owner, '', 'GitHub feature pages have no owner');
  assert.equal(ctx.repoFull, '');
});

test('placeholders in a link resolve from the context, and say which could not', () => {
  let ctx = at('/itk-dev/gitchop/issues/7');
  assert.deepEqual(
    gc.resolveUrl('https://github.com/{repoFull}/issues/{number}', ctx),
    { url: 'https://github.com/itk-dev/gitchop/issues/7', missing: [] },
  );

  ctx = at('/notifications');
  const unresolved = gc.resolveUrl('https://github.com/{repoFull}/actions', ctx);
  assert.deepEqual(unresolved.missing, ['repoFull']);
  assert.equal(unresolved.url, 'https://github.com/{repoFull}/actions');

  ctx = at('/itk-dev/gitchop/tree/feat/a b', 'feat/a b');
  assert.equal(
    gc.resolveUrl('https://github.com/{repoFull}/commits/{branch}', ctx).url,
    'https://github.com/itk-dev/gitchop/commits/feat/a%20b',
    'slashes survive, spaces get encoded',
  );
});

test('only a repository’s front page is a repository', () => {
  assert.equal(gc.repoFromUrl('https://github.com/itk-dev/economics'), 'itk-dev/economics');
  assert.equal(gc.repoFromUrl('https://github.com/itk-dev/economics/'), 'itk-dev/economics');
  assert.equal(gc.repoFromUrl('https://www.github.com/a/b'), 'a/b');
  assert.equal(gc.repoFromUrl('https://github.com/itk-dev'), null, 'an owner alone is not a repo');
  assert.equal(gc.repoFromUrl('https://github.com/itk-dev/economics/pulls'), null, 'deeper pages are not repo roots');
  assert.equal(gc.repoFromUrl('https://github.com/settings/tokens'), null, 'GitHub features are not repos');
  assert.equal(gc.repoFromUrl('https://github.com/a/b?tab=readme'), null, 'a query means it is not the front page');
  assert.equal(gc.repoFromUrl('https://gitlab.com/a/b'), null);
  assert.equal(gc.repoFromUrl('nonsense'), null);
});

// The menu's gate on every address it opens is the one the links are stored by.
test('the menu gates every address it opens as the links are stored', () => {
  assert.equal(isSafeUrl('https://github.com'), true);
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUrl('nonsense'), false);
});

test('addresses are shortened for display', () => {
  assert.equal(gc.shortenUrl('https://github.com/itk-dev/gitchop/actions'), 'itk-dev/gitchop/actions');
  assert.equal(gc.shortenUrl('https://example.com/x/'), 'example.com/x');
});
