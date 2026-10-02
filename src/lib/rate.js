/**
 * What is left of GitHub's budgets. Every answer from GitHub says, in its headers, how much of the
 * allowance for the budget it was charged to remains and when that allowance comes back, so the
 * budgets are read off the answers rather than asked for. GitHub meters by user, not by token:
 * readings are kept by the login a token belongs to, and the few requests made with no token
 * under a name of their own.
 */

/** The scope of a request made with no token: GitHub meters those by address, and far more tightly. */
export const ANONYMOUS = 'anonymous';

/**
 * The budgets gitchop draws on, in the order the gauge lists them, by GitHub's own names — the
 * GraphQL allowance goes on the pull requests and the year's contributions, the REST allowance on
 * the news, the index and the gist, and the search allowance on typing a repository. Any other
 * budget GitHub names comes after, as named.
 */
export const RESOURCES = [
  { id: 'graphql', label: 'graphql' },
  { id: 'core', label: 'rest' },
  { id: 'search', label: 'search' },
];

/** What one answer says about the budget it was charged to, or null when it says nothing. */
export function readRate(headers, now = Date.now()) {
  const get = (name) => headers?.get?.(name) ?? null;
  // A header that is not there is not a number, whatever Number makes of null.
  const num = (name) => (get(name) == null ? NaN : Number(get(name)));
  const limit = num('x-ratelimit-limit');
  const remaining = num('x-ratelimit-remaining');
  const reset = num('x-ratelimit-reset');
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining) || !Number.isFinite(reset) || reset <= 0) return null;
  const used = num('x-ratelimit-used');
  return {
    resource: String(get('x-ratelimit-resource') || 'core').trim().toLowerCase(),
    limit,
    remaining: Math.max(0, Math.min(limit, remaining)),
    used: Number.isFinite(used) ? used : limit - remaining,
    resetAt: reset * 1000,
    at: now,
  };
}

/**
 * The table with one reading laid in. Answers come back in any order: within one allowance the
 * lowest remaining is the latest word, and a reading from an allowance already turned over is no
 * word at all. The table is returned as it was when the reading adds nothing.
 */
export function noteRate(table, scope, reading) {
  if (!reading || !scope) return table;
  const scoped = table?.[scope] ?? {};
  const previous = scoped[reading.resource];
  if (previous) {
    if (previous.resetAt > reading.resetAt) return table;
    if (previous.resetAt === reading.resetAt && previous.remaining <= reading.remaining) return table;
  }
  const { limit, remaining, used, resetAt, at } = reading;
  return { ...table, [scope]: { ...scoped, [reading.resource]: { limit, remaining, used, resetAt, at } } };
}

/** The scope a token's readings are kept under: its login, or its id until GitHub has said who it is. */
export function scopeOf(token) {
  return String(token?.login || token?.id || '');
}

/**
 * The budgets as the gauge lists them: this profile's tokens by login, in their order and each
 * once, then the nameless requests — and only those with a reading on file. A budget that is
 * not in the table has not been drawn on since the table was started, and has no line.
 */
export function presentRate(table, tokens) {
  const scopes = [];
  const seen = new Set();
  for (const token of tokens ?? []) {
    const id = scopeOf(token);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    scopes.push({ id, label: token.login || 'token' });
  }
  scopes.push({ id: ANONYMOUS, label: 'no token' });
  return scopes
    .map((scope) => ({ ...scope, resources: presentResources(table?.[scope.id]) }))
    .filter((scope) => scope.resources.length > 0);
}

function presentResources(scoped) {
  if (!scoped || typeof scoped !== 'object') return [];
  const known = RESOURCES.map((entry) => entry.id);
  const ids = [...known.filter((id) => id in scoped), ...Object.keys(scoped).filter((id) => !known.includes(id)).sort()];
  return ids.map((id) => {
    const reading = scoped[id];
    return {
      id,
      label: RESOURCES.find((entry) => entry.id === id)?.label ?? id,
      limit: Number(reading.limit) || 0,
      remaining: Number(reading.remaining) || 0,
      resetAt: Number(reading.resetAt) || 0,
    };
  });
}
