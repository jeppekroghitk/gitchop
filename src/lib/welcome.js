/**
 * The welcome: says what signing in unlocks and carries the sign-in out, one decision per screen.
 * Nothing opens on install; a new user meets it the first time they press "." on GitHub, inside
 * the overlay, after the chop. Its page of its own is behind the toolbar button and in Settings.
 * Two marks in storage.local, named in src/background/keys.js, record the user's own answers: no
 * to signing in, and the quiet sign-in row in the menu waved away. Both are set only by the user,
 * and forgotten when a working sign-in or token arrives, so losing it later asks again. Nothing
 * here touches the extension API, so the rules run under plain node.
 */

/** The page, relative to the package root, as runtime.getURL takes it. */
export const WELCOME_PAGE = 'src/welcome/welcome.html';

/**
 * The page opened at this hash shows only the browser's question — the hosts, and on Firefox the
 * consent to hold a token — for the overlay, which cannot ask it, and hands the user back.
 */
export const CONSENT_HASH = '#consent';

/** The first version with the welcome. Whoever updates from an older one already knows gitchop. */
export const WELCOME_SINCE = '2.10.0';

/**
 * What decides both: how many working tokens are saved — a sign-in GitHub has since refused, or
 * whose app was removed, does not count — and the two marks.
 * @typedef {{ tokens: number, welcomed: boolean, hintDismissed: boolean }} WelcomeFacts
 */

/**
 * Whether the welcome is owed: someone with no working sign-in or token who has not said no to
 * signing in. Then the "." overlay shows it in place of the menu, and the toolbar button opens its
 * page rather than Settings. A sign-in that stops working brings it back.
 * @param {Partial<WelcomeFacts> | null | undefined} facts
 * @returns {boolean}
 */
export function opensWelcome(facts) {
  return (facts?.tokens ?? 0) === 0 && !facts?.welcomed;
}

/**
 * Whether the menu ends in the quiet row that points at the sign-in: while there is nothing to
 * search private repositories with, until the row is waved away. Putting the welcome aside does
 * not hide it; the row is the one reminder left once the welcome is gone.
 * @param {Partial<WelcomeFacts> | null | undefined} facts
 * @returns {boolean}
 */
export function showsMenuHint(facts) {
  return (facts?.tokens ?? 0) === 0 && !facts?.hintDismissed;
}

/**
 * Whether an update came from a version without the welcome: its users have pressed the key for
 * months, and their next press must still be the menu. A version that cannot be read counts as
 * old, since every version that can be installed now reads.
 * @param {string | undefined} previous
 * @returns {boolean}
 */
export function predatesWelcome(previous) {
  const parts = (version) => String(version ?? '').split('.').map((part) => Number.parseInt(part, 10));
  const was = parts(previous);
  if (was.some((part) => !Number.isFinite(part))) return true;
  const since = parts(WELCOME_SINCE);
  for (let i = 0; i < since.length; i += 1) {
    const a = was[i] ?? 0;
    if (a !== since[i]) return a < since[i];
  }
  return false;
}

/**
 * What a press of the key does in a tab, decided from what the tab already knows, with nothing
 * awaited: the welcome; the menu; or, while the tab has not heard yet whether the welcome is owed,
 * the menu's data first — it carries the same answer — and then whichever it says. Once the menu
 * has been shown in a tab, that tab never greets: a welcome after the menu would be a step back.
 * @param {{ owed: boolean | null, menuSeen: boolean }} known
 * @returns {'welcome' | 'menu' | 'ask'}
 */
export function onPress({ owed, menuSeen }) {
  if (menuSeen || owed === false) return 'menu';
  return owed ? 'welcome' : 'ask';
}
