import { api } from '../lib/links.js';
import { identify, tokenLabel } from '../lib/gist.js';
import { buildProgress, listAccessibleRepos, privateOwnersOf } from '../lib/repos.js';
import { listInstallations } from '../lib/signin.js';
import { now } from './config.js';
import { INDEX_KEY, INDEX_PROGRESS_KEY } from './keys.js';
import { loadTokens, updateTokens } from './tokens.js';

/** The local index of every repository the tokens can reach, which the menu searches on every settle. */

/**
 * The index as storage.local holds it. `failures` is one sentence per token that could not list.
 * @typedef {{ repos: import('../lib/repos.js').Repo[], builtAt: string | null, failures: string[] }} RepoIndex
 */

/**
 * A build on its way, as storage.local holds it while it runs: how far it has come, from 0 to 1,
 * and how many repositories it has found so far. The welcome draws its bar from this.
 * @typedef {{ done: number, count: number, privateCount: number }} IndexProgress
 */

/** @returns {Promise<RepoIndex>} */
export async function readIndex() {
  const stored = await api.storage.local.get(INDEX_KEY);
  return stored[INDEX_KEY] ?? { repos: [], builtAt: null, failures: [] };
}

/**
 * The build under way, if there is one. The welcome and Settings can both ask for a build, and a
 * second request joins the first instead of listing everything again beside it.
 * @type {Promise<IndexState> | null}
 */
let building = null;

/** @returns {Promise<IndexState>} */
export function buildIndex() {
  building ??= runBuild().finally(() => {
    building = null;
    api.storage.local.remove(INDEX_PROGRESS_KEY).catch(() => {});
  });
  return building;
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
 * @returns {Promise<IndexState>}
 */
async function runBuild() {
  const tokens = await loadTokens();
  if (tokens.length === 0) throw new Error('Sign in or add a token first.');

  /** @type {Map<string, import('../lib/repos.js').Repo>} */
  const seen = new Map();
  /** @type {string[]} */
  const failures = [];
  /** @type {Map<string, Partial<import('./config.js').TokenEntry>>} */
  const learned = new Map();
  /** @param {number} done */
  const report = (done) => {
    let privateCount = 0;
    for (const repo of seen.values()) if (repo.private) privateCount += 1;
    /** @type {IndexProgress} */
    const progress = { done, count: seen.size, privateCount };
    api.storage.local.set({ [INDEX_PROGRESS_KEY]: progress }).catch(() => {});
  };
  report(0);

  for (const [at, entry] of tokens.entries()) {
    /** @type {(batch: import('../lib/repos.js').Repo[], page: number) => void} */
    const onPage = (batch, page) => {
      for (const repo of batch) {
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
      report(buildProgress(at, tokens.length, page));
    };
    try {
      const repos = await listAccessibleRepos(entry.secret, 6, 100, null, onPage);
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
    } catch (error) {
      failures.push(`${tokenLabel(entry)}: ${String(error.message ?? error)}`);
    }
    report((at + 1) / tokens.length);
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
 *   ownerCount: number,
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
    ownerCount: owners.length,
    failures: index.failures ?? [],
    builtAt: index.builtAt,
  };
}
