const API = 'https://api.github.com';
const DAY = 24 * 60 * 60 * 1000;

export const SETTINGS_KEY = 'news';

/** @typedef {{ enabled: number, hour: number, days: number, repos: string[] }} NewsSettings */

/**
 * What an edition covers, as ISO stamps: from `since`, up to but not including `until`.
 * @typedef {{ since: string, until: string }} EditionWindow
 */

/** @typedef {{ number: number, title: string, url: string, author: string }} IssueLike */

/**
 * One repository's window, as fetched and kept in the edition.
 * @typedef {{
 *   repo: string,
 *   url: string,
 *   private: boolean,
 *   commits: { count: number, authors: string[], branch: string, recent: { sha: string, message: string, author: string, url: string }[], more: boolean },
 *   pulls: { merged: IssueLike[], opened: IssueLike[], closed: IssueLike[], more: boolean },
 *   issues: { opened: IssueLike[], closed: IssueLike[], more: boolean },
 *   releases: { tag: string, name: string, url: string, prerelease: boolean }[],
 *   error: string | null,
 * }} Digest
 */

/**
 * A fact the menu can hover or land on: its popover lists every item, and Enter opens `url`.
 * @typedef {{ kind: string, url: string, items: { title: string, detail: string, url: string }[], more: boolean }} Chip
 */

/** @typedef {{ text: string, chip?: Chip }} Segment */

/** A fine-grained slug: one owner, one name, the characters GitHub allows in either. */
const REPO_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
const MAX_REPOS = 30;

/**
 * How far back an edition may reach when the browser was shut for days: long enough that a week
 * away is one digest rather than six lost days, short enough that the digest is still a digest.
 */
export const LOOKBACK_DAYS = 7;
/**
 * How many pull requests, issues and releases are fetched per repository and window: a page for a
 * day, GitHub's largest for anything longer, since a week in a busy repository outruns fifty. It is
 * one request either way; only the page grows.
 */
const PAGE = 50;
const PAGE_LONG = 100;
/** A window this long is more than one day's edition, clock changes included, and gets the larger page. */
const LONG_WINDOW = 36 * 60 * 60 * 1000;
/** Commits come a hundred a page, up to this many pages; a busier window than that says "more on GitHub". */
const COMMIT_PAGE = 100;
const COMMIT_PAGES = 3;

/** One entry per control on the settings card; `value` is the default. */
export const SWITCHES = [
  { id: 'enabled', label: 'News', value: 1, hint: 'Off leaves the menu without the column, whatever is subscribed.' },
];

export const HOUR = {
  id: 'hour',
  label: 'Edition',
  min: 0,
  max: 23,
  value: 8,
  hint: 'The hour each day the edition is made up, and the hour it runs to.',
};

/**
 * How far back each edition reaches, in days. A day is the paper as it began: what happened since
 * the previous edition. A week is the last seven days made up fresh each morning, for a repository
 * worth reading at a week's remove, or a menu opened on Fridays only. The browser shut for longer
 * than that reaches back to the previous edition regardless, up to LOOKBACK_DAYS.
 */
export const DAYS = {
  id: 'days',
  label: 'Covers',
  min: 1,
  max: LOOKBACK_DAYS,
  value: 1,
  hint: 'How far back each edition reaches. A day is what happened since the previous edition; a week is the last seven days, made up fresh each morning. Shut the browser for longer and the edition reaches back to the previous one regardless, up to a week.',
};

export const DEFAULTS = {
  ...Object.fromEntries(SWITCHES.map((item) => [item.id, item.value])),
  hour: HOUR.value,
  days: DAYS.value,
  repos: [],
};

/**
 * @param {unknown} name
 * @returns {name is string}
 */
export function isRepoName(name) {
  return typeof name === 'string' && name.length <= 140 && REPO_NAME.test(name);
}

/**
 * Case is kept as typed for display, compared without it: itk-dev/Economics is itk-dev/economics.
 * @param {unknown} a
 * @param {unknown} b
 */
function sameRepo(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Storage is shared state: whatever shape comes back, every switch ends up on or off, the hour is
 * a whole one on the clock, and the repositories are well-formed slugs with no repeats.
 * @param {unknown} [raw]
 * @returns {NewsSettings}
 */
export function sanitizeSettings(raw) {
  /** @type {Record<string, unknown>} */
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {Record<string, any>} */
  const settings = {};
  for (const { id, value } of SWITCHES) {
    const number = Number(source[id]);
    settings[id] = Number.isFinite(number) ? (number >= 1 ? 1 : 0) : value;
  }
  const hour = Number(source.hour);
  settings.hour = Number.isInteger(hour) && hour >= HOUR.min && hour <= HOUR.max ? hour : HOUR.value;
  const days = Number(source.days);
  settings.days = Number.isInteger(days) && days >= DAYS.min && days <= DAYS.max ? days : DAYS.value;

  /** @type {string[]} */
  const repos = [];
  for (const entry of Array.isArray(source.repos) ? source.repos : []) {
    const name = String(entry ?? '').trim();
    if (!isRepoName(name) || repos.some((seen) => sameRepo(seen, name))) continue;
    repos.push(name);
    if (repos.length >= MAX_REPOS) break;
  }
  settings.repos = repos;
  return /** @type {NewsSettings} */ (settings);
}

/**
 * @param {{ repos?: string[] } | null | undefined} settings
 * @param {string} repo
 * @returns {boolean}
 */
export function isSubscribed(settings, repo) {
  return (settings?.repos ?? []).some((seen) => sameRepo(seen, repo));
}

/**
 * The list with `repo` added or removed; the same list back when nothing changes.
 * @param {{ repos?: string[] } | null | undefined} settings
 * @param {unknown} repo
 * @param {boolean} subscribe
 * @returns {string[]}
 */
export function toggleRepo(settings, repo, subscribe) {
  const name = String(repo ?? '').trim();
  const repos = settings?.repos ?? [];
  const has = repos.some((seen) => sameRepo(seen, name));
  if (subscribe && !has) {
    if (!isRepoName(name)) throw new Error('That is not a repository name. Use owner/repository.');
    if (repos.length >= MAX_REPOS) throw new Error(`gitchop follows at most ${MAX_REPOS} repositories.`);
    return [...repos, name];
  }
  if (!subscribe && has) return repos.filter((seen) => !sameRepo(seen, name));
  return repos;
}

/**
 * When the edition is made up: the most recent `hour` o'clock, local time, that has already
 * passed. Local because the hour is what the person reads it at, not a UTC boundary.
 * @param {number} now
 * @param {number} hour
 * @returns {number}
 */
export function editionTime(now, hour) {
  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  if (at.valueOf() > now) at.setDate(at.getDate() - 1);
  return at.valueOf();
}

/**
 * The `hour` o'clock after `now` — where the alarm for the next edition goes.
 * @param {number} now
 * @param {number} hour
 * @returns {number}
 */
export function nextEditionTime(now, hour) {
  const at = new Date(editionTime(now, hour));
  at.setDate(at.getDate() + 1);
  return at.valueOf();
}

/**
 * What an edition covers. Made up daily, it runs from the previous edition's cutoff to its own —
 * yesterday at the same hour, on an ordinary day — or as many days back as Settings asks, a week
 * at most. Shut the browser for a long weekend and Monday's edition reaches back to Friday's
 * instead of losing the days between, up to a week; with no previous edition it is the plain
 * span. Asked again for the same edition — a manual refresh, a repository subscribed at noon — it
 * keeps the window it had, so the header does not move. An edition made up under another span
 * says nothing about this one: change the span and the window is drawn afresh.
 * @param {number} now
 * @param {number} hour
 * @param {{ since?: string, until?: string, days?: number } | null} [previous]
 * @param {number} [days]
 * @returns {EditionWindow}
 */
export function editionWindow(now, hour, previous = null, days = DAYS.value) {
  const until = editionTime(now, hour);
  const span = until - Math.min(LOOKBACK_DAYS, Math.max(1, days)) * DAY;
  const known = (previous?.days ?? DAYS.value) === days ? previous : null;
  const before = Date.parse(known?.until ?? '');
  const from = Date.parse(known?.since ?? '');
  let since = span;
  if (!Number.isNaN(before)) {
    if (before === until && !Number.isNaN(from) && from < until) since = from;
    else since = Math.max(until - LOOKBACK_DAYS * DAY, Math.min(before, span));
  }
  return { since: new Date(since).toISOString(), until: new Date(until).toISOString() };
}

/**
 * Whether the edition on file is the one Settings would make up now: the same cutoff, the same span.
 * @param {{ until?: string, days?: number } | null | undefined} cache
 * @param {{ hour: number, days: number }} settings
 * @param {number} now
 * @returns {boolean}
 */
export function isCurrentEdition(cache, settings, now) {
  if (!cache?.until) return false;
  return Date.parse(cache.until) === editionTime(now, settings.hour) && (cache.days ?? DAYS.value) === settings.days;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The rest of the menu is English; the clock is too, rather than whatever the locale would make of 08:00.
 * @param {number} ms
 */
function clock(ms) {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/**
 * "since yesterday 08:00", "since Friday 08:00", "since 3 Sep 08:00" — the header's one fact.
 * @param {string | null | undefined} sinceIso
 * @param {number} [now]
 * @returns {string}
 */
export function describeSince(sinceIso, now = Date.now()) {
  const since = Date.parse(sinceIso ?? '');
  if (Number.isNaN(since)) return '';
  /** @type {(ms: number) => number} */
  const startOf = (ms) => new Date(new Date(ms).toDateString()).valueOf();
  const days = Math.round((startOf(now) - startOf(since)) / DAY);
  const at = new Date(since);
  const time = clock(since);
  if (days <= 0) return `since ${time}`;
  if (days === 1) return `since yesterday ${time}`;
  if (days < 7) return `since ${WEEKDAYS[at.getDay()]} ${time}`;
  return `since ${at.getDate()} ${MONTHS[at.getMonth()]} ${time}`;
}

/**
 * @param {string | null | undefined} iso
 * @param {EditionWindow} window
 */
function within(iso, window) {
  const at = Date.parse(iso ?? '');
  return !Number.isNaN(at) && at >= Date.parse(window.since) && at < Date.parse(window.until);
}

/** @param {unknown} text */
function firstLine(text) {
  return String(text ?? '').split('\n')[0].trim().slice(0, 140);
}

/** @param {{ login?: unknown } | null | undefined} user */
function login(user) {
  return String(user?.login ?? '').slice(0, 60);
}

/**
 * Commits become one fact — how many, by whom — and every one of them, first line and author, so
 * the popover can show the whole day without leaving the page. The author is the GitHub login when
 * GitHub matched one, else the name on the commit, so a rebased or unlinked commit still counts as
 * somebody's. `more` says the fetch stopped before the day did.
 * @param {unknown} list
 * @param {EditionWindow} window
 * @param {string | null | undefined} branch
 * @returns {Digest['commits']}
 */
export function shapeCommits(list, window, branch) {
  /** @type {any[]} */
  const raw = Array.isArray(list) ? list : [];
  const commits = raw.filter((entry) => within(entry?.commit?.committer?.date ?? entry?.commit?.author?.date, window));
  /** @type {string[]} */
  const authors = [];
  /** @type {Digest['commits']['recent']} */
  const recent = [];
  for (const entry of commits) {
    const name = login(entry.author) || String(entry.commit?.author?.name ?? '').trim().slice(0, 60);
    if (name && !authors.some((seen) => seen.toLowerCase() === name.toLowerCase())) authors.push(name);
    recent.push({
      sha: String(entry.sha ?? '').slice(0, 7),
      message: firstLine(entry.commit?.message),
      author: name,
      url: String(entry.html_url ?? ''),
    });
  }
  return {
    count: commits.length,
    authors,
    branch: String(branch ?? '').slice(0, 120),
    recent,
    more: raw.length >= COMMIT_PAGE * COMMIT_PAGES,
  };
}

/**
 * A full page whose oldest item still moved inside the window may have left some behind; a full
 * page whose oldest item is older than the window has shown everything the window holds.
 * @param {unknown} list
 * @param {EditionWindow} window
 * @param {number} [size]
 */
function pageCut(list, window, size = PAGE) {
  if (!Array.isArray(list) || list.length < size) return false;
  const oldest = Date.parse(list[list.length - 1]?.updated_at ?? '');
  return Number.isNaN(oldest) || oldest >= Date.parse(window.since);
}

/**
 * @param {any} item
 * @returns {IssueLike}
 */
function shapeIssueLike(item) {
  return {
    number: Number(item.number) || 0,
    title: firstLine(item.title),
    url: String(item.html_url ?? ''),
    author: login(item.user),
  };
}

/**
 * A pull request is news for one reason at a time: merged beats opened beats closed without
 * merging, and a pull request opened and merged inside the window shows once, as merged.
 * @param {unknown} list
 * @param {EditionWindow} window
 * @param {number} [size]
 * @returns {Digest['pulls']}
 */
export function shapePulls(list, window, size = PAGE) {
  /** @type {IssueLike[]} */
  const merged = [];
  /** @type {IssueLike[]} */
  const opened = [];
  /** @type {IssueLike[]} */
  const closed = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object' || !item.html_url) continue;
    if (within(item.merged_at, window)) merged.push(shapeIssueLike(item));
    else if (within(item.created_at, window)) opened.push(shapeIssueLike(item));
    else if (item.state === 'closed' && within(item.closed_at, window)) closed.push(shapeIssueLike(item));
  }
  return { merged, opened, closed, more: pageCut(list, window, size) };
}

/**
 * The issues endpoint returns pull requests too; anything carrying a pull_request key is not an issue.
 * @param {unknown} list
 * @param {EditionWindow} window
 * @param {number} [size]
 * @returns {Digest['issues']}
 */
export function shapeIssues(list, window, size = PAGE) {
  /** @type {IssueLike[]} */
  const opened = [];
  /** @type {IssueLike[]} */
  const closed = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object' || !item.html_url || item.pull_request) continue;
    if (within(item.created_at, window)) opened.push(shapeIssueLike(item));
    else if (item.state === 'closed' && within(item.closed_at, window)) closed.push(shapeIssueLike(item));
  }
  return { opened, closed, more: pageCut(list, window, size) };
}

/**
 * Drafts are not published; a prerelease is, and says so.
 * @param {unknown} list
 * @param {EditionWindow} window
 * @returns {Digest['releases']}
 */
export function shapeReleases(list, window) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item === 'object' && !item.draft && within(item.published_at, window))
    .map((item) => ({
      tag: String(item.tag_name ?? '').slice(0, 80),
      name: firstLine(item.name),
      url: String(item.html_url ?? ''),
      prerelease: Boolean(item.prerelease),
    }));
}

/**
 * @param {string} repo
 * @returns {Digest}
 */
export function emptyDigest(repo) {
  return {
    repo,
    url: `https://github.com/${repo}`,
    private: false,
    commits: { count: 0, authors: [], branch: '', recent: [], more: false },
    pulls: { merged: [], opened: [], closed: [], more: false },
    issues: { opened: [], closed: [], more: false },
    releases: [],
    error: null,
  };
}

/**
 * @param {Partial<Digest> | null | undefined} digest
 * @returns {boolean}
 */
export function isQuiet(digest) {
  if (!digest) return true;
  const { commits, pulls, issues, releases } = digest;
  return (
    (commits?.count ?? 0) === 0 &&
    (pulls?.merged?.length ?? 0) + (pulls?.opened?.length ?? 0) + (pulls?.closed?.length ?? 0) === 0 &&
    (issues?.opened?.length ?? 0) + (issues?.closed?.length ?? 0) === 0 &&
    (releases?.length ?? 0) === 0
  );
}

/**
 * "tuj", "tuj and jekuno", "tuj, jekuno and marcel", "tuj, jekuno and 4 more" — people, in prose.
 * @param {(string | null | undefined)[] | null | undefined} names
 * @param {number} [shown]
 * @returns {string}
 */
export function listPhrase(names, shown = 2) {
  const list = /** @type {string[]} */ ((names ?? []).filter(Boolean));
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length <= shown + 1) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${list.slice(0, shown).join(', ')} and ${list.length - shown} more`;
}

/**
 * @param {number} count
 * @param {string} noun
 */
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * @param {Digest} digest
 * @param {EditionWindow} window
 */
function commitsUrl(digest, window) {
  const branch = encodeURIComponent(digest.commits.branch || 'HEAD');
  return `${digest.url}/commits/${branch}?since=${encodeURIComponent(window.since)}&until=${encodeURIComponent(window.until)}`;
}

/**
 * GitHub's search takes a date range with times in it; the milliseconds are the one thing it will not.
 * @param {string} iso
 */
function stamp(iso) {
  return String(iso).replace(/\.\d{3}Z$/, 'Z');
}

/**
 * GitHub's own list of exactly this — the pull requests merged inside the window, say.
 * @param {Digest} digest
 * @param {string} list
 * @param {string} qualifiers
 * @param {string} field
 * @param {EditionWindow} window
 */
function searchUrl(digest, list, qualifiers, field, window) {
  const query = `${qualifiers} ${field}:${stamp(window.since)}..${stamp(window.until)}`;
  return `${digest.url}/${list}?q=${encodeURIComponent(query)}`;
}

/**
 * @param {IssueLike[] | null | undefined} list
 * @returns {Chip['items']}
 */
function issueItems(list) {
  return (list ?? []).map((item) => ({
    title: item.title || `#${item.number}`,
    detail: [`#${item.number}`, item.author].filter(Boolean).join(' · '),
    url: item.url,
  }));
}

/** @type {(text: string) => Segment} */
const plain = (text) => ({ text });

/**
 * A fact the reader can hover or land on: its popover lists every one of `items`, and Enter opens
 * `url`. `more` is the one case the popover cannot be complete — the fetch stopped before the day
 * did — and it then ends with a line pointing at GitHub.
 * @param {string} text
 * @param {string} kind
 * @param {string} url
 * @param {Chip['items']} items
 * @param {boolean} [more]
 * @returns {Segment}
 */
function chip(text, kind, url, items, more = false) {
  return { text, chip: { kind, url, items, more: Boolean(more) } };
}

/**
 * "2 pull requests merged, 1 opened and 1 closed without merging." The noun rides on the first
 * part only; the rest are a number and a verb, which is how the sentence would be said aloud.
 * @param {Segment[]} segments
 * @param {{ count: number, verb: string, tail?: string, url: string, items: Chip['items'] }[]} parts
 * @param {string} noun
 * @param {string} kind
 * @param {boolean} more
 */
function clause(segments, parts, noun, kind, more) {
  if (parts.length === 0) return;
  parts.forEach((part, index) => {
    if (index > 0) segments.push(plain(index === parts.length - 1 ? ' and ' : ', '));
    const text = index === 0 ? `${plural(part.count, noun)} ${part.verb}` : `${part.count} ${part.verb}`;
    segments.push(chip(text, kind, part.url, part.items, more));
    if (part.tail) segments.push(plain(part.tail));
  });
  segments.push(plain('. '));
}

/**
 * What one repository's day becomes on screen: a few sentences, most newsworthy first — a release
 * outranks everything, then the commits as one count, then the pull requests, then the issues.
 * Every fact in them is a chip: its popover lists everything it is made of, and its link opens
 * GitHub's own list of exactly that, cut to the window. Segments are plain text or a chip, and the
 * menu draws them in order. A quiet day is no segments, and the menu says so.
 * @param {Digest} digest
 * @param {EditionWindow} window
 * @returns {Segment[]}
 */
export function proseFor(digest, window) {
  /** @type {Segment[]} */
  const segments = [];

  const releases = digest.releases ?? [];
  if (releases.length > 0) {
    const [first] = releases;
    const items = releases.map((release) => ({
      title: release.name && release.name !== release.tag ? `${release.tag} — ${release.name}` : release.tag,
      detail: release.prerelease ? 'prerelease' : 'release',
      url: release.url,
    }));
    if (releases.length === 1) {
      segments.push(plain(first.prerelease ? 'Published prerelease ' : 'Released '), chip(first.tag, 'release', first.url, items));
      if (first.name && first.name !== first.tag) segments.push(plain(` — ${first.name}`));
    } else {
      const tags = listPhrase(releases.map((release) => release.tag));
      segments.push(plain('Released '), chip(tags, 'release', `${digest.url}/releases`, items));
    }
    segments.push(plain('. '));
  }

  const commits = digest.commits ?? /** @type {Partial<Digest['commits']>} */ ({});
  if (commits.count > 0) {
    const items = (commits.recent ?? []).map((entry) => ({
      title: entry.message || entry.sha,
      detail: [entry.sha, entry.author].filter(Boolean).join(' · '),
      url: entry.url,
    }));
    segments.push(chip(plural(commits.count, 'commit'), 'commits', commitsUrl(digest, window), items, commits.more));
    if (commits.branch) segments.push(plain(` to ${commits.branch}`));
    const who = listPhrase(commits.authors);
    if (who) segments.push(plain(` by ${who}`));
    segments.push(plain('. '));
  }

  const pulls = digest.pulls ?? /** @type {Partial<Digest['pulls']>} */ ({});
  /** @type {Parameters<typeof clause>[1]} */
  const pullParts = [];
  if (pulls.merged?.length > 0) {
    pullParts.push({ count: pulls.merged.length, verb: 'merged', url: searchUrl(digest, 'pulls', 'is:pr is:merged', 'merged', window), items: issueItems(pulls.merged) });
  }
  if (pulls.opened?.length > 0) {
    pullParts.push({ count: pulls.opened.length, verb: 'opened', url: searchUrl(digest, 'pulls', 'is:pr', 'created', window), items: issueItems(pulls.opened) });
  }
  if (pulls.closed?.length > 0) {
    pullParts.push({ count: pulls.closed.length, verb: 'closed', tail: ' without merging', url: searchUrl(digest, 'pulls', 'is:pr is:closed is:unmerged', 'closed', window), items: issueItems(pulls.closed) });
  }
  clause(segments, pullParts, 'pull request', 'pull', pulls.more);

  const issues = digest.issues ?? /** @type {Partial<Digest['issues']>} */ ({});
  /** @type {Parameters<typeof clause>[1]} */
  const issueParts = [];
  if (issues.opened?.length > 0) {
    issueParts.push({ count: issues.opened.length, verb: 'opened', url: searchUrl(digest, 'issues', 'is:issue', 'created', window), items: issueItems(issues.opened) });
  }
  if (issues.closed?.length > 0) {
    issueParts.push({ count: issues.closed.length, verb: 'closed', url: searchUrl(digest, 'issues', 'is:issue is:closed', 'closed', window), items: issueItems(issues.closed) });
  }
  clause(segments, issueParts, 'issue', 'issue', issues.more);

  if (segments.length > 0) segments[segments.length - 1] = plain('.');
  return segments;
}

/**
 * The same sentences as one string, for anywhere without chips — the settings page, a tooltip.
 * @param {Segment[] | null | undefined} segments
 * @returns {string}
 */
export function proseText(segments) {
  return (segments ?? []).map((segment) => segment.text).join('');
}

/** @param {string | null | undefined} token */
function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * @param {number} status
 * @param {boolean} anonymous
 */
function explain(status, anonymous) {
  if (status === 401) return 'GitHub rejected the token.';
  if (status === 404) return anonymous ? 'Not found — a private repository needs a token that can see it.' : 'Not found, or the token cannot see it.';
  if (status === 403 || status === 429) return anonymous ? 'GitHub rate-limited the request. A token raises the limit.' : 'GitHub rate-limited the request.';
  if (status === 451) return 'GitHub has taken the repository down.';
  return `GitHub returned ${status}.`;
}

/**
 * @param {string} path
 * @param {string | null | undefined} token
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
async function get(path, token) {
  const response = await fetch(`${API}${path}`, { headers: headers(token) });
  /** @type {any} */
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

/**
 * The repository itself: proves the name, canonicalises its case and says which branch is the
 * one that matters. Throws with a sentence the menu and the settings page can show as it is.
 * @param {string} repo
 * @param {string | null | undefined} token
 * @returns {Promise<{ fullName: string, url: string, private: boolean, branch: string, archived: boolean }>}
 */
export async function lookupRepo(repo, token) {
  const [owner, name] = String(repo).split('/');
  const result = await get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token);
  if (!result.ok) throw Object.assign(new Error(explain(result.status, !token)), { status: result.status });
  const body = result.body ?? {};
  return {
    fullName: String(body.full_name ?? repo),
    url: String(body.html_url ?? `https://github.com/${repo}`),
    private: Boolean(body.private),
    branch: String(body.default_branch ?? ''),
    archived: Boolean(body.archived),
  };
}

/**
 * The window's commits, a page at a time until a page comes back short or the pages run out. A
 * page that fails after the first keeps what the earlier ones brought; the first failing is the
 * answer — an empty repository's 409 among them.
 * @param {string} base
 * @param {string} branch
 * @param {EditionWindow} window
 * @param {string | null | undefined} token
 */
async function getCommits(base, branch, window, token) {
  /** @type {any[]} */
  const all = [];
  for (let page = 1; page <= COMMIT_PAGES; page += 1) {
    const query = `since=${encodeURIComponent(window.since)}&until=${encodeURIComponent(window.until)}&per_page=${COMMIT_PAGE}&page=${page}${branch}`;
    const result = await get(`${base}/commits?${query}`, token);
    if (!result.ok) {
      if (page === 1) return result;
      break;
    }
    const batch = Array.isArray(result.body) ? result.body : [];
    all.push(...batch);
    if (batch.length < COMMIT_PAGE) break;
  }
  return { ok: true, status: 200, body: all };
}

/**
 * The page for pull requests and issues: a day's, or the largest GitHub gives for a longer window.
 * @param {EditionWindow} window
 * @returns {number}
 */
export function pageSize(window) {
  const span = Date.parse(window.until) - Date.parse(window.since);
  return span > LONG_WINDOW ? PAGE_LONG : PAGE;
}

/**
 * One repository's window, in four requests after the lookup — a fifth and sixth only on a window
 * with more than a hundred commits: the commits on the default branch inside it, the pull
 * requests and issues that moved lately, and the recent releases. The count of requests is the
 * same whatever the window covers; a longer one asks for bigger pages, not more of them.
 * Everything is filtered here against the window, because only the commits endpoint takes an
 * `until`.
 * @param {string} repo
 * @param {EditionWindow} window
 * @param {string | null | undefined} token
 * @returns {Promise<Digest>}
 */
export async function fetchDigest(repo, window, token) {
  const about = await lookupRepo(repo, token);
  const base = `/repos/${about.fullName.split('/').map(encodeURIComponent).join('/')}`;
  const branch = about.branch ? `&sha=${encodeURIComponent(about.branch)}` : '';
  const since = encodeURIComponent(window.since);
  const size = pageSize(window);

  const [commits, pulls, issues, releases] = await Promise.all([
    getCommits(base, branch, window, token),
    get(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=${size}`, token),
    get(`${base}/issues?state=all&since=${since}&sort=updated&direction=desc&per_page=${size}`, token),
    get(`${base}/releases?per_page=20`, token),
  ]);

  // An empty repository answers 409 to /commits; that is a quiet day, not a failure.
  const failed = [commits, pulls, issues, releases].find((part) => !part.ok && part.status !== 409);
  if (failed) throw Object.assign(new Error(explain(failed.status, !token)), { status: failed.status });

  return {
    ...emptyDigest(about.fullName),
    url: about.url,
    private: about.private,
    commits: shapeCommits(commits.ok ? commits.body : [], window, about.branch),
    pulls: shapePulls(pulls.body, window, size),
    issues: shapeIssues(issues.body, window, size),
    releases: shapeReleases(releases.body, window),
  };
}
