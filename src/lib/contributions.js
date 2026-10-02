const GRAPHQL = 'https://api.github.com/graphql';

export const SETTINGS_KEY = 'contributions';

/** How many whole years before this one are asked for, for the hover. */
export const YEARS_BACK = 3;

/** @typedef {{ enabled: number }} ContribSettings */

/**
 * One calendar year as GitHub is asked for it; `from` and `to` are ISO stamps.
 * @typedef {{ year: number, from: string, to: string }} YearWindow
 */

/**
 * One token's answer: whose it is, this year's total, and every year that came back, newest first.
 * @typedef {{ login: string, total: number, years: { year: number, total: number }[] }} Contributions
 */

/** One entry per control on the settings card; `value` is the default. */
export const SWITCHES = [
  {
    id: 'enabled',
    label: 'Contributions',
    value: 1,
    hint: 'Off takes the number out of the menu; the head of the panel is the title alone, as it was.',
  },
];

export const DEFAULTS = Object.fromEntries(SWITCHES.map((item) => [item.id, item.value]));

/**
 * Storage is shared state: whatever shape comes back, every switch ends up on or off.
 * @param {unknown} [raw]
 * @returns {ContribSettings}
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
  return /** @type {ContribSettings} */ (settings);
}

/**
 * A calendar year as the person lives it — local time, which is also the clock GitHub's own
 * calendar has drawn its squares by since it learned about time zones. `from` is the first instant
 * of January the 1st; `to` is now for this year and the last instant of December the 31st for a
 * year that is over. GitHub allows at most a year between the two, which a calendar year never
 * exceeds. Half past midnight on New Year's Day is the new year here even while UTC is still on
 * the old one.
 * @param {number} [now]
 * @param {number} [back]
 * @returns {YearWindow}
 */
export function yearWindow(now = Date.now(), back = 0) {
  const at = new Date(now);
  const year = at.getFullYear() - back;
  const from = new Date(year, 0, 1, 0, 0, 0, 0);
  const to = back === 0 ? at : new Date(new Date(year + 1, 0, 1, 0, 0, 0, 0).valueOf() - 1);
  return { year, from: from.toISOString(), to: to.toISOString() };
}

/**
 * This year and the `back` before it, newest first.
 * @param {number} [now]
 * @param {number} [back]
 * @returns {YearWindow[]}
 */
export function yearWindows(now = Date.now(), back = YEARS_BACK) {
  return Array.from({ length: back + 1 }, (_, index) => yearWindow(now, index));
}

/**
 * One request for every year: each is its own aliased field, so a year GitHub refuses comes back
 * null beside the others rather than sinking the answer. The calendar total is what the profile
 * page prints under the graph, so it is the figure the person already knows; the breakdown into
 * commits, reviews and the rest does not add up to it exactly and is left out rather than
 * explained. The account's birthday says which of the years asked for existed at all.
 * @param {YearWindow[]} windows
 */
export function buildQuery(windows) {
  const params = windows.map((_, index) => `$from${index}: DateTime!, $to${index}: DateTime!`).join(', ');
  const fields = windows
    .map((_, index) => `    y${index}: contributionsCollection(from: $from${index}, to: $to${index}) { contributionCalendar { totalContributions } }`)
    .join('\n');
  /** @type {Record<string, string>} */
  const variables = {};
  windows.forEach((window, index) => {
    variables[`from${index}`] = window.from;
    variables[`to${index}`] = window.to;
  });
  return {
    query: `query(${params}) {\n  viewer {\n    login\n    createdAt\n${fields}\n  }\n}`,
    variables,
  };
}

/**
 * What one token's answer becomes: whose it is, this year's total, and every year that came back,
 * newest first. This year missing is a failure; a past year missing is a year left out. A year
 * before the account existed is not a year of nought, it is no year at all, so it is left out too.
 * @param {any} data
 * @param {YearWindow[] | null | undefined} windows
 * @returns {Contributions | null}
 */
export function shapeContributions(data, windows) {
  const viewer = data?.viewer;
  if (!viewer || typeof viewer !== 'object') return null;
  /** @type {(index: number) => number} */
  const totalOf = (index) => Number(viewer[`y${index}`]?.contributionCalendar?.totalContributions);
  if (!Number.isFinite(totalOf(0))) return null;

  const since = new Date(viewer.createdAt ?? Number.NaN).getFullYear();
  /** @type {{ year: number, total: number }[]} */
  const years = [];
  (windows ?? []).forEach((window, index) => {
    const total = totalOf(index);
    if (!Number.isFinite(total)) return;
    if (Number.isFinite(since) && window.year < since) return;
    years.push({ year: window.year, total: Math.max(0, Math.round(total)) });
  });
  return { login: String(viewer.login ?? '').trim(), total: years[0]?.total ?? Math.max(0, Math.round(totalOf(0))), years };
}

/**
 * A classic token sees every repository the account can reach and a fine-grained one sees a single
 * owner's, so two tokens can count the same year differently. The highest count for this year is
 * the closest to what the profile shows: a repository a token cannot see is left out of its count,
 * never counted twice, so the largest answer is the most complete one — and its past years go with it.
 * @param {(Contributions | null | undefined)[] | null | undefined} results
 * @returns {Contributions | null}
 */
export function bestOf(results) {
  /** @type {Contributions | null} */
  let best = null;
  for (const result of results ?? []) {
    if (!result || !Number.isFinite(result.total)) continue;
    if (!best || result.total > best.total) best = result;
  }
  return best;
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
    return 'The token cannot read your contributions. A classic token with repo can; a fine-grained one counts only what it is allowed to see.';
  }
  if (messages.length > 0) return `GitHub said: ${messages[0].slice(0, 160)}`;
  if (status && status !== 200) return `GitHub returned ${status}.`;
  return 'GitHub did not answer.';
}

/**
 * One token's count for every window. Throws with a sentence the settings page can show as it is.
 * @param {string} token
 * @param {YearWindow[]} windows
 * @returns {Promise<Contributions>}
 */
export async function fetchContributions(token, windows) {
  const response = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(buildQuery(windows)),
  });

  /** @type {any} */
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const shaped = shapeContributions(payload?.data, windows);
  if (!response.ok || !shaped) throw new Error(explain(response.status, payload?.errors));
  return shaped;
}
