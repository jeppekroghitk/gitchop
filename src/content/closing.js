import CSS from './closing.css';
import { node } from './dom.js';

/**
 * A notice on GitHub's device page once the sign-in it was opened for is done: the tab closes by
 * itself, and this says when, so it does not vanish from under the user. Keep open stops the
 * count, and the tab is then the user's to close. The visible count is hidden from screen readers,
 * which hear the sentence once at the start and once at the end rather than every second.
 * @param {number} seconds
 * @param {() => Promise<boolean>} close Asks for the close; resolves to whether the tab is closing.
 */
export function showClosing(seconds, close) {
  const host = document.createElement('gitchop-closing');
  host.style.position = 'fixed';
  host.style.top = '16px';
  host.style.left = '50%';
  host.style.transform = 'translateX(-50%)';
  host.style.width = 'max-content';
  host.style.maxWidth = 'calc(100vw - 32px)';
  host.style.zIndex = '2147483000';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;

  const box = node('div', 'gc-closing');
  const spoken = node('p', 'gc-closing-spoken');
  spoken.setAttribute('role', 'status');
  const shown = node('p', 'gc-closing-text');
  shown.setAttribute('aria-hidden', 'true');
  const keep = node('button', 'gc-closing-keep', 'Keep open');
  keep.type = 'button';
  const bar = node('div', 'gc-closing-bar');
  bar.style.animationDuration = `${seconds}s`;
  box.append(spoken, shown, keep, bar);
  shadow.append(style, box);
  document.documentElement.append(host);

  /** @param {string} sentence */
  const say = (sentence) => {
    shown.textContent = sentence;
    spoken.textContent = sentence;
  };
  /** @param {number} left */
  const counting = (left) => `Signed in to gitchop. This tab closes in ${left} second${left === 1 ? '' : 's'}.`;

  let left = seconds;
  say(counting(left));
  const timer = setInterval(() => {
    left -= 1;
    if (left > 0) {
      shown.textContent = counting(left);
      return;
    }
    clearInterval(timer);
    keep.remove();
    shown.textContent = 'Signed in to gitchop. Closing this tab…';
    close().then((closing) => {
      if (!closing) say('Signed in to gitchop. You can close this tab.');
    });
  }, 1000);

  keep.addEventListener('click', () => {
    clearInterval(timer);
    keep.remove();
    bar.remove();
    say('Signed in to gitchop. This tab stays open.');
  });
}
