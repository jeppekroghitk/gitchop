import { api } from '../lib/links.js';
import { identify, tokenLabel } from '../lib/gist.js';
import { listAccessibleRepos, privateOwnersOf } from '../lib/repos.js';
import { now } from './config.js';
import { INDEX_KEY } from './keys.js';
import { loadTokens, storeTokens } from './tokens.js';

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
 * listing also settles which owners each token reaches, so the token rows in Settings stay true.
 */
export async function buildIndex() {
  const tokens = await loadTokens();
  if (tokens.length === 0) throw new Error('Add a token first.');

  /** @type {Map<string, import('../lib/repos.js').Repo>} */
  const seen = new Map();
  /** @type {string[]} */
  const failures = [];
  for (const entry of tokens) {
    try {
      const repos = await listAccessibleRepos(entry.secret);
      entry.owners = privateOwnersOf(repos);
      // The expiry rides on every answer, so a token saved before it was read learns it here.
      const who = await identify(entry.secret).catch(() => null);
      if (who) entry.expiresAt = who.expiresAt ?? null;
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
  await storeTokens(tokens);
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
