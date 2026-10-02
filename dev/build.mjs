#!/usr/bin/env node
/**
 * One manifest.json in the repo root is the source of truth; each browser gets the subset it
 * actually understands, generated here.
 *
 * The two disagree about the background script and little else:
 *   - Firefox has no extension service worker, only an event page (`background.scripts`).
 *   - Chrome has only the service worker, and before Chrome 121 it refuses to load a manifest that
 *     so much as mentions `background.scripts`.
 *
 * A single manifest carrying both keys does run on current Chrome, but leaves unrecognised-key
 * warnings in both stores' review tools, so the packages are built separately instead.
 *
 * The content script, and the stage the settings page previews it with, are bundled into each
 * package as well (dev/bundle.mjs says why), so the repository root is not an extension on its
 * own: the manifest names `content.js`, and the settings page imports `stage.js`, which only a
 * package has. Load `dist/<browser>` unpacked instead.
 *
 * Usage: node dev/build.mjs [firefox|chrome|all] [--no-zip] [--watch]
 *   --watch builds unpacked, then again whenever something under src/, icons/ or the manifest
 *   changes; reload the extension in the browser to pick it up.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { bundleAll, root, writeHarnessCopy } from './bundle.mjs';

const dist = path.join(root, 'dist');

/** Everything the browser needs, and nothing else — no dev/, no tests, no repo furniture. */
const SOURCES = ['manifest.json', 'src', 'icons'];

/** Editor, OS and tooling leftovers must not reach a store reviewer. */
const JUNK_NAMES = new Set(['.DS_Store', '.claude', 'Thumbs.db', 'desktop.ini']);
const JUNK_SUFFIXES = ['.orig', '.rej', '.bak'];

const TARGETS = {
  firefox: {
    /** AMO takes a plain zip; .xpi is the same container and is what the listing already carries. */
    extension: 'xpi',
    manifest(manifest) {
      delete manifest.background.service_worker;
      return manifest;
    },
  },

  chrome: {
    extension: 'zip',
    manifest(manifest) {
      delete manifest.background.scripts;
      // Gecko settings and Mozilla's data-collection declaration mean nothing here, and read as
      // unrecognised keys during review.
      delete manifest.browser_specific_settings;
      // The code assumes promise-returning chrome.*; permissions and runtime.sendMessage were the
      // last of the ones used here to gain it.
      manifest.minimum_chrome_version = '102';
      return manifest;
    },
  },
};

class BuildError extends Error {}

function isJunk(name) {
  return JUNK_NAMES.has(name) || JUNK_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** Relative paths of every file under `dir`, junk already dropped. */
function walk(dir, base = dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (isJunk(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full, base));
    else found.push(path.relative(base, full));
  }
  return found;
}

/** A path as esbuild's metafile spells it: relative to the repository, forward slashes. */
function repoPath(full) {
  return path.relative(root, full).split(path.sep).join('/');
}

/** The copy makes every folder it walks into, so one whose files all went into a bundle is left empty. */
function prune(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    prune(full);
    if (readdirSync(full).length === 0) rmSync(full, { recursive: true });
  }
}

/**
 * The sources as they are, less whatever reaches the browser only inside a bundle, and then the
 * bundles themselves. A module the package no longer loads is not carried along for the ride: a
 * reviewer reading the package should find exactly what runs.
 */
function stage(target, manifest, { bundles, only }) {
  const dir = path.join(dist, target);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const item of SOURCES) {
    cpSync(path.join(root, item), path.join(dir, item), {
      recursive: true,
      filter: (source) => !isJunk(path.basename(source)) && !only.has(repoPath(source)),
    });
  }

  prune(dir);

  for (const built of bundles) {
    const file = path.join(dir, built.out);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, built.text);
  }

  writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/**
 * Only part of the code goes through the bundler — the background and what it imports reach the
 * browser as they are in src/ — so a mistyped path can still be discovered only once the extension
 * is installed. These are the three ways that happens: a manifest entry, a script or stylesheet in
 * an options page, and an ES import between modules. A script that does not parse is the fourth —
 * the tests load the libraries but not the bundles — so every script is parsed here, and parsed
 * the way the browser will: a content script, or a background that is not a module, as a classic
 * script, where an `import` left in it is the error it would be on the page; everything else as a
 * module.
 */
function verify(dir, manifest) {
  const problems = [];
  const has = (relative) => existsSync(path.join(dir, relative));

  const contentScripts = (manifest.content_scripts ?? []).flatMap((script) => script.js ?? []);
  const worker = manifest.background?.service_worker;
  const scripts = manifest.background?.scripts ?? [];
  const modular = manifest.background?.type === 'module';
  const classic = new Set([...contentScripts, ...(modular ? [] : [worker, ...scripts])].filter(Boolean).map(path.normalize));

  const declared = [
    worker,
    ...scripts,
    manifest.options_ui?.page,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
    ...(manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? []),
  ].filter(Boolean);

  for (const file of declared) {
    if (!has(file)) problems.push(`manifest points at a missing file: ${file}`);
  }

  for (const file of walk(dir)) {
    const source = readFileSync(path.join(dir, file), 'utf8');
    const from = path.dirname(file);

    if (file.endsWith('.html')) {
      for (const [, attribute] of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
        if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(attribute)) continue;
        const resolved = path.normalize(path.join(from, attribute.split(/[?#]/)[0]));
        if (!has(resolved)) problems.push(`${file} references a missing file: ${attribute}`);
      }
    }

    if (file.endsWith('.js') || file.endsWith('.mjs')) {
      // The second alternative catches a bare side-effect import (import './x.js'), which has no
      // from clause for the first to anchor on.
      for (const [, named, bare] of source.matchAll(/(?:^|[\s;])(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]/gm)) {
        const specifier = named ?? bare;
        if (!specifier.startsWith('.')) continue;
        const resolved = path.normalize(path.join(from, specifier));
        if (!has(resolved)) problems.push(`${file} imports a missing module: ${specifier}`);
      }
      if (classic.has(path.normalize(file))) {
        try {
          new vm.Script(source, { filename: file });
        } catch (error) {
          problems.push(`${file} does not parse as a classic script: ${error.message}`);
        }
      } else {
        try {
          execFileSync(process.execPath, ['--input-type=module', '--check'], { input: source, stdio: ['pipe', 'ignore', 'pipe'] });
        } catch (error) {
          const said = String(error.stderr ?? '').split('\n').find((line) => /Error/.test(line)) ?? 'it does not parse';
          problems.push(`${file} does not parse: ${said.trim()}`);
        }
      }
    }
  }

  if (!worker && scripts.length === 0) problems.push('no background script declared');

  return problems;
}

function zip(dir, output) {
  rmSync(output, { force: true });
  // -X drops the extra attributes that make an archive differ between machines for no reason.
  execFileSync('zip', ['-r', '-q', '-X', output, '.'], { cwd: dir });
  return statSync(output).size;
}

function build(target, built, { archive }) {
  const spec = TARGETS[target];
  const manifest = spec.manifest(JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')));
  const dir = stage(target, manifest, built);

  const problems = verify(dir, manifest);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${target}: ${problem}`);
    throw new BuildError(`${target} package is not loadable`);
  }

  const files = walk(dir).length;
  if (!archive) {
    console.log(`${target.padEnd(8)} ${path.relative(root, dir)}/  (${files} files, not zipped)`);
    return;
  }

  const output = path.join(dist, `gitchop-${manifest.version}-${target}.${spec.extension}`);
  const size = zip(dir, output);
  console.log(`${target.padEnd(8)} ${path.relative(root, output)}  (${files} files, ${Math.round(size / 1024)} KB)`);
}

/** Bundles once for every target asked for: the output does not depend on the browser. */
async function buildAll(requested, options) {
  let built;
  try {
    built = await bundleAll();
  } catch (error) {
    console.error(String(error.message ?? error));
    throw new BuildError('the bundler refused the sources');
  }
  for (const target of requested) build(target, built, options);
  await writeHarnessCopy(built.bundles.find((spec) => spec.out === 'content.js').text);
}

const args = process.argv.slice(2);
const watching = args.includes('--watch');
const archive = !args.includes('--no-zip') && !watching;
const named = args.filter((arg) => !arg.startsWith('-'));
const requested = named.length === 0 || named.includes('all') ? Object.keys(TARGETS) : named;

for (const target of requested) {
  if (!TARGETS[target]) {
    console.error(`build: unknown target "${target}" — expected ${Object.keys(TARGETS).join(', ')} or all`);
    process.exit(1);
  }
}

mkdirSync(dist, { recursive: true });

if (!watching) {
  try {
    await buildAll(requested, { archive });
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    console.error(`build: ${error.message}`);
    process.exit(1);
  }
} else {
  // A failed build in watch mode says so and waits for the fix, rather than ending the watch.
  let timer = null;
  let running = Promise.resolve();
  const again = () => {
    running = running.then(async () => {
      try {
        await buildAll(requested, { archive: false });
      } catch (error) {
        if (!(error instanceof BuildError)) throw error;
        console.error(`build: ${error.message}`);
      }
    });
  };
  again();
  for (const item of SOURCES) {
    const full = path.join(root, item);
    const watcher = watch(full, { recursive: statSync(full).isDirectory() }, (event, name) => {
      if (name && isJunk(path.basename(String(name)))) return;
      // An editor saves in bursts; one build for the lot.
      clearTimeout(timer);
      timer = setTimeout(again, 120);
    });
    watcher.on('error', (error) => {
      console.error(`build: cannot watch ${item} (${error.code ?? error.message}); build without --watch instead`);
      process.exit(1);
    });
  }
  console.log('watching src/, icons/ and manifest.json — Ctrl-C to stop');
}
