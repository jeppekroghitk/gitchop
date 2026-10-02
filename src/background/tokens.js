import { api } from '../lib/links.js';
import { identify, tokenKind } from '../lib/gist.js';
import { ownersReachable } from '../lib/repos.js';
import { newVaultKey, seal, unseal } from '../lib/vault.js';
import { forgetRenewal, freshAppSecret, flushUnsaved } from './app-token.js';
import { ensureVaultKey, newId, readConfig, state, updateConfig, writeConfig } from './config.js';
import { CONTRIB_CACHE_KEY, INDEX_KEY, NEWS_CACHE_KEY, PULLS_CACHE_KEY, RATE_KEY } from './keys.js';
import { forgetRates, rememberScope } from './rate.js';
import { endSignIn } from './signin-session.js';

/** @import { Config, TokenEntry } from './config.js' */

/**
 * A token opened for use: the stored entry with its secret beside it. It never leaves the background.
 * @typedef {TokenEntry & { secret: string }} OpenToken
 */

/**
 * Tokens are a list because a fine-grained token has exactly one resource owner. Two organisations
 * and a personal account means three tokens. The single-token alternative is a classic token with
 * the repo scope, which has no read-only form and so buys that convenience with write access to
 * everything the account can reach. Signing in with GitHub is a token in this list too, beside any
 * of those: it reaches the accounts where gitchop's app is installed.
 */

/**
 * The tokens usable for a request, opened. Tokens come out of storage only here, and go back only
 * through updateTokens, so a plain token cannot survive a write. Entries still carrying a legacy
 * `token` field are read as-is and sealed by the migration below. A sign-in GitHub no longer
 * accepts is left out, and one close to running out is renewed on the way, so no caller has to
 * know a sign-in from any other token.
 * @returns {Promise<OpenToken[]>}
 */
export async function loadTokens() {
  await flushUnsaved();
  const config = await readConfig();
  /** @type {OpenToken[]} */
  const opened = [];
  for (const entry of config.tokens) {
    if (entry.needsSignIn) continue;
    let secret = typeof entry.token === 'string' ? entry.token : null;
    if (entry.sealed && config.vaultKey) {
      try {
        secret = await unseal(entry.sealed, config.vaultKey);
      } catch {
        secret = null;
      }
    }
    if (secret && entry.kind === 'app') secret = await freshAppSecret(entry, secret);
    if (secret) {
      opened.push({ ...entry, secret });
      rememberScope(secret, entry);
    }
  }
  return opened;
}

/** The fields of a sign-in that belong to the renewal, never to a caller's patch. */
const PAIR_FIELDS = /** @type {const} */ (['sealed', 'sealedRefresh', 'expiresAt', 'refreshExpiresAt', 'needsSignIn', 'signInError']);

/**
 * Changes the stored list, as stored when the change's turn comes. Callers hand over a change by
 * id — add this, drop that, patch these fields — never a list they loaded earlier, which could be
 * minutes old by the time it lands: an index build lists repositories for that long. A sign-in's
 * pair is carried over from what is stored, whatever the change says, since only the renewal and
 * the sign-in write it, and a pair rolled back is a sign-in GitHub no longer accepts.
 * @param {(stored: TokenEntry[]) => TokenEntry[]} mutate
 * @returns {Promise<Config>}
 */
export function updateTokens(mutate) {
  return updateConfig((config) => {
    const stored = config.tokens;
    const next = mutate(stored).map((entry) => {
      if (entry.kind !== 'app') return entry;
      const live = stored.find((candidate) => candidate.id === entry.id);
      if (!live) return entry;
      /** @type {TokenEntry} */
      const kept = { ...entry };
      for (const field of PAIR_FIELDS) {
        if (field in live) Object.assign(kept, { [field]: live[field] });
        else delete kept[field];
      }
      return kept;
    });
    return { ...config, vaultKey: config.vaultKey ?? newVaultKey(), tokens: next };
  });
}

/**
 * An entry with every field a reader expects, from whatever an older version stored.
 * @param {TokenEntry} entry
 * @returns {TokenEntry}
 */
function tidy(entry) {
  return {
    ...entry,
    login: entry.login ?? null,
    kind: entry.kind ?? null,
    scopes: entry.scopes ?? [],
    owners: Array.isArray(entry.owners) ? entry.owners : null,
    target: entry.target ?? null,
    expiresAt: entry.expiresAt ?? null,
  };
}

/**
 * The migration: any token still stored in the clear is sealed the first time the background runs.
 * It seals inside its turn in the queue, which is the exception: it happens once, and an older
 * version's single token is given a fresh id on every read until it is written, so only what is
 * stored at the moment of writing can be matched up.
 */
export async function sealLegacyTokens() {
  const config = await readConfig();
  if (!config.tokens.some((entry) => typeof entry.token === 'string')) return;
  await updateConfig(async (latest) => {
    const vaultKey = latest.vaultKey ?? newVaultKey();
    /** @type {TokenEntry[]} */
    const tokens = [];
    for (const entry of latest.tokens) {
      if (typeof entry.token !== 'string') {
        tokens.push(entry);
        continue;
      }
      const { token, ...rest } = entry;
      tokens.push({ ...tidy(rest), sealed: await seal(token, vaultKey) });
    }
    return { ...latest, vaultKey, tokens };
  });
}

/** @param {{ token: string, owner?: string }} request */
export async function addToken({ token, owner }) {
  const trimmed = String(token ?? '').trim();
  if (!trimmed) throw new Error('A token is required.');
  // A sign-in's token pasted by hand has no renewal token beside it, and would stop working within
  // eight hours without saying why.
  if (tokenKind(trimmed) === 'app') throw new Error('That is a sign-in token. Use Sign in with GitHub instead.');

  const saved = await loadTokens();
  if (saved.some((entry) => entry.secret === trimmed)) throw new Error('That token is already saved.');

  // Only for labelling, so never let it block saving — a fine-grained token may decline /user while
  // working perfectly for repositories.
  /** @type {import('../lib/gist.js').Identity} */
  const who = await identify(trimmed).catch(() => ({ login: null, scopes: [], kind: tokenKind(trimmed), expiresAt: null }));
  // The owner a fine-grained token speaks for shows only in the private repositories it lists. Not
  // knowing is no reason to refuse the token either; building the index asks again and fills it in.
  // Until then the owner named in the recipe stands in — GitHub has no way of asking a token whom
  // it was made for, and a token awaiting an organisation's approval lists nothing that says.
  const owners = await ownersReachable(trimmed).catch(() => null);
  const vaultKey = await ensureVaultKey();
  /** @type {TokenEntry} */
  const entry = {
    id: newId(),
    login: who.login ?? null,
    kind: who.kind ?? tokenKind(trimmed),
    scopes: who.scopes ?? [],
    owners,
    target: String(owner ?? '').trim().replace(/^@/, '') || null,
    expiresAt: who.expiresAt ?? null,
    sealed: await seal(trimmed, vaultKey),
  };
  await updateTokens((list) => [...list, entry]);
  await writeConfig({ lastError: null });
  return state();
}

/**
 * Removing a token — a sign-out, for the sign-in — forgets what it alone made possible. The count
 * that decides "nothing left" is what is stored, so a sign-in GitHub no longer accepts still counts
 * until it is removed: the user is one sign-in away from it working again, and the backup and the
 * caches should still be there when it does.
 * @param {{ id: string }} request
 */
export async function removeToken({ id }) {
  const before = await readConfig();
  const removed = before.tokens.find((entry) => entry.id === id);
  // Signing out leaves nothing of the sign-in behind: not a renewal still waiting to be written,
  // and not a code still waiting for approval, which approved later would quietly sign the user
  // back in. Called off before the entry goes, so a poll answered meanwhile cannot put it back.
  if (removed?.kind === 'app') {
    forgetRenewal();
    await endSignIn();
  }
  const config = await updateTokens((list) => list.filter((entry) => entry.id !== id));
  /** @type {Partial<Config>} */
  const patch = {};

  if (config.tokens.length === 0) {
    // Nothing left to reach GitHub with, so stop claiming to sync and drop the index. The edition
    // and the year's count go too: what a token saw of a private repository should not outlive it.
    patch.gistId = null;
    patch.gistTokenId = null;
    patch.dirty = false;
    await api.storage.local.remove([INDEX_KEY, PULLS_CACHE_KEY, NEWS_CACHE_KEY, CONTRIB_CACHE_KEY, RATE_KEY]);
    forgetRates();
  } else if (config.gistTokenId === id) {
    patch.gistTokenId = null;
  }

  if (Object.keys(patch).length > 0) await writeConfig(patch);
  return state();
}
