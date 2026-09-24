/** Firefox promises live on `browser`; Chrome MV3 promises live on `chrome`. */
export const api = globalThis.browser ?? globalThis.chrome;

export const STORAGE_KEY = 'links';

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

/** Storage is shared state: whatever shape comes back, the switch ends up on or off. */
export function sanitizePanel(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const settings = {};
  for (const { id, value } of PANEL_SWITCHES) {
    const number = Number(source[id]);
    settings[id] = Number.isFinite(number) ? (number >= 1 ? 1 : 0) : value;
  }
  return settings;
}

export function newId() {
  return crypto.randomUUID();
}

export function withIds(links) {
  return links.map((link) => ({ id: newId(), ...link }));
}

/** Only http(s) links may be stored — anything else could execute on click. */
export function isSafeUrl(url) {
  try {
    const probe = new URL(String(url).replace(/\{(\w+)\}/g, 'x'));
    return probe.protocol === 'http:' || probe.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitize(link) {
  return {
    id: typeof link.id === 'string' && link.id ? link.id : newId(),
    icon: String(link.icon ?? '').trim().slice(0, 4),
    label: String(link.label ?? '').trim().slice(0, 80),
    url: String(link.url ?? '').trim().slice(0, 2000),
  };
}

export async function loadLinks() {
  const stored = await api.storage.sync.get(STORAGE_KEY);
  const links = stored[STORAGE_KEY];
  if (!Array.isArray(links)) return [];
  return links.filter((link) => link && typeof link === 'object').map(sanitize);
}

export async function saveLinks(links) {
  await api.storage.sync.set({ [STORAGE_KEY]: links.map(sanitize) });
}
