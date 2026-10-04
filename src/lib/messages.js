import { api } from './links.js';

/** @import { Message, MessageType, Reply } from '../background/messages.js' */

/**
 * One message to the background, from the menu or the settings page. The protocol is the
 * background's table of handlers, so a type it has no handler for, or a field missing that the
 * handler reads, is a type error here rather than a silent no-answer in the browser. Undefined is
 * the background not answering at all; a throw is the extension gone from under the page.
 * @template {MessageType} T
 * @param {Message<T>} message
 * @returns {Promise<Reply<T> | undefined>}
 */
export function send(message) {
  return api.runtime.sendMessage(message);
}

/**
 * Has a link to one of GitHub's pages opened by the background instead, so it can close the tab
 * again once that page has done its job. A modified click is left to the browser, as for any
 * link, and so is the background not answering: the page then opens as a plain new tab.
 * @param {HTMLAnchorElement} link
 * @param {'gitchop:install:open'} type
 */
export function openThroughBackground(link, type) {
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const plain = () => globalThis.open(link.href, '_blank', 'noreferrer');
    send({ type }).then((reply) => {
      if (!(reply?.ok && reply.opened)) plain();
    }, plain);
  });
  return link;
}
