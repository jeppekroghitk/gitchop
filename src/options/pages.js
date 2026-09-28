/**
 * One page at a time. The rail names every page under three headings, the page chosen is the only
 * one in the layout, and the choice is kept — in the hash, so a reload lands where it left off,
 * and in localStorage, so the next visit does too. Every page stays in the document, hidden,
 * because each card's module finds its elements when it loads. The rail is buttons rather than anchors:
 * the harness loads this page into a frame under a <base>, where a #hash link would navigate the
 * frame away; here the hash is only ever written, and only where writing it is allowed.
 */
const KEY = 'gitchop:settings:page';

const rail = document.querySelector('.rail');
const items = [...rail.querySelectorAll('.rail-item')];
const panes = [...document.querySelectorAll('.pane[data-page]')];

function known(id) {
  return items.some((item) => item.dataset.page === id) ? id : null;
}

function remembered() {
  try {
    return known(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function remember(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* a page that cannot remember still pages */
  }
  try {
    if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
  } catch {
    /* the frame in the harness may refuse; the choice is still kept above */
  }
}

/** The page named, or the one remembered, or the rail's default, or the first; says which it settled on. */
export function show(id) {
  const page = known(id) ?? remembered() ?? known(rail.dataset.default) ?? items[0].dataset.page;
  for (const pane of panes) pane.hidden = pane.dataset.page !== page;
  for (const item of items) {
    if (item.dataset.page === page) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  remember(page);
  return page;
}

/**
 * The pages that can do nothing without a token are dimmed on the rail until one is saved, so the
 * rail says which pages are live before any of them is opened. The token card calls this on every
 * render, being the one that knows.
 */
export function tokenState(hasToken) {
  for (const item of items) {
    if (!('needsToken' in item.dataset)) continue;
    item.dataset.locked = String(!hasToken);
    if (hasToken) item.removeAttribute('title');
    else item.title = 'Needs a token';
  }
}

/**
 * The body of a card whose feature has no token to work with yet: one line that says so, and the
 * way to the page that fixes it — in place of controls that could only fail.
 */
export function tokenGate() {
  const wrap = document.createElement('div');
  wrap.className = 'card-body';
  const gate = document.createElement('div');
  gate.className = 'gate';
  const line = document.createElement('p');
  line.textContent = 'Needs a token.';
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn';
  go.textContent = 'Add a token →';
  go.addEventListener('click', () => {
    show('token');
    items.find((item) => item.dataset.page === 'token')?.focus();
  });
  gate.append(line, go);
  wrap.append(gate);
  return wrap;
}

export function mount() {
  for (const item of items) item.addEventListener('click', () => show(item.dataset.page));
  // Up and down walk the rail and Home and End jump to its ends, each landing on the page it names.
  rail.addEventListener('keydown', (event) => {
    const at = items.indexOf(document.activeElement);
    if (at < 0) return;
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const item = items[Math.max(0, Math.min(items.length - 1, next))];
    item.focus();
    show(item.dataset.page);
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
}
