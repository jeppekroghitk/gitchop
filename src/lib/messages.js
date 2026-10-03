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
