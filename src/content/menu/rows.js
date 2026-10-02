/**
 * The menu's pure parts: what goes in which row, and in what order, worked out from the
 * background's answers alone. Nothing here touches the page, so the tests import it under plain
 * node, and nothing here may come to: the modules beside it build the rows these describe.
 */
import { isSafeUrl } from '../../lib/links.js';

/**
 * The rows under Repositories: the index's matches, then GitHub's, without repeats — and an
 * exact owner/repository, from either, first of all. Typing leantime/leantime must land on
 * Leantime/leantime even when the index holds five other leantime things whose names contain
 * the words; the index is favoured, but not over the one repository that was named outright.
 * A github.com address pasted whole counts as its owner/repository.
 */
export function orderRepos(query, local, remote, limit) {
  const wanted = String(query ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  const seen = new Set();
  const merged = [];
  for (const repo of [...(local ?? []), ...(remote ?? [])]) {
    const key = String(repo?.fullName ?? '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(repo);
  }
  const exact = merged.findIndex((repo) => repo.fullName.toLowerCase() === wanted);
  if (exact > 0) merged.unshift(...merged.splice(exact, 1));
  return merged.slice(0, limit);
}

/**
 * The pull request column as a list of keyed rows, in the order it is drawn: each lane's heading,
 * then every pull request it holds, the quiet line when it holds none, and the tail that points
 * at GitHub past what was fetched — or its skeletons, before the snapshot. A failure before any
 * lane has loaded is one line in place of them all. The key is what a row *is*, so a refresh can
 * tell a row that is still there from one that is gone: the same pull request in the same lane
 * keeps its row however its title or age moved, and one that crossed to another lane is a row
 * leaving there and one arriving here.
 */
export function laneRows(data) {
  const lanes = data?.lanes ?? [];
  const loaded = lanes.some((lane) => lane.pulls !== null);
  if (!loaded && data?.error) return [{ key: 'error', kind: 'error', text: data.error }];
  const rows = [];
  for (const lane of lanes) {
    rows.push({ key: `section:${lane.id}`, kind: 'section', lane });
    if (lane.pulls === null) {
      for (let slot = 0; slot < lane.slots; slot += 1) rows.push({ key: `ghost:${lane.id}:${slot}`, kind: 'ghost', lane, slot });
      continue;
    }
    for (const pull of lane.pulls) rows.push({ key: `pull:${lane.id}:${String(pull.url).toLowerCase()}`, kind: 'pull', lane, pull });
    if (lane.pulls.length === 0) rows.push({ key: `empty:${lane.id}`, kind: 'empty', lane, text: lane.empty });
    if (lane.total > lane.pulls.length && isSafeUrl(lane.all)) {
      rows.push({ key: `more:${lane.id}`, kind: 'more', lane, url: lane.all, count: lane.total - lane.pulls.length });
    }
  }
  return rows;
}

/** Between two paints of the column: the keys that go, and the keys that come, each in drawn order. */
export function diffRows(before, after) {
  const was = new Set(before);
  const now = new Set(after.map((row) => row.key));
  return {
    gone: before.filter((key) => !now.has(key)),
    added: after.filter((row) => !was.has(row.key)).map((row) => row.key),
  };
}

/** How long until an allowance turns: seconds under a minute, else minutes, and the hour at most. */
export function countdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes}m` : '1h';
}

/**
 * The gauge's bars from the background's answer, as of now: each budget's share of its allowance
 * used — as a fraction for the bar, which fills from nothing to the limit, and as whole percent
 * for the figure, rounded up so that nought means untouched — with the count used, and how long
 * until the allowance turns. One whose turn has passed since it was read is back at nothing,
 * nothing having been charged to it since, and has no count-down. The scope is named only when
 * there is more than one to tell apart. A bar is high past nine tenths used, which is where a
 * busy afternoon starts to show.
 */
export function gaugeRows(state, now = Date.now()) {
  const scopes = state?.scopes ?? [];
  const rows = [];
  for (const scope of scopes) {
    for (const entry of scope.resources ?? []) {
      const limit = Math.max(1, Number(entry.limit) || 0);
      const turning = Number(entry.resetAt) > now;
      const remaining = turning ? Math.max(0, Math.min(limit, Number(entry.remaining) || 0)) : limit;
      const used = limit - remaining;
      const share = used / limit;
      rows.push({
        scope: scopes.length > 1 ? scope.label : '',
        name: entry.label,
        used,
        limit,
        share,
        percent: Math.ceil(share * 100),
        resetIn: turning ? countdown(entry.resetAt - now) : '',
        high: share >= 0.9,
      });
    }
  }
  return rows;
}

/**
 * The panel — the links and the search — is the menu unless switched off in Settings; then the
 * columns stand on their own, the news alone if that is all that is on. It is never nothing:
 * with no column to stand, the panel stays whatever the switch says.
 */
export function standsPanel(panelSetting, pulls, news) {
  return panelSetting?.show !== false || !(pulls?.show || (Boolean(news?.show) && (news?.repos?.length ?? 0) > 0));
}
