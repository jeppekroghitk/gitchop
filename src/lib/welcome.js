/**
 * The welcome: a page of its own that opens on install, says what gitchop is and what the one
 * gesture is, and offers the sign-in before anything else. Two marks in storage.local, named in
 * src/background/keys.js, decide where a new user is pointed afterwards, and both are only ever
 * set, never derived: the welcome was finished or put aside, and the quiet sign-in row in the menu
 * was waved away. Nothing here touches the extension API, so the rules run under plain node.
 */

/** The page, relative to the package root, as runtime.getURL takes it. */
export const WELCOME_PAGE = 'src/welcome/welcome.html';

/**
 * What decides both: how many tokens are saved — a sign-in counts, even one GitHub has since
 * refused, since whoever has one has already been through the sign-in — and the two marks.
 * @typedef {{ tokens: number, welcomed: boolean, hintDismissed: boolean }} WelcomeFacts
 */

/**
 * Whether the toolbar button opens the welcome rather than Settings: only for someone who has
 * neither signed in, nor saved a token, nor put the welcome aside.
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
