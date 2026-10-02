const GRAPHQL = 'https://api.github.com/graphql';

export const SETTINGS_KEY = 'pulls';

/** @typedef {{ enabled: number, badge: number, drafts: number }} PullsSettings */

/** @typedef {'reviewed' | 'needsReview' | 'unreviewed'} LaneId */

/**
 * One pull request as a lane holds it. `verdict` is what the latest reviews add up to.
 * @typedef {{
 *   number: number,
 *   title: string,
 *   url: string,
 *   repo: string,
 *   repoShort: string,
 *   private: boolean,
 *   draft: boolean,
 *   author: string,
 *   updatedAt: string | null,
 *   verdict: 'changes' | 'approved' | null,
 * }} Pull
 */

/**
 * Every lane's pull requests, and how many GitHub says it holds — which can be more than were sent.
 * @typedef {Record<LaneId, { pulls: Pull[], total: number }>} Lanes
 */

/**
 * Every open pull request you are party to lands in exactly one lane. Answers to your own work come
 * first, then what others are waiting on you for, then your work that nobody has answered yet.
 * Every lane shows everything it holds; `slots` is only how many skeleton rows stand in for it
 * before anything has loaded.
 * @type {{ id: LaneId, title: string, empty: string, slots: number, all: string }[]}
 */
export const LANES = [
  { id: 'reviewed', title: 'Feedback on your PRs', empty: 'no feedback on your PRs yet', slots: 3, all: 'https://github.com/pulls' },
  { id: 'needsReview', title: 'Waiting on you', empty: 'nothing waiting on you', slots: 3, all: 'https://github.com/pulls/review-requested' },
  { id: 'unreviewed', title: 'Waiting on others', empty: 'nothing waiting on others', slots: 2, all: 'https://github.com/pulls' },
];

/** One entry per control on the settings card; `value` is the default. */
export const SWITCHES = [
  { id: 'enabled', label: 'Pull requests', value: 1, hint: 'Off leaves the menu as it was: links and repository search, nothing beside it.' },
  { id: 'badge', label: 'Badge', value: 1, hint: 'The number waiting for your review, on the toolbar icon, so you know before you press the key.' },
  { id: 'drafts', label: 'Drafts', value: 0, hint: 'Off keeps draft pull requests out of every lane — your own drafts are not waiting on anyone.' },
];

export const DEFAULTS = Object.fromEntries(SWITCHES.map((item) => [item.id, item.value]));

/**
 * Storage is shared state: whatever shape comes back, every switch ends up on or off.
 * @param {unknown} [raw]
 * @returns {PullsSettings}
 */
export function sanitizeSettings(raw) {
  /** @type {Record<string, unknown>} */
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {Record<string, number>} */
  const settings = {};
  for (const { id, value } of SWITCHES) {
    const number = Number(source[id]);
    settings[id] = Number.isFinite(number) ? (number >= 1 ? 1 : 0) : value;
  }
  return /** @type {PullsSettings} */ (settings);
}

/**
 * Two searches in one request. The REST search endpoint returns issue-shaped objects with no review
 * state, so it cannot tell a reviewed pull request from an unreviewed one; GraphQL carries the
 * reviews along. Drafts are excluded in the query rather than filtered afterwards, so the counts
 * GitHub reports are the counts shown. The page sizes are generous because every lane shows
 * everything it holds; only past these does anything point at GitHub.
 * @param {{ drafts?: number }} [settings]
 */
export function buildQuery({ drafts } = {}) {
  const draft = drafts ? '' : ' draft:false';
  return {
    query: `
query($requested: String!, $mine: String!) {
  requested: search(type: ISSUE, first: 50, query: $requested) { issueCount nodes { ...PR } }
  mine: search(type: ISSUE, first: 100, query: $mine) { issueCount nodes { ...PR } }
}
fragment PR on PullRequest {
  number title url isDraft updatedAt
  repository { nameWithOwner isPrivate }
  author { login }
  latestReviews(first: 10) { nodes { state } }
}`.trim(),
    variables: {
      requested: `is:open is:pr archived:false review-requested:@me${draft}`,
      mine: `is:open is:pr archived:false author:@me${draft}`,
    },
  };
}

/**
 * Changes requested outranks approval: one reviewer asking for changes means the pull request is
 * back with you whatever the others said. The obvious field, reviewDecision, is null on any
 * repository without required-review branch protection — even with an approval on it — so the
 * latest review per reviewer is what gets read.
 * @param {({ state?: string } | null)[] | null | undefined} reviews
 * @returns {Pull['verdict']}
 */
export function verdictOf(reviews) {
  const states = (reviews ?? []).map((review) => review?.state);
  if (states.includes('CHANGES_REQUESTED')) return 'changes';
  if (states.includes('APPROVED')) return 'approved';
  return null;
}

/**
 * @param {any} node
 * @returns {Pull | null}
 */
export function shapePull(node) {
  if (!node || typeof node !== 'object' || !node.url) return null;
  const repo = node.repository?.nameWithOwner ?? '';
  return {
    number: Number(node.number) || 0,
    title: String(node.title ?? '').trim().slice(0, 140),
    url: String(node.url),
    repo,
    repoShort: repo.slice(repo.indexOf('/') + 1),
    private: Boolean(node.repository?.isPrivate),
    draft: Boolean(node.isDraft),
    author: node.author?.login ?? '',
    updatedAt: node.updatedAt ?? null,
    verdict: verdictOf(node.latestReviews?.nodes),
  };
}

/**
 * @param {Pull} a
 * @param {Pull} b
 */
function newestFirst(a, b) {
  return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
}

/**
 * What one token's answer becomes. `mine` splits on whether anyone has answered yet; `total` is
 * GitHub's own count for the review-request lane, and the fetched count for the other two — a
 * hundred open pull requests of your own is where that stops being exact, and where a lane count
 * stops mattering.
 * @param {any} data
 * @returns {Lanes}
 */
export function splitLanes(data) {
  /** @type {Pull[]} */
  const needsReview = (data?.requested?.nodes ?? []).map(shapePull).filter(Boolean).sort(newestFirst);
  /** @type {Pull[]} */
  const mine = (data?.mine?.nodes ?? []).map(shapePull).filter(Boolean).sort(newestFirst);
  const reviewed = mine.filter((pull) => pull.verdict);
  const unreviewed = mine.filter((pull) => !pull.verdict);
  return {
    needsReview: { pulls: needsReview, total: Math.max(Number(data?.requested?.issueCount) || 0, needsReview.length) },
    reviewed: { pulls: reviewed, total: reviewed.length },
    unreviewed: { pulls: unreviewed, total: unreviewed.length },
  };
}

/**
 * Fine-grained tokens see one owner each, so every token is asked and the answers are laid over
 * one another. The same pull request from two tokens is the same URL and counts once; whatever a
 * token counted beyond what it sent was never seen, so it is added on as is.
 * @param {(Partial<Lanes> | null | undefined)[]} results
 * @returns {Lanes}
 */
export function mergeLanes(results) {
  const merged = /** @type {Lanes} */ ({});
  for (const lane of LANES) {
    const seen = new Set();
    /** @type {Pull[]} */
    const pulls = [];
    let unseen = 0;
    for (const result of results) {
      const part = result?.[lane.id];
      if (!part) continue;
      for (const pull of part.pulls ?? []) {
        const key = pull.url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        pulls.push(pull);
      }
      unseen += Math.max(0, (Number(part.total) || 0) - (part.pulls?.length ?? 0));
    }
    pulls.sort(newestFirst);
    merged[lane.id] = { pulls, total: pulls.length + unseen };
  }
  return merged;
}

/**
 * "40m", "2h", "3d", "2w" — the shortest thing that still says how stale a pull request is.
 * @param {string | null | undefined} iso
 * @param {number} [now]
 * @returns {string}
 */
export function age(iso, now = Date.now()) {
  const then = new Date(iso ?? NaN).valueOf();
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks}w`;
  return `${Math.round(days / 30)}mo`;
}

/**
 * @param {number} status
 * @param {{ message?: string, type?: string }[] | null | undefined} errors
 */
function explain(status, errors) {
  const messages = /** @type {string[]} */ ((errors ?? []).map((error) => error?.message).filter(Boolean));
  const types = new Set((errors ?? []).map((error) => error?.type).filter(Boolean));
  if (status === 401) return 'GitHub rejected the token.';
  if (status === 403 || status === 429) return 'GitHub rate-limited the request. It will try again shortly.';
  if (types.has('INSUFFICIENT_SCOPES') || messages.some((message) => /scope|permission/i.test(message))) {
    return 'The token cannot read pull requests. A classic token needs repo; a fine-grained one needs Pull requests: read-only.';
  }
  if (messages.length > 0) return `GitHub said: ${messages[0].slice(0, 160)}`;
  if (status && status !== 200) return `GitHub returned ${status}.`;
  return 'GitHub did not answer.';
}

/**
 * One token's lanes. Throws with a sentence the settings page can show as it is.
 * @param {string} token
 * @param {PullsSettings} settings
 * @returns {Promise<Lanes>}
 */
export async function fetchLanes(token, settings) {
  const body = buildQuery(settings);
  const response = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });

  /** @type {any} */
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  // A fine-grained token that cannot see pull requests gets an empty answer, not an error; a token
  // missing the scope outright gets errors beside a null data field. Both are failures here.
  if (!response.ok || !payload?.data || (payload.errors?.length > 0 && !payload.data.mine)) {
    throw new Error(explain(response.status, payload?.errors));
  }
  return splitLanes(payload.data);
}
