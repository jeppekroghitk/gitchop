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
 * Usage: node dev/build.mjs [firefox|chrome|all] [--no-zip]
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
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

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

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

function stage(target, manifest) {
  const dir = path.join(dist, target);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const item of SOURCES) {
    cpSync(path.join(root, item), path.join(dir, item), {
      recursive: true,
      filter: (source) => !isJunk(path.basename(source)),
    });
  }

  writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/**
 * There is no bundler between the source and the browser, so a mistyped path is only discovered
 * when the extension is already installed. These are the three ways that happens: a manifest entry,
 * a script or stylesheet in an options page, and an ES import between modules. A script that does
 * not parse is the fourth — the tests load the libraries but not the content scripts or the options
 * page — so every script is handed to node to check, module or classic alike.
 */
function verify(dir, manifest) {
  const problems = [];
  const has = (relative) => existsSync(path.join(dir, relative));

  const declared = [
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
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
      for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/gm)) {
        if (!specifier.startsWith('.')) continue;
        const resolved = path.normalize(path.join(from, specifier));
        if (!has(resolved)) problems.push(`${file} imports a missing module: ${specifier}`);
      }
      try {
        execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: ['ignore', 'ignore', 'pipe'] });
      } catch (error) {
        const said = String(error.stderr ?? '').split('\n').find((line) => /Error/.test(line)) ?? 'it does not parse';
        problems.push(`${file} does not parse: ${said.trim()}`);
      }
    }
  }

  // A module cannot import anything when the browser loads it as a classic script.
  const worker = manifest.background?.service_worker;
  const scripts = manifest.background?.scripts ?? [];
  const modular = manifest.background?.type === 'module';
  if (!modular) {
    const entry = worker ?? scripts[0];
    if (entry && /(?:^|[\s;])import\s/m.test(readFileSync(path.join(dir, entry), 'utf8'))) {
      problems.push(`${entry} uses ES imports but background.type is not "module"`);
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

function build(target, { archive }) {
  const spec = TARGETS[target];
  const manifest = spec.manifest(JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')));
  const dir = stage(target, manifest);

  const problems = verify(dir, manifest);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${target}: ${problem}`);
    fail(`${target} package is not loadable`);
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

const args = process.argv.slice(2);
const archive = !args.includes('--no-zip');
const named = args.filter((arg) => !arg.startsWith('-'));
const requested = named.length === 0 || named.includes('all') ? Object.keys(TARGETS) : named;

for (const target of requested) {
  if (!TARGETS[target]) fail(`unknown target "${target}" — expected ${Object.keys(TARGETS).join(', ')} or all`);
}

mkdirSync(dist, { recursive: true });
for (const target of requested) build(target, { archive });
