#!/usr/bin/env node
/**
 * Serves the repository over http for the harness. The content script and the settings page's
 * stage reach the browser as bundles (dev/bundle.mjs), so the paths a package carries them at —
 * `/content.js` and `/src/options/stage.js` — and the harness's own `/dev/content.js` are bundled
 * from src/ on every request, never cached: edit, reload, and the harness runs the change, whatever
 * stale copy dev/content.js holds on disk. Everything else is the file as it is.
 * Bound to 127.0.0.1 only: that counts as a secure context, which the page's crypto.randomUUID
 * needs, and nothing else on the network gets a look at the source tree.
 *
 * Usage: node dev/serve.mjs [port] [--open]      (8765 unless told otherwise; --open opens the harness)
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { BUNDLES, HARNESS_COPY, bundle, root } from './bundle.mjs';

const args = process.argv.slice(2);
const port = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 8765);
const openBrowser = args.includes('--open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function refuse(response, status, text) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(text);
}

const server = createServer(async (request, response) => {
  let file;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    file = path.resolve(root, `.${pathname}`);
  } catch {
    return refuse(response, 400, 'Bad request');
  }
  // Nothing outside the repository, however the path is spelled.
  if (file !== root && !file.startsWith(root + path.sep)) return refuse(response, 403, 'Forbidden');

  const bundled = pathname === `/${HARNESS_COPY}` ? BUNDLES[0] : BUNDLES.find((spec) => `/${spec.out}` === pathname);
  if (bundled) {
    let text;
    try {
      ({ text } = await bundle(bundled));
    } catch (error) {
      console.error(String(error.message ?? error));
      return refuse(response, 500, `Could not bundle ${bundled.entry}:\n${error.message ?? error}`);
    }
    response.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
    return response.end(text);
  }

  let info;
  try {
    info = await stat(file);
  } catch {
    return refuse(response, 404, `Not found: ${pathname}`);
  }
  if (!info.isFile()) return refuse(response, 404, `Not found: ${pathname}`);

  // Never cached — the point is to edit, reload and see it.
  response.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  const harness = `http://127.0.0.1:${port}/dev/harness.html`;
  console.log(`harness   ${harness}`);
  console.log(`settings  ${harness}?settings`);
  if (!openBrowser) return;
  // The default browser, once the port is actually listening — so no race with the first request.
  const opener = { darwin: 'open', linux: 'xdg-open', win32: 'explorer' }[process.platform];
  if (!opener) return;
  spawn(opener, [harness], { stdio: 'ignore', detached: true }).unref();
});
