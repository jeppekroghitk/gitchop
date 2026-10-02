import { api } from '../lib/links.js';
import { identify, tokenLabel } from '../lib/gist.js';
import { listAccessibleRepos, privateOwnersOf } from '../lib/repos.js';
import { listInstallations } from '../lib/signin.js';
import { now } from './config.js';
import { INDEX_KEY } from './keys.js';
import { loadTokens, updateTokens } from './tokens.js';

/** The local index of every repository the tokens can reach, which the menu searches on every settle. */

/**
 * The index as storage.local holds it. `failures` is one sentence per token that could not list.
 * @typedef {{ repos: import('../lib/repos.js').Repo[], builtAt: string | null, failures: string[] }} RepoIndex
 */

/** @returns {Promise<RepoIndex>} */
export async function readIndex() {
  const stored = await api.storage.local.get(INDEX_KEY);
  return stored[INDEX_KEY] ?? { repos: [], builtAt: null, failures: [] };
}

/**
 * Every token contributes, because each one can only speak for its own resource owner. The full
 * listing also settles which owners each token reaches, so the token rows in Settings stay true:
 * a personal access token's from the private repositories it lists, a sign-in's from where the app
 * is installed, which is what decides it and which GitHub can simply be asked.
 *
 * What is learned is written back as a patch by id once the whole listing is done, which can be
 * minutes after the tokens were opened. It never carries a sign-in's expiry: a renewal in the
 * meantime has written a newer one.
 */
export async function buildIndex() {
  const tokens = await loadTokens();
  if (tokens.length === 0) throw new Error('Sign in or add a token first.');

  /** @type {Map<string, import('../lib/repos.js').Repo>} */
  const seen = new Map();
  /** @type {string[]} */
  const failures = [];
  /** @type {Map<string, Partial<import('./config.js').TokenEntry>>} */
  const learned = new Map();
  for (const entry of tokens) {
    try {
      const repos = await listAccessibleRepos(entry.secret);
      if (entry.kind === 'app') {
        const installations = await listInstallations(entry.secret).catch(() => null);
        if (installations) learned.set(entry.id, { installations, owners: installations.map((install) => install.owner) });
      } else {
        /** @type {Partial<import('./config.js').TokenEntry>} */
        const patch = { owners: privateOwnersOf(repos) };
        // The expiry rides on every answer, so a token saved before it was read learns it here.
        const who = await identify(entry.secret).catch(() => null);
        if (who) patch.expiresAt = who.expiresAt ?? null;
        learned.set(entry.id, patch);
      }
      for (const repo of repos) {
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
      failures.push(`${tokenLabel(entry)}: ${String(error.message ?? error)}`);
    }
  }

  if (seen.size === 0 && failures.length > 0) throw new Error(failures.join(' · '));

  const index = { repos: [...seen.values()], builtAt: now(), failures };
  await api.storage.local.set({ [INDEX_KEY]: index });
  await updateTokens((list) => list.map((entry) => (learned.has(entry.id) ? { ...entry, ...learned.get(entry.id) } : entry)));
  return indexState(index);
}

/**
 * The index as the settings page is told of it: how much it holds and whose, never the repositories.
 * @typedef {{
 *   count: number,
 *   privateCount: number,
 *   owners: { owner: string, count: number }[],
 *   failures: string[],
 *   builtAt: string | null,
 * }} IndexState
 */

/**
 * @param {RepoIndex} index
 * @returns {IndexState}
 */
export function indexState(index) {
  /** @type {Map<string, number>} */
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
