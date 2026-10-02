/** Firefox promises live on `browser`; Chrome MV3 promises live on `chrome`. */
export const api = globalThis.browser ?? globalThis.chrome;

export const STORAGE_KEY = 'links';

/**
 * One of your own links, as storage.sync and the gist hold it. `url` may carry {placeholders},
 * filled from the page when the link is followed.
 * @typedef {{ id: string, icon: string, label: string, url: string }} Link
 */

/** @typedef {{ enabled: number }} PanelSettings */

export const PLACEHOLDERS = [
  ['{owner}', 'Repository owner, e.g. octocat'],
  ['{repo}', 'Repository name, e.g. hello-world'],
  ['{repoFull}', 'Both together, e.g. octocat/hello-world'],
  ['{branch}', 'Current branch or ref, e.g. main'],
  ['{path}', 'Path inside the repo, when browsing files'],
  ['{number}', 'Issue, pull request or discussion number'],
  ['{url}', 'The full current URL'],
];

export const DEFAULT_LINKS = [
  { icon: '🔔', label: 'Notifications', url: 'https://github.com/notifications' },
  { icon: '🧩', label: 'Your pull requests', url: 'https://github.com/pulls' },
  { icon: '🐛', label: 'Issues assigned to you', url: 'https://github.com/issues/assigned' },
  { icon: '⚙️', label: 'This repo: Actions', url: 'https://github.com/{repoFull}/actions' },
  { icon: '🔀', label: 'This repo: Pull requests', url: 'https://github.com/{repoFull}/pulls' },
  { icon: '🌿', label: 'This branch: Commits', url: 'https://github.com/{repoFull}/commits/{branch}' },
];

export const PANEL_KEY = 'panel';

/** The one switch for the panel itself — the links and the search — on the Panels page in Settings. */
export const PANEL_SWITCHES = [
  {
    id: 'enabled',
    label: 'Links',
    value: 1,
    hint: 'Off leaves the menu without the links and the search: only the columns you have on rise into the cut. The toolbar icon still opens Settings.',
  },
];

/**
 * Storage is shared state: whatever shape comes back, the switch ends up on or off.
 * @param {unknown} [raw]
 * @returns {PanelSettings}
 */
export function sanitizePanel(raw) {
  /** @type {Record<string, unknown>} */
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {Record<string, number>} */
  const settings = {};
  for (const { id, value } of PANEL_SWITCHES) {
    const number = Number(source[id]);
    settings[id] = Number.isFinite(number) ? (number >= 1 ? 1 : 0) : value;
  }
  return /** @type {PanelSettings} */ (settings);
}

/** @returns {string} */
export function newId() {
  return crypto.randomUUID();
}

/**
 * @param {Omit<Link, 'id'>[]} links
 * @returns {Link[]}
 */
export function withIds(links) {
  return links.map((link) => ({ id: newId(), ...link }));
}

/**
 * Only http(s) links may be stored — anything else could execute on click.
 * @param {unknown} url
 * @returns {boolean}
 */
export function isSafeUrl(url) {
  try {
    const probe = new URL(String(url).replace(/\{(\w+)\}/g, 'x'));
    return probe.protocol === 'http:' || probe.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Every field a string of its own length, whatever was stored; an id is minted where none was.
 * @param {{ id?: unknown, icon?: unknown, label?: unknown, url?: unknown }} link
 * @returns {Link}
 */
export function sanitize(link) {
  return {
    id: typeof link.id === 'string' && link.id ? link.id : newId(),
    icon: String(link.icon ?? '').trim().slice(0, 4),
    label: String(link.label ?? '').trim().slice(0, 80),
    url: String(link.url ?? '').trim().slice(0, 2000),
  };
}

/** @returns {Promise<Link[]>} */
export async function loadLinks() {
  const stored = await api.storage.sync.get(STORAGE_KEY);
  const links = stored[STORAGE_KEY];
  if (!Array.isArray(links)) return [];
  return links.filter((link) => link && typeof link === 'object').map(sanitize);
}

/** @param {Parameters<typeof sanitize>[0][]} links */
export async function saveLinks(links) {
  await api.storage.sync.set({ [STORAGE_KEY]: links.map(sanitize) });
}
