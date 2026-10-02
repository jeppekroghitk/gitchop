// First, so every request any other module makes passes through the rate gauge's fetch; then the
// sign-in's, which renews a rejected sign-in and asks again, wrapped around the gauge's so the
// gauge sees both tries.
import './rate.js';
import './app-token.js';
import { DEFAULT_LINKS, api, loadLinks, saveLinks, withIds } from '../lib/links.js';
import { SETTINGS_KEY as PULLS_SETTINGS_KEY } from '../lib/pulls.js';
import { SETTINGS_KEY as NEWS_SETTINGS_KEY } from '../lib/news.js';
import { paintAction } from './action.js';
import { hasUsableToken } from './config.js';
import { CONFIG_KEY } from './keys.js';
import { answer } from './messages.js';
import { NEWS_ALARM, refreshNews, scheduleNews } from './news.js';
import { PULLS_ALARM, refreshPulls, schedulePulls } from './pulls.js';
import { SIGNIN_ALARM, pollSignIn } from './signin.js';
import { noteBackedUpChange, pull } from './sync.js';
import { sealLegacyTokens } from './tokens.js';

/**
 * The gist is the durable copy; storage.sync is the working copy the menu reads, so the menu opens
 * instantly and offline. Everything in storage.sync is in the gist — the links, and every setting
 * beside them: the panel switches, the pull request switches, the news subscriptions and edition
 * hour, the chop — so a fresh profile is the old one after a pull. Tokens live in storage.local —
 * never in storage.sync, which would ship them to Mozilla's servers, and never in the gist — and
 * every request to GitHub happens here in the background, so no page context ever sees one.
 *
 * This is the background's entry, and it does nothing but wire the browser's events to the
 * features in this directory. Every listener is added synchronously, on the first pass through
 * this file: a Firefox event page or a Chrome service worker woken by an event hands that event
 * only to the listeners already there when the script finishes, so one added after an await would
 * miss the very event that woke it.
 */

api.runtime.onMessage.addListener(answer);

api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const existing = await loadLinks();
    if (existing.length === 0) await saveLinks(withIds(DEFAULT_LINKS));
  }
  pull().catch(() => {});
  schedulePulls();
  scheduleNews();
  refreshNews().catch(() => {});
});

// The browser was shut at the edition hour more often than not; the edition is made up on the
// way in, so it is there before the key is pressed.
api.runtime.onStartup?.addListener(() => {
  pull().catch(() => {});
  schedulePulls();
  scheduleNews();
  refreshNews().catch(() => {});
});

api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === PULLS_ALARM) refreshPulls().catch(() => {});
  // A sign-in left waiting when its tab was closed is finished, or dropped, from here.
  if (alarm.name === SIGNIN_ALARM) pollSignIn().catch(() => {});
  if (alarm.name === NEWS_ALARM) {
    refreshNews()
      .catch(() => {})
      .finally(() => scheduleNews());
  }
});

api.action.onClicked.addListener(() => {
  api.runtime.openOptionsPage();
});

sealLegacyTokens().catch(() => {});

api.permissions.onAdded?.addListener(() => paintAction());
api.permissions.onRemoved?.addListener(() => paintAction());
api.runtime.onStartup?.addListener(() => paintAction());
paintAction();

api.storage.onChanged.addListener((changes, area) => {
  // The pull request switches live in sync storage so they travel with the profile; a token arriving or
  // leaving is a local change, and so is a sign-in GitHub refused or one signed in again. Either way
  // the alarm and the badge follow.
  const tokensChanged =
    area === 'local' &&
    changes[CONFIG_KEY] &&
    ((changes[CONFIG_KEY].oldValue?.tokens?.length ?? 0) !== (changes[CONFIG_KEY].newValue?.tokens?.length ?? 0) ||
      hasUsableToken(changes[CONFIG_KEY].oldValue) !== hasUsableToken(changes[CONFIG_KEY].newValue));
  if ((area === 'sync' && changes[PULLS_SETTINGS_KEY]) || tokensChanged) {
    schedulePulls().then(() => paintAction()).catch(() => {});
  }
  // The subscriptions and the hour travel with the profile too, so an edit on another machine
  // re-arms the alarm here.
  if (area === 'sync' && changes[NEWS_SETTINGS_KEY]) scheduleNews().catch(() => {});
  noteBackedUpChange(changes, area);
});
