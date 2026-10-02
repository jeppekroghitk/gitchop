import { REFRESH_MARGIN, refreshPair } from '../lib/signin.js';
import { seal, unseal } from '../lib/vault.js';
import { readConfig, writeAppPair } from './config.js';
import { rememberScope } from './rate.js';

/** @import { AppPairFields, TokenEntry } from './config.js' */

/**
 * Keeping a sign-in alive. Its access token lasts eight hours and is renewed with a renewal token
 * that works exactly once: spending it ends both it and the access token it came with, and the new
 * pair is the only one there is. So everything here follows from never spending a renewal token
 * twice and never losing the pair it buys.
 *
 * - One renewal at a time, in this background only. Every caller that finds the token due, or
 *   rejected, waits on the same one.
 * - The new pair is sealed and written to storage before any request is handed the new token, so
 *   a background stopped right after can only lose the moment between GitHub's answer and the
 *   write, which is the few milliseconds sealing takes.
 * - A renewal GitHub refuses marks the sign-in as needing a new one rather than deleting it; a
 *   renewal GitHub could not be asked about, or did not give a verdict on, marks nothing.
 * - Whatever a renewal writes lands only on the pair it renewed. A new sign-in can take the same
 *   id while GitHub is being asked, and what GitHub then says about the old pair is not about it.
 *
 * This module does not import the token store: the store imports it, to renew as it opens tokens.
 */

/**
 * Every access token this background has handed out for the sign-in since it started: the one in
 * use and those it replaced. A 401 on any of them is a sign-in to renew; one on a token gitchop did
 * not issue is someone else's business. A 401 on one already replaced finds the stored token
 * different and is handed that, with nothing spent.
 * @type {Set<string>}
 */
const appSecrets = new Set();

/** @type {Promise<string | null> | null} */
let inflight = null;

/**
 * A pair GitHub handed over that could not be written. The old pair is already dead on GitHub, so
 * this is the sign-in now; it is written again before the next use, and stands in until it is.
 * `basis` is the sealed token it was renewed from: it stands in only for that pair, so a new
 * sign-in stored in the meantime is never covered by, or overwritten with, the old one's renewal.
 * @type {{ id: string, basis: string, fields: AppPairFields, access: string, refresh: string } | null}
 */
let unsaved = null;

/**
 * Whether a bearer token is the sign-in's.
 * @param {string} secret
 */
export function isAppSecret(secret) {
  return appSecrets.has(secret);
}

/**
 * Called wherever the sign-in's token is opened, so a 401 on it is known for what it is.
 * @param {string} secret
 */
export function noteAppSecret(secret) {
  appSecrets.add(secret);
}

/**
 * Writes a pair that could not be written before, onto the pair it was renewed from only. Says
 * whether anything is still unwritten.
 */
export async function flushUnsaved() {
  if (!unsaved) return false;
  const pending = unsaved;
  try {
    await writeAppPair(pending.id, pending.fields, { ifSealed: pending.basis });
    // Written, or not wanted any more: the pair it renewed was replaced by a new sign-in or removed.
    if (unsaved === pending) unsaved = null;
  } catch {
    /* still unwritten; it stands in for the stored pair until a write lands */
  }
  return unsaved !== null;
}

/**
 * Forgets a renewal that could not be written. A new sign-in and a sign-out each make the pair it
 * renewed history, and nothing of that pair should come back over what replaced it.
 */
export function forgetRenewal() {
  unsaved = null;
}

/**
 * The sign-in's entry as it stands: what is stored, or the pair that could not be written over it.
 * @param {TokenEntry} entry
 * @param {string} secret
 */
function overlay(entry, secret) {
  if (unsaved && unsaved.id === entry.id && unsaved.basis === entry.sealed) {
    return { secret: unsaved.access, expiresAt: unsaved.fields.expiresAt ?? entry.expiresAt };
  }
  return { secret, expiresAt: entry.expiresAt };
}

/**
 * Marks the sign-in as needing a new one, if it is still the pair sealed as `basis`: a refusal of
 * an old sign-in's renewal says nothing about the sign-in that replaced it.
 * @param {string} id
 * @param {string} basis
 * @param {string} reason
 */
export async function markNeedsSignIn(id, basis, reason) {
  if (unsaved?.id === id && unsaved.basis === basis) unsaved = null;
  await writeAppPair(id, { needsSignIn: true, signInError: reason }, { ifSealed: basis });
}

/**
 * The sign-in's access token as stored now, for a renewal that lost to a newer sign-in.
 * @returns {Promise<string | null>}
 */
async function storedSecret() {
  const config = await readConfig();
  const entry = config.tokens.find((candidate) => candidate.kind === 'app');
  if (!entry || entry.needsSignIn || !config.vaultKey || !entry.sealed) return null;
  const secret = overlay(entry, await unseal(entry.sealed, config.vaultKey)).secret;
  appSecrets.add(secret);
  return secret;
}

/**
 * The token to use for the sign-in, just opened: as it is while it has more than a few minutes
 * left, and renewed once it has not. A renewal that does not happen leaves the old token in use
 * while it still works — GitHub out of reach for a moment is no reason to stop — and leaves the
 * sign-in out of this round once it has run out.
 * @param {TokenEntry} entry
 * @param {string} secret
 * @returns {Promise<string | null>}
 */
export async function freshAppSecret(entry, secret) {
  const current = overlay(entry, secret);
  appSecrets.add(current.secret);
  // A sign-in from an app whose tokens do not expire carries no expiry, and needs no renewal.
  if (!current.expiresAt) return current.secret;
  const left = Date.parse(current.expiresAt) - Date.now();
  if (left > REFRESH_MARGIN) return current.secret;
  const next = await refreshAppToken().catch(() => null);
  if (next && next !== current.secret) return next;
  return left > 0 ? current.secret : null;
}

/**
 * Renews the sign-in, once, however many ask. `rejected` is the token a request was just refused
 * with: if the stored token is already another, someone renewed it in the meantime and that one is
 * the answer, with nothing spent. Without `rejected`, the renewal happens only when the token is
 * due. Resolves to the token to use, or null when there is none.
 * @param {{ rejected?: string | null }} [options]
 * @returns {Promise<string | null>}
 */
export function refreshAppToken({ rejected = null } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    await flushUnsaved();
    const config = await readConfig();
    const entry = config.tokens.find((candidate) => candidate.kind === 'app');
    if (!entry || entry.needsSignIn || !config.vaultKey || !entry.sealed) return null;
    const stored = overlay(entry, await unseal(entry.sealed, config.vaultKey));
    appSecrets.add(stored.secret);

    const due = Boolean(stored.expiresAt) && Date.parse(stored.expiresAt ?? '') - Date.now() <= REFRESH_MARGIN;
    if (rejected ? stored.secret !== rejected : !due) return stored.secret;

    // Every write below lands only on the pair read here. A new sign-in can be stored under the
    // same id while GitHub is being asked, and what GitHub says of the old pair is not about it.
    const basis = entry.sealed;
    const pending = unsaved?.id === entry.id && unsaved.basis === basis ? unsaved : null;
    const refresh = pending ? pending.refresh : entry.sealedRefresh ? await unseal(entry.sealedRefresh, config.vaultKey) : '';
    if (!refresh) {
      // Due or refused, with nothing to renew it: the sign-in has stopped working, and the card
      // should say so rather than the token quietly dropping out of use.
      await markNeedsSignIn(entry.id, basis, rejected ? 'rejected' : 'no_renewal');
      return null;
    }
    // A renewal token past its six months cannot be spent, and asking would only add a failed call.
    const refreshEnds = pending?.fields.refreshExpiresAt ?? entry.refreshExpiresAt ?? '';
    if (Date.parse(refreshEnds) <= Date.now()) {
      await markNeedsSignIn(entry.id, basis, 'lapsed');
      return null;
    }

    /** @type {Awaited<ReturnType<typeof refreshPair>>} */
    let answer;
    try {
      answer = await refreshPair(refresh);
    } catch {
      // Not reached, or not sensibly answered: nothing was spent that GitHub has told us of, so
      // nothing is marked, and the old token goes on being used while it lasts.
      return rejected ? null : stored.secret;
    }
    if ('error' in answer) {
      await markNeedsSignIn(entry.id, basis, answer.error);
      return storedSecret();
    }

    const { pair } = answer;
    /** @type {AppPairFields} */
    const fields = {
      sealed: await seal(pair.access, config.vaultKey),
      sealedRefresh: pair.refresh ? await seal(pair.refresh, config.vaultKey) : undefined,
      expiresAt: pair.expiresAt,
      refreshExpiresAt: pair.refresh ? pair.refreshExpiresAt : null,
      needsSignIn: false,
      signInError: null,
    };
    try {
      const written = await writeAppPair(entry.id, fields, { ifSealed: basis });
      if (unsaved?.id === entry.id) unsaved = null;
      // The old grant's pair, renewed after a new sign-in replaced it: the new one is the answer.
      if (!written) return storedSecret();
    } catch {
      unsaved = { id: entry.id, basis, fields, access: pair.access, refresh: pair.refresh };
    }
    appSecrets.add(pair.access);
    rememberScope(pair.access, entry);
    return pair.access;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** @param {RequestInfo | URL} input */
function hostOf(input) {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : '').host;
  } catch {
    return '';
  }
}

/** @param {RequestInit | undefined} init */
function bearerOf(init) {
  const auth = new Headers(init?.headers ?? {}).get('authorization') ?? '';
  return auth.replace(/^(bearer|token)\s+/i, '').trim();
}

/**
 * A request refused with the sign-in's token is renewed and asked again, once, so a token that ran
 * out sooner than its stamp said — or was renewed elsewhere in this background a moment ago —
 * costs the caller nothing. Everything gitchop sends GitHub is a string URL with a string body, so
 * it can be sent twice; a Request object is left alone. The second try goes to the fetch beneath
 * this one, not back through it, so a refusal of the new token is the answer, not a loop.
 *
 * This wraps the rate gauge's fetch: rate.js is imported first, by this module and by the entry,
 * so the gauge still sees both tries.
 */
const inner = globalThis.fetch;
/** @type {typeof fetch} */
globalThis.fetch = async (input, init) => {
  const response = await inner(input, init);
  if (response.status !== 401 || hostOf(input) !== 'api.github.com') return response;
  const secret = bearerOf(init);
  if (!secret || !isAppSecret(secret)) return response;
  const next = await refreshAppToken({ rejected: secret }).catch(() => null);
  if (!next || next === secret) return response;
  const headers = new Headers(init?.headers ?? {});
  headers.set('Authorization', `Bearer ${next}`);
  return inner(input, { ...init, headers });
};
