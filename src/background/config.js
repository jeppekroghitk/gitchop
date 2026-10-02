import { api } from '../lib/links.js';
import { scopesGrantWrite, tokenKind } from '../lib/gist.js';
import { newVaultKey } from '../lib/vault.js';
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
 *
 * A sign-in (`kind: 'app'`, at most one) also keeps the token that renews it, sealed the same way,
 * and when that runs out; `installations` is where the app is installed, null until asked, with
 * `owners` mirroring their logins so every reader of `owners` keeps working. `needsSignIn` is set
 * when GitHub refuses a renewal for good: the entry stays, so the card can say what happened, but
 * nothing uses it until the user signs in again. `signInError` is GitHub's reason, or 'lapsed',
 * 'rejected' or 'no_renewal' for the ones gitchop tells itself.
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
 *   sealedRefresh?: string,
 *   refreshExpiresAt?: string | null,
 *   installations?: import('../lib/signin.js').Installation[] | null,
 *   needsSignIn?: boolean,
 *   signInError?: string | null,
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
 * Every write of the configuration waits its turn here. Each one reads what is stored, changes it
 * and writes it back, and two of those interleaved lose whichever wrote first — harmless when it
 * was a timestamp, but a renewed sign-in rolled back to the pair it replaced is a sign-in GitHub no
 * longer accepts, since a renewal token works once. So the read, the change and the write run
 * alone, one after another, and the change works on what is stored at that moment rather than on
 * what its caller read earlier. The change may await, but sealing is best done before asking, to
 * keep the line short. A change that throws writes nothing and the next one still runs.
 * @type {Promise<unknown>}
 */
let queue = Promise.resolve();

/**
 * @param {(config: Config) => Config | Promise<Config>} mutate
 * @returns {Promise<Config>}
 */
export function updateConfig(mutate) {
  const run = queue.then(async () => {
    const next = await mutate(await readConfig());
    for (const legacy of ['token', 'tokenKind', 'scopes', 'login']) delete next[legacy];
    await api.storage.local.set({ [CONFIG_KEY]: next });
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

/**
 * Whether any saved token can still be used. A sign-in GitHub has refused stays saved, so the
 * settings page can offer to sign in again, but it is no token to work with. Whatever decides
 * what to show must not count it. Otherwise the menu keeps old lanes on screen with no hint why
 * they stopped changing.
 * @param {{ tokens?: { needsSignIn?: boolean }[] | null } | null | undefined} config
 * @returns {boolean}
 */
export function hasUsableToken(config) {
  return (config?.tokens ?? []).some((entry) => !entry?.needsSignIn);
}

/**
 * @param {Partial<Config>} patch
 * @returns {Promise<Config>}
 */
export function writeConfig(patch) {
  return updateConfig((config) => ({ ...config, ...patch }));
}

/**
 * The vault key, made the first time a secret needs sealing. It is made through the queue so two
 * first secrets saved at once cannot each make their own and leave one of them unreadable.
 * @returns {Promise<string>}
 */
export async function ensureVaultKey() {
  const config = await readConfig();
  if (config.vaultKey) return config.vaultKey;
  const next = await updateConfig((latest) => (latest.vaultKey ? latest : { ...latest, vaultKey: newVaultKey() }));
  return /** @type {string} */ (next.vaultKey);
}

/**
 * The fields of a sign-in that only the sign-in itself and the renewal write: the sealed pair, when
 * each half runs out, and whether GitHub still accepts it.
 * @typedef {Partial<Pick<TokenEntry, 'sealed' | 'sealedRefresh' | 'expiresAt' | 'refreshExpiresAt' | 'needsSignIn' | 'signInError'>>} AppPairFields
 */

/**
 * Writes those fields onto the entry with this id, as stored when the write's turn comes. With
 * `ifSealed`, only onto the pair that was sealed as that: a renewal reads the stored pair, waits on
 * GitHub, and must not then land on a newer sign-in that took the same id in the meantime. The
 * check runs in the write's own turn, so nothing can come between it and the write. Resolves to
 * whether the fields were written.
 * @param {string} id
 * @param {AppPairFields} fields
 * @param {{ ifSealed?: string }} [condition]
 * @returns {Promise<boolean>}
 */
export async function writeAppPair(id, fields, condition = {}) {
  let written = false;
  await updateConfig((config) => ({
    ...config,
    tokens: config.tokens.map((entry) => {
      if (entry.id !== id) return entry;
      if ('ifSealed' in condition && entry.sealed !== condition.ifSealed) return entry;
      written = true;
      return { ...entry, ...fields };
    }),
  }));
  return written;
}

/**
 * A saved token as the settings page is told of it: everything but the secret, and whether its
 * scopes reach further than gitchop needs.
 * A sign-in's renewal token is a secret like the token itself, and is never in it either.
 * @typedef {Omit<TokenEntry, 'sealed' | 'token' | 'sealedRefresh'> & { broad: boolean }} TokenView
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
    // Named field by field, so a secret added to the entry one day does not ride along unasked.
    tokens: config.tokens.map(({ id, login, kind, scopes, owners, target, expiresAt, refreshExpiresAt, installations, needsSignIn, signInError }) => ({
      id,
      login: login ?? null,
      kind: kind ?? null,
      scopes: scopes ?? [],
      owners: Array.isArray(owners) ? owners : null,
      target: target ?? null,
      expiresAt: expiresAt ?? null,
      refreshExpiresAt: refreshExpiresAt ?? null,
      installations: Array.isArray(installations) ? installations : null,
      needsSignIn: Boolean(needsSignIn),
      signInError: signInError ?? null,
      broad: scopesGrantWrite(scopes),
    })),
    hasToken: hasUsableToken(config),
    connected: hasUsableToken(config) && Boolean(config.gistId),
    gistId: config.gistId ?? null,
    gistUrl: config.gistId ? `https://gist.github.com/${config.gistId}` : null,
    lastPulledAt: config.lastPulledAt ?? null,
    lastPushedAt: config.lastPushedAt ?? null,
    dirty: Boolean(config.dirty),
    lastError: config.lastError ?? null,
  };
}
