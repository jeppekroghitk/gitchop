import { api } from '../lib/links.js';
import { hasUsableToken, readConfig } from './config.js';
import { readPullsCache, readPullsSettings } from './pulls-store.js';

/**
 * The toolbar icon carries one of two things. Firefox hands out host permissions on request rather
 * than at install, and Chrome lets them be narrowed to "on click" afterwards; either way the content
 * script then never runs and the "." key simply does nothing, so a missing grant is a red "!" that
 * points at the page that fixes it, and it wins over everything else. Otherwise, with the badge
 * switched on, it is the number of pull requests that need your review — before the key is
 * pressed.
 */
export async function paintAction() {
  /** @type {boolean} */
  let granted;
  try {
    granted = await api.permissions.contains({ origins: ['https://github.com/*'] });
  } catch {
    return;
  }

  let text = '';
  let title = 'gitchop — settings';
  let color = '#c0473b';
  if (!granted) {
    text = '!';
    title = 'gitchop — needs access to github.com; click to fix';
  } else {
    // A count kept from before the sign-in was refused is no longer news, and the column it
    // points at is hidden until there is a token again.
    const [settings, cache, config] = await Promise.all([readPullsSettings(), readPullsCache().catch(() => null), readConfig()]);
    const waiting = hasUsableToken(config) ? (cache?.lanes?.needsReview?.total ?? 0) : 0;
    if (settings.badge === 1 && settings.enabled === 1 && waiting > 0) {
      text = waiting > 99 ? '99+' : String(waiting);
      title = `gitchop — ${waiting} waiting on you`;
      color = '#3b4249';
    }
  }

  try {
    await api.action.setBadgeText({ text });
    await api.action.setBadgeBackgroundColor?.({ color });
    await api.action.setBadgeTextColor?.({ color: '#ffffff' });
    await api.action.setTitle({ title });
  } catch {
    /* older browsers may not offer badges on the action */
  }
}
