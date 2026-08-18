import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../src/content/context.js', import.meta.url)), 'utf8');

let branchInDom = '';
const sandbox = {
  window: {},
  document: { querySelector: () => (branchInDom ? { textContent: branchInDom } : null) },
  location: { pathname: '/', href: '' },
};
sandbox.window.__gitchop = undefined;

const load = new Function('window', 'document', 'location', `${source}\nreturn window.__gitchop;`);
const gc = load(sandbox.window, sandbox.document, sandbox.location);

function at(pathname, branch = '') {
  sandbox.location.pathname = pathname;
  sandbox.location.href = `https://github.com${pathname}`;
  branchInDom = branch;
  return gc.readContext();
}

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

ctx = at('/itk-dev/gitchop/issues/7');
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

assert.equal(gc.repoFromUrl('https://github.com/itk-dev/economics'), 'itk-dev/economics');
assert.equal(gc.repoFromUrl('https://github.com/itk-dev/economics/'), 'itk-dev/economics');
assert.equal(gc.repoFromUrl('https://www.github.com/a/b'), 'a/b');
assert.equal(gc.repoFromUrl('https://github.com/itk-dev'), null, 'an owner alone is not a repo');
assert.equal(gc.repoFromUrl('https://github.com/itk-dev/economics/pulls'), null, 'deeper pages are not repo roots');
assert.equal(gc.repoFromUrl('https://github.com/settings/tokens'), null, 'GitHub features are not repos');
assert.equal(gc.repoFromUrl('https://github.com/a/b?tab=readme'), null, 'a query means it is not the front page');
assert.equal(gc.repoFromUrl('https://gitlab.com/a/b'), null);
assert.equal(gc.repoFromUrl('nonsense'), null);

assert.equal(gc.isSafeUrl('https://github.com'), true);
assert.equal(gc.isSafeUrl('javascript:alert(1)'), false);
assert.equal(gc.isSafeUrl('nonsense'), false);

assert.equal(gc.shortenUrl('https://github.com/itk-dev/gitchop/actions'), 'itk-dev/gitchop/actions');
assert.equal(gc.shortenUrl('https://example.com/x/'), 'example.com/x');

console.log('context.js: all assertions passed');
