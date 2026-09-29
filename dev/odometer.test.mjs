import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../src/content/odometer.js', import.meta.url)), 'utf8');

/**
 * Just enough of a DOM for the reels: elements with children, a class, a style, a dataset, and
 * listeners that can be fired by hand. Transitions do not run here — what is tested is where each
 * reel is told to go and when, which is the whole of the arithmetic.
 */
class Style {
  constructor() {
    this.transform = '';
    this.transition = '';
    this.vars = {};
  }
  setProperty(name, value) {
    this.vars[name] = value;
  }
}

class Element {
  constructor(tag) {
    this.tag = tag;
    this.className = '';
    this.children = [];
    this.attributes = {};
    this.style = new Style();
    this.dataset = {};
    this.listeners = {};
    this.text = '';
  }
  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  fire(type) {
    for (const listener of this.listeners[type] ?? []) listener({ type });
  }
  get offsetWidth() {
    return 0;
  }
}

function load({ reduced = false } = {}) {
  const window = {};
  const document = { createElement: (tag) => new Element(tag) };
  const matchMedia = () => ({ matches: reduced });
  new Function('window', 'document', 'matchMedia', source)(window, document, matchMedia);
  return window.__gitchop.createOdometer();
}

// The strip is a blank and then one more run of the digits than the last reel has turns — as many
// as bring its travel nearest to eight digits a second: cell 0 is blank, digit d is cell 1 + d in
// the first run, 11 + d in the second, and so on.
const BLANK = 1;
const reels = (odo) => odo.element.children.filter((child) => child.className === 'gc-odo-digit').map((digit) => digit.children[0]);
const at = (odo) => reels(odo).map((reel) => Number(reel.dataset.at));
const showing = (odo) => at(odo).map((index) => (index < BLANK ? ' ' : String((index - BLANK) % 10))).join('');
const shape = (odo) => odo.element.children.map((child) => (child.className === 'gc-odo-digit' ? 'd' : '?')).join('');
const percent = (reel) => reel.style.transform;
const ms = (reel, name) => Number.parseInt(reel.style.vars[name] ?? '0', 10);
const durations = (odo) => reels(odo).map((reel) => ms(reel, '--gc-odo-roll'));
const delays = (odo) => reels(odo).map((reel) => ms(reel, '--gc-odo-delay'));
const eases = (odo) => reels(odo).map((reel) => reel.style.vars['--gc-odo-ease']);
const SPIN_EASE = 'cubic-bezier(0.35, 0.35, 0.6, 1)';
const TICK_EASE = 'cubic-bezier(0.2, 0.7, 0.15, 1)';
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 5, `${message}: ${actual} is not within 5 of ${expected}`);
const settleAll = (odo) => reels(odo).forEach((reel) => reel.fire('transitionend'));

// Before the panel is on screen the reels stand blank, whatever has been set.
let odo = load();
odo.set(1234);
assert.equal(shape(odo), 'dddd', 'four reels and nothing between them: no comma, no gap');
assert.deepEqual(at(odo), [0, 0, 0, 0], 'blank until revealed');
assert.equal(showing(odo), '    ');
assert.equal(reels(odo)[0].children.length, 21, 'a blank and two runs: the last reel spins 1.35 s, about eleven digits, one turn at most, and a run to tick into');
assert.equal(reels(odo)[0].children[0].textContent, '', 'the first cell is the blank');
assert.equal(reels(odo)[0].children[1].textContent, '0');
assert.equal(reels(odo)[0].children[20].textContent, '9');
assert.equal(odo.element.attributes['aria-hidden'], 'true', 'the reels are decoration; the label around them reads');

// A later set before the reveal only changes where the reels will stop.
odo.set(1226);
assert.deepEqual(at(odo), [0, 0, 0, 0]);

// Revealed: every reel sets off at once and stops in turn — the first as good as at once, each to
// its right 400 ms after the one before, at about eight digits a second: on these digits every
// reel goes straight to its digit, the later ones having the time for a turn only on a low digit.
odo.reveal();
assert.deepEqual(at(odo), [2, 3, 3, 7], 'no whole turn on a one, a two, a two or a six');
assert.equal(showing(odo), '1226');
assert.equal(percent(reels(odo)[3]), 'translateY(-33.33%)', 'a cell is a twenty-first of the strip');
assert.deepEqual(durations(odo), [150, 550, 950, 1350], 'they stop 400 ms apart, the first almost at once');
assert.deepEqual(delays(odo), [0, 0, 0, 0], 'and all start together');
assert.deepEqual(eases(odo), [SPIN_EASE, SPIN_EASE, SPIN_EASE, SPIN_EASE], 'flat out, then the brake');
for (const reel of reels(odo)) assert.ok(Number(reel.dataset.landAt) > 0, 'each reel knows when it stops');
assert.equal(reels(odo)[3].style.transition, '', 'the roll uses the stylesheet transition');

// A number arriving while the reels are still turning keeps every stop where it was and only
// changes the digit each reel stops on.
odo.set(1234);
assert.deepEqual(at(odo), [2, 3, 4, 15], 'the same stops, new digits — and the fourth has time for a turn on a four where it had none on a six');
assert.equal(showing(odo), '1234');
const left = durations(odo);
near(left[0], 150, 'the first still stops when it was going to');
near(left[1], 550, 'so does the second');
near(left[3], 1350, 'and the fourth');
assert.deepEqual(delays(odo), [0, 0, 0, 0]);
assert.deepEqual(eases(odo), [SPIN_EASE, SPIN_EASE, SPIN_EASE, SPIN_EASE]);

// Stopped: each reel is put back into the first run, standing on the same digit, and is ready to tick.
settleAll(odo);
assert.deepEqual(at(odo), [2, 3, 4, 5]);
assert.equal(showing(odo), '1234');
assert.deepEqual(durations(odo), [600, 600, 600, 600]);
assert.deepEqual(eases(odo), [TICK_EASE, TICK_EASE, TICK_EASE, TICK_EASE]);
for (const reel of reels(odo)) assert.equal(reel.dataset.landAt, undefined);
assert.equal(reels(odo)[3].style.transition, '', 'settling is instant, and the transition is handed back afterwards');

// A refresh that lands higher is a tick: straight to the digit, always upward, so six to four goes
// up through the nine into the second run — and is put back once the roll ends.
odo.set(1246);
assert.deepEqual(at(odo), [2, 3, 5, 7]);
odo.set(1254);
assert.deepEqual(at(odo), [2, 3, 6, 15], 'the tens up one; the units up eight, through the nine');
assert.deepEqual(durations(odo), [600, 600, 600, 600], 'a tick has one pace');
assert.deepEqual(delays(odo), [0, 0, 0, 0], 'and no wait');
reels(odo)[3].fire('transitionend');
assert.deepEqual(at(odo), [2, 3, 6, 5]);
assert.equal(showing(odo), '1254');

// Ticks that come before the last one settled climb the strip; a reel at its top end drops a run first.
odo.set(1259);
assert.deepEqual(at(odo), [2, 3, 6, 10]);
odo.set(1253);
assert.deepEqual(at(odo), [2, 3, 6, 14], 'nine to three: up four, into the second run');
odo.set(1259);
assert.deepEqual(at(odo), [2, 3, 6, 20], 'three to nine within the second run');
reels(odo)[3].dataset.at = '20';
odo.set(1252);
assert.deepEqual(at(odo), [2, 3, 6, 13], 'from the last cell, a nine: no room above, so back to the first run and up three');
assert.equal(showing(odo), '1252');

// More digits: new reels are built around the old number, right-aligned, the new one blank — and it
// rolls straight onto its digit while the rest roll on from theirs. The strip grows a run with them.
odo.set(10000);
assert.equal(shape(odo), 'ddddd');
assert.equal(reels(odo)[0].children.length, 21, 'two runs for five reels: the fifth spins 1.75 s, about fourteen digits, one turn at most');
assert.deepEqual(at(odo), [2, 11, 11, 11, 11], 'blank straight to one; one, two, five and two each up to the nought that begins the second run');
assert.equal(showing(odo), '10000');
assert.deepEqual(durations(odo), [600, 600, 600, 600, 600], 'a tick, not a spin');

// Fewer digits again is a rebuild too, standing on the tail of the old number.
odo.set(99);
assert.equal(shape(odo), 'dd');
assert.equal(reels(odo)[0].children.length, 21, 'two runs for two reels: the second spins just over half a second, one turn at most');
assert.deepEqual(at(odo), [10, 10], 'from the two noughts at the end of ten thousand, up nine each');

// Not known yet is a shimmer; a number arriving afterwards spins in like a first one.
odo.set(null);
assert.equal(odo.element.children.length, 1);
assert.equal(odo.element.children[0].className, 'gc-bar gc-odo-bar');
odo.set(7);
assert.equal(shape(odo), 'd');
assert.deepEqual(at(odo), [8], 'straight onto seven: a first reel has no time for a turn');
assert.deepEqual(durations(odo), [150], 'as good as at once, being the first');
settleAll(odo);
assert.deepEqual(at(odo), [8]);
odo.set(9);
assert.deepEqual(at(odo), [10], 'a change to a number already showing is a tick, not a spin');
assert.deepEqual(durations(odo), [600]);
odo.set(Number.NaN);
assert.equal(odo.element.children[0].className, 'gc-bar gc-odo-bar', 'not a number is not known');

// Edges: nought is a number, a negative is nought, a numeric string is a number, fractions are floored.
odo = load();
odo.reveal();
odo.set(0);
assert.deepEqual(at(odo), [1], 'off the blank onto the nought');
settleAll(odo);
assert.deepEqual(at(odo), [1]);
odo.set(-5);
assert.deepEqual(at(odo), [1]);
odo.set('12');
assert.equal(showing(odo), '12');
odo.set(12.9);
assert.equal(showing(odo), '12');
odo.set(1000000);
assert.equal(shape(odo), 'ddddddd', 'seven reels, nothing between them');
assert.equal(showing(odo), '1000000');
assert.equal(reels(odo)[0].children.length, 31, 'three runs for seven reels: the seventh spins 2.55 s, about twenty digits, two turns at most');

// Reduced motion: no holding, no spinning, no rolling — the digits are placed the moment they are known.
odo = load({ reduced: true });
odo.set(42);
assert.deepEqual(at(odo), [5, 3], 'placed at once in the first run, with nothing to reveal');
assert.equal(showing(odo), '42');
odo.set(49);
odo.set(51);
assert.deepEqual(at(odo), [6, 2], 'always the first run: nothing rolls, so nothing needs settling');
odo.reveal();
assert.deepEqual(at(odo), [6, 2]);

console.log('odometer ok');
