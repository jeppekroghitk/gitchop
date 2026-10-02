import { api } from '../lib/links.js';
import { identify, tokenKind } from '../lib/gist.js';
import { ownersReachable } from '../lib/repos.js';
import { newVaultKey, seal, unseal } from '../lib/vault.js';
import { newId, readConfig, state, writeConfig } from './config.js';
import { CONTRIB_CACHE_KEY, INDEX_KEY, NEWS_CACHE_KEY, PULLS_CACHE_KEY, RATE_KEY } from './keys.js';
import { forgetRates, rememberScope } from './rate.js';

/**
 * Tokens are a list because a fine-grained token has exactly one resource owner. Two organisations
 * and a personal account means three tokens. The single-token alternative is a classic token with
 * the repo scope, which has no read-only form and so buys that convenience with write access to
 * everything the account can reach.
 */

/**
 * Tokens come out of storage only here, and go back only through storeTokens, so a plain token
 * cannot survive a write. Entries still carrying a legacy `token` field are read as-is and sealed by
 * the migration below.
 */
export async function loadTokens() {
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
    if (secret) {
      opened.push({ ...entry, secret });
      rememberScope(secret, entry);
    }
  }
  return opened;
}

export async function storeTokens(entries) {
  const config = await readConfig();
  const vaultKey = config.vaultKey ?? newVaultKey();
  const tokens = [];
  for (const entry of entries) {
    tokens.push({
      id: entry.id,
      login: entry.login ?? null,
      kind: entry.kind ?? null,
      scopes: entry.scopes ?? [],
      owners: Array.isArray(entry.owners) ? entry.owners : null,
      target: entry.target ?? null,
      expiresAt: entry.expiresAt ?? null,
      sealed: await seal(entry.secret, vaultKey),
    });
  }
  await writeConfig({ vaultKey, tokens });
}

/** The migration: any token still stored in the clear is sealed the first time the background runs. */
export async function sealLegacyTokens() {
  const config = await readConfig();
  if (config.tokens.some((entry) => typeof entry.token === 'string')) {
    await storeTokens(await loadTokens());
  }
}

export async function addToken({ token, owner }) {
  const trimmed = String(token ?? '').trim();
  if (!trimmed) throw new Error('A token is required.');

  const saved = await loadTokens();
  if (saved.some((entry) => entry.secret === trimmed)) throw new Error('That token is already saved.');

  // Only for labelling, so never let it block saving — a fine-grained token may decline /user while
  // working perfectly for repositories.
  const who = await identify(trimmed).catch(() => ({ login: null, scopes: [], kind: tokenKind(trimmed), expiresAt: null }));
  // The owner a fine-grained token speaks for shows only in the private repositories it lists. Not
  // knowing is no reason to refuse the token either; building the index asks again and fills it in.
  // Until then the owner named in the recipe stands in — GitHub has no way of asking a token whom
  // it was made for, and a token awaiting an organisation's approval lists nothing that says.
  const owners = await ownersReachable(trimmed).catch(() => null);
  const entry = {
    id: newId(),
    secret: trimmed,
    login: who.login ?? null,
    kind: who.kind ?? tokenKind(trimmed),
    scopes: who.scopes ?? [],
    owners,
    target: String(owner ?? '').trim().replace(/^@/, '') || null,
    expiresAt: who.expiresAt ?? null,
  };
  await storeTokens([...saved, entry]);
  await writeConfig({ lastError: null });
  return state();
}

export async function removeToken({ id }) {
  const config = await readConfig();
  const kept = (await loadTokens()).filter((entry) => entry.id !== id);
  await storeTokens(kept);
  const patch = {};

  if (kept.length === 0) {
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
