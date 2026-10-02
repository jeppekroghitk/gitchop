import { api } from '../lib/links.js';
import { scopesGrantWrite, tokenKind } from '../lib/gist.js';
import { CONFIG_KEY } from './keys.js';

/**
 * The configuration in storage.local — the tokens, sealed, and where the gist backup stands — and
 * what the settings page is told of it.
 */

export function now() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

export async function readConfig() {
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

export async function writeConfig(patch) {
  const next = { ...(await readConfig()), ...patch };
  for (const legacy of ['token', 'tokenKind', 'scopes', 'login']) delete next[legacy];
  await api.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

/** Everything the settings page may know — deliberately never a token itself. */
export async function state() {
  const config = await readConfig();
  return {
    tokens: config.tokens.map(({ id, login, kind, scopes, owners, target, expiresAt }) => ({
      id,
      login: login ?? null,
      kind: kind ?? null,
      scopes: scopes ?? [],
      owners: Array.isArray(owners) ? owners : null,
      target: target ?? null,
      expiresAt: expiresAt ?? null,
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
