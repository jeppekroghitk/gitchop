import { api } from '../lib/links.js';
import { requestAccess } from '../lib/signin-flow.js';
import { CONSENT_HASH } from '../lib/welcome.js';
import { createWelcome } from './flow.js';

/**
 * The welcome's page of its own, which the toolbar button opens until the user has signed in or
 * put the welcome aside, and Settings links to. A new user meets the same welcome in the "."
 * overlay the first time they press the key on GitHub; both are drawn by ./flow.js. Here, unlike
 * in a content script, the browser's prompt for access can be shown, inside the click — which is
 * why the overlay opens this page at CONSENT_HASH when the prompt is still owed, and why the page
 * then closes itself and brings the GitHub tab that opened it back to the front.
 */

/**
 * Back to the GitHub tab that opened this one, and this one closed. Neither needs the tabs
 * permission: openerTabId is not one of the fields it guards, and a tab may be brought forward
 * and closed by id.
 * @returns {Promise<boolean>} whether there was a tab to go back to
 */
async function returnToOpener() {
  try {
    const tab = await api.tabs.getCurrent();
    if (tab?.id === undefined || tab.openerTabId === undefined) return false;
    await api.tabs.update(tab.openerTabId, { active: true });
    await api.tabs.remove(tab.id);
    return true;
  } catch {
    return false;
  }
}

const welcome = createWelcome({
  variant: 'page',
  at: location.hash === CONSENT_HASH ? 'consent' : 'hello',
  access: async () => ((await requestAccess()) ? 'granted' : 'denied'),
  returnToOpener,
});
document.body.append(welcome.element);
welcome.start();
