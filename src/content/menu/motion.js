/**
 * A pull request leaving the column is checked off before it goes: its glyph becomes a tick and
 * the row brightens, held this long so the tick is seen; then its line sweeps out to the right
 * while the lane closes up under it. Several leaving at once go one after another, this far
 * apart, so each is seen to go. What arrives — a lane's quiet line once its last row has left, a
 * pull request new since the snapshot — unfolds once the leaving is done. A beat is left after
 * the panel is up before any of it starts, so the list as it was is seen first; and should the
 * panel never say it is up, the answer is painted anyway after a while.
 */
const LEAVE_HOLD = 220;
const LEAVE_SWEEP = 240;
export const LEAVE_STAGGER = 70;
const ARRIVE = 260;
export const ARRIVE_STAGGER = 50;
export const LEAVE_BEAT = 180;
export const REVEAL_AT_MOST = 4000;
const EASE_SETTLE = 'cubic-bezier(0.2, 0.7, 0.15, 1)';
const EASE_AWAY = 'cubic-bezier(0.5, 0, 0.75, 0.2)';
const EASE_CLOSE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** How long a refresh's departures take, all of them, so what arrives waits until they are done. */
export function leavingFor(count) {
  return count > 0 ? LEAVE_HOLD + LEAVE_SWEEP + (count - 1) * LEAVE_STAGGER : 0;
}

/**
 * A row on its way out. A pull request is checked off first — the glyph becomes a tick and the
 * row brightens, as a line on a list is ticked before it is struck — then its line sweeps out
 * to the right while the row closes to nothing, and the lane under it moves up to meet what is
 * left. A lane's tail or quiet line simply closes. Reduced motion is a fade. The row left the
 * map as it set off; it leaves the list the moment it is out.
 */
export function leave(record, delay, reduced) {
  const { li, item, icon } = record;
  li.dataset.leaving = 'true';
  if (item) item.dataset.active = 'false';
  const gone = () => li.remove();
  if (reduced) {
    li.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay, easing: 'ease-out', fill: 'forwards' }).finished.then(gone, gone);
    return;
  }
  const checked = record.kind === 'pull';
  const hold = checked ? LEAVE_HOLD : 0;
  if (checked) {
    setTimeout(() => {
      icon.textContent = '✓';
      icon.dataset.done = 'true';
      icon.animate(
        [
          { transform: 'scale(0.4)', opacity: 0 },
          { transform: 'scale(1.25)', opacity: 1, offset: 0.55 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 220, easing: EASE_SETTLE },
      );
    }, delay);
    item.animate([{ background: 'rgba(255, 255, 255, 0.1)' }, { background: 'transparent' }], {
      duration: hold + LEAVE_SWEEP,
      delay,
      easing: 'ease-out',
      fill: 'backwards',
    });
  }
  // The line and the row end together: a row that had faded but still stood would leave a
  // hole where it was until it had closed, and a lane losing many at once a dark gap.
  li.style.overflow = 'hidden';
  if (item) {
    item.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(18px)', opacity: 0 }], {
      duration: LEAVE_SWEEP,
      delay: delay + hold,
      easing: EASE_AWAY,
      fill: 'forwards',
    });
  }
  li.animate([openBox(li), CLOSED_BOX], {
    duration: LEAVE_SWEEP - 60,
    delay: delay + hold + 60,
    easing: EASE_CLOSE,
    fill: 'forwards',
  }).finished.then(gone, gone);
}

/**
 * A row's box as it stands, and closed. A pull request's row is a bare wrapper, but a lane's
 * quiet line is its own row with padding and a floor of its own, which a height of nothing
 * leaves standing — so the fold takes those to nothing too.
 */
const CLOSED_BOX = { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px' };
function openBox(li) {
  const style = getComputedStyle(li);
  return { height: `${li.offsetHeight}px`, minHeight: '0px', paddingTop: style.paddingTop, paddingBottom: style.paddingBottom };
}

/** A row that is new: it unfolds to its height, and its line comes in a touch behind the fold. */
export function arrive(record, delay, reduced) {
  const { li, item } = record;
  if (reduced) {
    li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay, easing: 'ease-out', fill: 'backwards' });
    return;
  }
  li.style.overflow = 'hidden';
  const settle = () => {
    li.style.overflow = '';
  };
  li.animate([CLOSED_BOX, openBox(li)], { duration: ARRIVE, delay, easing: EASE_SETTLE, fill: 'backwards' }).finished.then(settle, settle);
  (item ?? li).animate([{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], {
    duration: ARRIVE,
    delay: delay + 80,
    easing: EASE_SETTLE,
    fill: 'backwards',
  });
}
