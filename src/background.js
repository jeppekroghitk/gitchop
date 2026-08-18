import { DEFAULT_LINKS, api, isSafeUrl, loadLinks, sanitize, saveLinks, withIds } from './lib/links.js';
import { createStore, identify, readStore, scopesGrantWrite, tokenKind, writeStore } from './lib/gist.js';
import { findRepos, listAccessibleRepos, matchIndex, ownersFromLinks } from './lib/repos.js';
import { newVaultKey, seal, unseal } from './lib/vault.js';

const CONFIG_KEY = 'sync';
const INDEX_KEY = 'index';
const PUSH_DELAY = 1500;
const MAX_LINKS = 200;

/**
 * The gist is the durable copy; storage.sync is the working copy the menu reads, so the menu opens
 * instantly and offline. Tokens live in storage.local — never in storage.sync, which would ship them
 * to Mozilla's servers — and every request to GitHub happens here in the background, so no page
 * context ever sees one.
 *
 * Tokens are a list because a fine-grained token has exactly one resource owner. Two organisations
 * and a personal account means three tokens. The single-token alternative is a classic token with
 * the repo scope, which has no read-only form and so buys that convenience with write access to
 * everything the account can reach.
 */
let pushTimer = null;
let inStep = null;

function now() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

async function readConfig() {
  const stored = await api.storage.local.get(CONFIG_KEY);
  const config = stored[CONFIG_KEY] ?? {};
  if (!Array.isArray(config.tokens)) {
    // Carried over from when a single token was all there was.
    config.tokens = config.token
      ? [
          {
            id: newId(),
            token: config.token,
            login: config.login ?? null,
            kind: config.tokenKind ?? tokenKind(config.token),
            scopes: config.scopes ?? [],
          },
        ]
      : [];
  }
  return config;
}

async function writeConfig(patch) {
  const next = { ...(await readConfig()), ...patch };
  for (const legacy of ['token', 'tokenKind', 'scopes', 'login']) delete next[legacy];
  await api.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

/**
 * Tokens come out of storage only here, and go back only through storeTokens, so a plain token
 * cannot survive a write. Entries still carrying a legacy `token` field are read as-is and sealed by
 * the migration below.
 */
async function loadTokens() {
  const config = await readConfig();
  const opened = [];
  for (const entry of config.tokens) {
    let secret = typeof entry.token === 'string' ? entry.token : null;
    if (entry.sealed && config.vaultKey) {
      try {
        secret = await unseal(entry.sealed, config.vaultKey);
      } catch {
        secret = null;
      }
    }
    if (secret) opened.push({ ...entry, secret });
  }
  return opened;
}

async function storeTokens(entries) {
  const config = await readConfig();
  const vaultKey = config.vaultKey ?? newVaultKey();
  const tokens = [];
  for (const entry of entries) {
    tokens.push({
      id: entry.id,
      login: entry.login ?? null,
      kind: entry.kind ?? null,
      scopes: entry.scopes ?? [],
      sealed: await seal(entry.secret, vaultKey),
    });
  }
  await writeConfig({ vaultKey, tokens });
}

/** Everything the settings page may know — deliberately never a token itself. */
async function state() {
  const config = await readConfig();
  return {
    tokens: config.tokens.map(({ id, login, kind, scopes }) => ({
      id,
      login: login ?? null,
      kind: kind ?? null,
      scopes: scopes ?? [],
      broad: scopesGrantWrite(scopes),
    })),
    hasToken: config.tokens.length > 0,
    connected: config.tokens.length > 0 && Boolean(config.gistId),
    gistId: config.gistId ?? null,
    gistUrl: config.gistId ? `https://gist.github.com/${config.gistId}` : null,
    lastPulledAt: config.lastPulledAt ?? null,
    lastPushedAt: config.lastPushedAt ?? null,
    dirty: Boolean(config.dirty),
    lastError: config.lastError ?? null,
  };
}

/**
 * Only one of the tokens will hold the Gists permission, and a fine-grained token cannot be asked
 * what it can do. So try them, remember the one that worked, and start with it next time.
 */
async function withGistToken(run) {
  const config = await readConfig();
  const tokens = await loadTokens();
  if (tokens.length === 0) throw new Error('Add a token first.');

  const preferred = config.gistTokenId;
  const ordered = [...tokens].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));

  let failure = null;
  for (const entry of ordered) {
    try {
      const result = await run(entry.secret);
      if (entry.id !== preferred) await writeConfig({ gistTokenId: entry.id });
      return result;
    } catch (error) {
      failure = error;
    }
  }
  throw failure ?? new Error('No saved token could reach the gist.');
}

/**
 * Writes the remote list locally without the change bouncing straight back as a push.
 *
 * The gist is the one input gitchop does not author. A secret gist is unlisted rather than private,
 * and an id can be adopted from anywhere, so what comes back is treated as untrusted: anything that
 * is not an http(s) URL is dropped rather than stored, and the list is capped.
 */
async function applyRemote(links) {
  const clean = links
    .filter((link) => link && typeof link === 'object')
    .map(sanitize)
    .filter((link) => isSafeUrl(link.url))
    .slice(0, MAX_LINKS);
  inStep = JSON.stringify(clean);
  await api.storage.sync.set({ links: clean });
  return clean;
}

async function push({ force = false } = {}) {
  const config = await readConfig();
  if (config.tokens.length === 0 || !config.gistId) return { skipped: true };

  const links = await loadLinks();
  const payload = JSON.stringify(links);
  if (!force && payload === inStep) {
    await writeConfig({ dirty: false });
    return { changed: false };
  }

  try {
    await withGistToken((token) => writeStore(token, config.gistId, links));
  } catch (error) {
    await writeConfig({ lastError: String(error.message ?? error) });
    throw error;
  }
  inStep = payload;
  await writeConfig({ lastPushedAt: now(), dirty: false, lastError: null });
  return { changed: true };
}

async function pull({ force = false } = {}) {
  const config = await readConfig();
  if (config.tokens.length === 0 || !config.gistId) return { skipped: true };

  // Local edits that never made it out take priority over overwriting them.
  if (config.dirty && !force) {
    await push();
    return { pushedInstead: true };
  }

  let remote;
  try {
    remote = await withGistToken((token) => readStore(token, config.gistId));
  } catch (error) {
    await writeConfig({ lastError: String(error.message ?? error) });
    throw error;
  }

  const before = JSON.stringify(await loadLinks());
  const applied = await applyRemote(remote.links);
  await writeConfig({ lastPulledAt: now(), lastError: null, dirty: false });
  return { changed: JSON.stringify(applied) !== before, count: applied.length };
}

async function addToken({ token }) {
  const trimmed = String(token ?? '').trim();
  if (!trimmed) throw new Error('A token is required.');

  const saved = await loadTokens();
  if (saved.some((entry) => entry.secret === trimmed)) throw new Error('That token is already saved.');

  // Only for labelling, so never let it block saving — a fine-grained token may decline /user while
  // working perfectly for repositories.
  const who = await identify(trimmed).catch(() => ({ login: null, scopes: [], kind: tokenKind(trimmed) }));
  const entry = {
    id: newId(),
    secret: trimmed,
    login: who.login ?? null,
    kind: who.kind ?? tokenKind(trimmed),
    scopes: who.scopes ?? [],
  };
  await storeTokens([...saved, entry]);
  await writeConfig({ lastError: null });
  return state();
}

async function removeToken({ id }) {
  const config = await readConfig();
  const kept = (await loadTokens()).filter((entry) => entry.id !== id);
  await storeTokens(kept);
  const patch = {};

  if (kept.length === 0) {
    // Nothing left to reach GitHub with, so stop claiming to sync and drop the index.
    patch.gistId = null;
    patch.gistTokenId = null;
    patch.dirty = false;
    await api.storage.local.remove(INDEX_KEY);
  } else if (config.gistTokenId === id) {
    patch.gistTokenId = null;
  }

  if (Object.keys(patch).length > 0) await writeConfig(patch);
  return state();
}

async function connectGist({ gistId }) {
  const config = await readConfig();
  if (config.tokens.length === 0) throw new Error('Add a token first.');
  const wanted = String(gistId ?? '').trim();

  let id = wanted;
  let links;
  if (id) {
    links = (await withGistToken((token) => readStore(token, id))).links;
  } else {
    const existing = await loadLinks();
    links = existing.length > 0 ? existing : withIds(DEFAULT_LINKS);
    id = (await withGistToken((token) => createStore(token, links))).id;
  }

  await applyRemote(links);
  await writeConfig({ gistId: id, lastPulledAt: now(), lastPushedAt: now(), dirty: false, lastError: null });
  return state();
}

/** Stops backing up without touching the tokens, which private repository search still needs. */
async function stopBackup() {
  await writeConfig({ gistId: null, gistTokenId: null, dirty: false, lastError: null });
  return state();
}

async function readIndex() {
  const stored = await api.storage.local.get(INDEX_KEY);
  return stored[INDEX_KEY] ?? { repos: [], builtAt: null, failures: [] };
}

/** Every token contributes, because each one can only speak for its own resource owner. */
async function buildIndex() {
  const tokens = await loadTokens();
  if (tokens.length === 0) throw new Error('Add a token first.');

  const seen = new Map();
  const failures = [];
  for (const entry of tokens) {
    try {
      for (const repo of await listAccessibleRepos(entry.secret)) {
        const key = repo.fullName.toLowerCase();
        if (seen.has(key)) continue;
        seen.set(key, {
          fullName: repo.fullName,
          url: repo.url,
          description: repo.description,
          private: repo.private,
          archived: repo.archived,
          owned: true,
        });
      }
    } catch (error) {
      failures.push(`${entry.login ?? entry.kind ?? 'token'}: ${String(error.message ?? error)}`);
    }
  }

  if (seen.size === 0 && failures.length > 0) throw new Error(failures.join(' · '));

  const index = { repos: [...seen.values()], builtAt: now(), failures };
  await api.storage.local.set({ [INDEX_KEY]: index });
  return indexState(index);
}

function indexState(index) {
  const tally = new Map();
  for (const repo of index.repos) {
    const owner = repo.fullName.slice(0, repo.fullName.indexOf('/'));
    tally.set(owner, (tally.get(owner) ?? 0) + 1);
  }
  const owners = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([owner, count]) => ({ owner, count }));

  return {
    count: index.repos.length,
    privateCount: index.repos.filter((repo) => repo.private).length,
    owners: owners.slice(0, 12),
    failures: index.failures ?? [],
    builtAt: index.builtAt,
  };
}

const HANDLERS = {
  'gitchop:options': async () => {
    await api.runtime.openOptionsPage();
    return {};
  },
  /** Instant, from the local index. No network, so the menu can call it on every settle. */
  'gitchop:repos:mine': async (message) => {
    const index = await readIndex();
    return { results: matchIndex(index.repos, message.query) };
  },
  'gitchop:repos': async (message) => {
    const [first] = await loadTokens();
    const owners = ownersFromLinks(await loadLinks());
    return { results: await findRepos(message.query, first?.secret, owners), owners };
  },
  'gitchop:index:state': async () => indexState(await readIndex()),
  'gitchop:index:build': () => buildIndex(),
  'gitchop:index:clear': async () => {
    await api.storage.local.remove(INDEX_KEY);
    return indexState({ repos: [], builtAt: null, failures: [] });
  },
  'gitchop:sync:state': () => state(),
  'gitchop:token:save': (message) => addToken(message),
  'gitchop:token:remove': (message) => removeToken(message),
  'gitchop:sync:connect': (message) => connectGist(message),
  'gitchop:sync:stop': () => stopBackup(),
  'gitchop:sync:pull': async (message) => ({ ...(await pull({ force: message.force })), ...(await state()) }),
  'gitchop:sync:push': async (message) => ({ ...(await push({ force: message.force })), ...(await state()) }),
};

api.runtime.onMessage.addListener((message, sender, respond) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message))
    .then((result) => respond({ ok: true, ...result }))
    .catch((error) => respond({ ok: false, error: String(error.message ?? error) }));
  return true;
});

api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const existing = await loadLinks();
    if (existing.length === 0) await saveLinks(withIds(DEFAULT_LINKS));
  }
  pull().catch(() => {});
});

api.runtime.onStartup?.addListener(() => {
  pull().catch(() => {});
});

api.action.onClicked.addListener(() => {
  api.runtime.openOptionsPage();
});

/**
 * Firefox hands out host permissions on request, not at install, and without them the content
 * script never runs — the "." key simply does nothing, with nothing to explain it. Badge the
 * toolbar icon so that state is visible instead of silent, and point at the page that fixes it.
 */
async function showAccess() {
  let granted = true;
  try {
    granted = await api.permissions.contains({ origins: ['https://github.com/*'] });
  } catch {
    return;
  }
  try {
    await api.action.setBadgeText({ text: granted ? '' : '!' });
    await api.action.setBadgeBackgroundColor?.({ color: '#c0473b' });
    await api.action.setTitle({
      title: granted ? 'gitchop — settings' : 'gitchop — needs access to github.com; click to fix',
    });
  } catch {
    /* older browsers may not offer badges on the action */
  }
}

(async () => {
  const config = await readConfig();
  if (config.tokens.some((entry) => typeof entry.token === 'string')) {
    await storeTokens(await loadTokens());
  }
})().catch(() => {});

api.permissions.onAdded?.addListener(() => showAccess());
api.permissions.onRemoved?.addListener(() => showAccess());
api.runtime.onStartup?.addListener(() => showAccess());
showAccess();

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.links) return;
  if (JSON.stringify(changes.links.newValue ?? []) === inStep) return;

  writeConfig({ dirty: true }).catch(() => {});
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push().catch(() => {}), PUSH_DELAY);
});
