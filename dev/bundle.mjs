#!/usr/bin/env node
/**
 * The two pieces of gitchop that reach the browser as bundles, and how they are made — shared by
 * the build, which writes them into each package, and the dev server, which makes them afresh on
 * every request so the harness always runs what is in src/.
 *
 * The content script is why there is a bundler at all. Content scripts declared in a manifest are
 * classic scripts in both browsers, so they cannot import anything; bundled, src/content is ES
 * modules like the rest of the code and shares src/lib with the background. The second bundle is
 * the content script's stage on its own, for the settings page: its Preview plays the real chop,
 * and the stage brings its stylesheet in as text, which no browser can import. Everything else —
 * the background, the rest of the settings page and src/lib — is left as it is: modules the
 * browser loads directly, as they always have been.
 *
 * Nothing is minified and there are no source maps, so what a store reviewer reads in a bundle is
 * the source, joined up. The one thing esbuild changes is names: the modules share one scope in a
 * bundle, so where a name is declared at the top of one module and anywhere in another, the later
 * one gets a number on the end (`node2`, `actions2`).
 *
 * Run on its own, it writes the content script to dev/content.js (git-ignored), which is where the
 * harness looks for it when opened straight from file://. The build writes it too, so it never
 * lags far behind src/.
 *
 * Usage: node dev/bundle.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

export const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Where each bundle lands, relative to the package root — and to the repository, for the dev server. */
export const BUNDLES = [
  { entry: 'src/content/main.js', out: 'content.js', format: 'iife' },
  { entry: 'src/content/chop.js', out: 'src/options/stage.js', format: 'esm' },
];

/** The harness's own copy of the content script, for when it is opened without the dev server. */
export const HARNESS_COPY = 'dev/content.js';

/** What the browser loads as modules straight from src/; whatever they import is carried loose. */
const LOOSE = ['src/background/index.js', 'src/options/options.js'];

/**
 * The oldest browsers the manifest admits (gecko.strict_min_version, and minimum_chrome_version in
 * the Chrome build), so nothing in the output is newer than they can parse. One output serves both
 * packages, which keeps the two reviewers looking at the same file.
 */
const TARGET = ['firefox140', 'chrome102'];

function settings(spec) {
  return {
    absWorkingDir: root,
    entryPoints: [spec.entry],
    bundle: true,
    format: spec.format,
    target: TARGET,
    charset: 'utf8',
    loader: { '.css': 'text' },
    // tsconfig.json is for the type checker alone. Left to find it, esbuild reads `strict` as
    // alwaysStrict and puts "use strict" at the head of the content script, which the sources,
    // modules with no such line, never asked for.
    tsconfigRaw: {},
    banner: { js: `// gitchop: ${spec.entry} and what it imports, bundled by dev/build.mjs. The sources are in the repository.` },
    write: false,
    metafile: true,
    logLevel: 'silent',
  };
}

/** One bundle as text, with the repository-relative paths of every file that went into it. */
export async function bundle(spec) {
  const result = await esbuild.build(settings(spec));
  return { text: result.outputFiles[0].text, inputs: Object.keys(result.metafile.inputs) };
}

/**
 * An import of a bundle's output — the settings page's `./stage.js` — is the browser's to load,
 * not something to follow into: there is no such file in src/, only in a package.
 */
const bundledElsewhere = {
  name: 'bundled-elsewhere',
  setup(build) {
    const outputs = new Set(BUNDLES.map((spec) => path.join(root, spec.out)));
    build.onResolve({ filter: /^\./ }, (args) => (outputs.has(path.join(args.resolveDir, args.path)) ? { path: args.path, external: true } : undefined));
  },
};

/**
 * Every bundle, and the files that reach the browser only inside one, which a package therefore
 * need not carry loose: each input of a bundle that no loose module also imports. Worked out from
 * the import graph rather than listed, so a module that moves between the two is packaged the
 * right way without anyone remembering to say so.
 */
export async function bundleAll() {
  const graph = await esbuild.build({
    absWorkingDir: root,
    entryPoints: LOOSE,
    bundle: true,
    format: 'esm',
    outdir: 'unused',
    write: false,
    metafile: true,
    logLevel: 'silent',
    plugins: [bundledElsewhere],
  });
  const loose = new Set(Object.keys(graph.metafile.inputs));
  const bundles = await Promise.all(BUNDLES.map(async (spec) => ({ ...spec, ...(await bundle(spec)) })));
  const only = new Set(bundles.flatMap((built) => built.inputs).filter((input) => !loose.has(input)));
  return { bundles, only };
}

/** Writes the harness's copy from an already-made content bundle, or makes one. */
export async function writeHarnessCopy(text) {
  const content = text ?? (await bundle(BUNDLES[0])).text;
  const file = path.join(root, HARNESS_COPY);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = await writeHarnessCopy();
  console.log(`harness   ${path.relative(root, file)} (open dev/harness.html from file:// now works)`);
}
