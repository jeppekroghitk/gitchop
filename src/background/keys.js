/**
 * The background's own keys in storage.local, in one place below every feature, because forgetting
 * a token's last traces touches all of them at once and no feature should have to import another
 * to name what it keeps. The keys in storage.sync belong to the features in src/lib that define
 * them.
 */
export const CONFIG_KEY = 'sync';
export const INDEX_KEY = 'index';
export const PULLS_CACHE_KEY = 'pullsCache';
export const RATE_KEY = 'rateCache';
export const NEWS_CACHE_KEY = 'newsCache';
export const CONTRIB_CACHE_KEY = 'contributionsCache';
/** In storage.session, not storage.local: the sign-in under way. */
export const SIGNIN_KEY = 'signin';
/** In storage.session: the tab gitchop opened GitHub's install page in, and the tab it came from. */
export const INSTALL_TAB_KEY = 'installTab';
/** The welcome was finished, or put aside with Continue without signing in. */
export const WELCOMED_KEY = 'welcomed';
/** The menu's quiet sign-in row was waved away. */
export const HINT_KEY = 'menuHintDismissed';
