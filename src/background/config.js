import { api } from '../lib/links.js';
import { scopesGrantWrite, tokenKind } from '../lib/gist.js';
import { CONFIG_KEY } from './keys.js';

/**
 * The configuration in storage.local — the tokens, sealed, and where the gist backup stands — and
 * what the settings page is told of it.
 */

/**
 * A saved token as storage.local holds it: everything but the secret in the clear, the secret
 * sealed. `token` is the plain secret an older version stored, there only until the migration
 * seals it. `owners` is null until a listing has said whom a fine-grained token reaches; `target`
 * is the owner named in the recipe, which stands in until then.
 * @typedef {{
 *   id: string,
 *   login: string | null,
 *   kind: import('../lib/gist.js').TokenKind | null,
 *   scopes: string[],
 *   owners: string[] | null,
 *   target: string | null,
 *   expiresAt: string | null,
 *   sealed?: string,
 *   token?: string,
 * }} TokenEntry
 */

/**
 * The configuration as read: the tokens, the vault key that seals them, and where the gist
 * backup stands. The fields an older version kept for its one token are read once and dropped.
 * @typedef {{
 *   tokens: TokenEntry[],
 *   vaultKey?: string,
 *   gistId?: string | null,
 *   gistTokenId?: string | null,
 *   lastPulledAt?: string | null,
 *   lastPushedAt?: string | null,
 *   dirty?: boolean,
 *   lastError?: string | null,
 *   token?: string,
 *   tokenKind?: import('../lib/gist.js').TokenKind,
 *   scopes?: string[],
 *   login?: string | null,
 * }} Config
 */

/** @returns {string} */
export function now() {
  return new Date().toISOString();
}

/** @returns {string} */
export function newId() {
  return crypto.randomUUID();
}

/** @returns {Promise<Config>} */
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

/**
 * @param {Partial<Config>} patch
 * @returns {Promise<Config>}
 */
export async function writeConfig(patch) {
  const next = { ...(await readConfig()), ...patch };
  for (const legacy of ['token', 'tokenKind', 'scopes', 'login']) delete next[legacy];
  await api.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

/**
 * A saved token as the settings page is told of it: everything but the secret, and whether its
 * scopes reach further than gitchop needs.
 * @typedef {Omit<TokenEntry, 'sealed' | 'token'> & { broad: boolean }} TokenView
 */

/**
 * The tokens and the backup as the settings page is told of them.
 * @typedef {{
 *   tokens: TokenView[],
 *   hasToken: boolean,
 *   connected: boolean,
 *   gistId: string | null,
 *   gistUrl: string | null,
 *   lastPulledAt: string | null,
 *   lastPushedAt: string | null,
 *   dirty: boolean,
 *   lastError: string | null,
 * }} SyncState
 */

/**
 * Everything the settings page may know — deliberately never a token itself.
 * @returns {Promise<SyncState>}
 */
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
