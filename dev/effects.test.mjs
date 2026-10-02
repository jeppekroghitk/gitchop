import assert from 'node:assert';
import { test } from 'node:test';
import * as EFFECTS from '../src/lib/effects.js';

test('stored settings are sanitised onto the sliders’ scales', () => {
  assert.deepEqual(EFFECTS.sanitize(), EFFECTS.DEFAULTS, 'nothing stored means the classic effect');
  assert.deepEqual(EFFECTS.sanitize(null), EFFECTS.DEFAULTS);
  assert.deepEqual(EFFECTS.sanitize('junk'), EFFECTS.DEFAULTS);
  assert.deepEqual(EFFECTS.sanitize({ hue: 210, tint: 70, sparks: 50 }), EFFECTS.DEFAULTS, 'retired keys are ignored');

  const stored = EFFECTS.sanitize({ colour: 400, epicness: 42.6, speed: 0 });
  assert.equal(stored.colour, 360, 'clamped to the top of the slider');
  assert.equal(stored.epicness, 43, 'rounded to whole slider steps');
  assert.equal(stored.speed, 25, 'speed can never reach zero');
  assert.equal(EFFECTS.sanitize({ epicness: '80' }).epicness, 80, 'numeric strings count as numbers');
  assert.equal(EFFECTS.sanitize({ epicness: {} }).epicness, 0, 'a non-number falls back to the default');
  assert.equal(EFFECTS.sanitize({ enabled: 0 }).enabled, 0, 'the switch can be stored off');
  assert.equal(EFFECTS.sanitize({ enabled: true }).enabled, 1, 'a boolean from older storage still counts');
  assert.equal(EFFECTS.sanitize({ enabled: 7 }).enabled, 1, 'the switch clamps to on/off');
});

// The same function holds the gist's copy before it reaches storage, and the gist is a stranger's
// until then: only the sliders' own keys come through, each a whole number on its own scale.
test('the gist’s copy comes through as the sliders’ own keys and nothing else', () => {
  const hostile = JSON.parse('{"__proto__": {"enabled": 0}, "constructor": 1, "speed": 1e400, "colour": {"hue": 9}, "x": 1}');
  assert.deepEqual(EFFECTS.sanitize(hostile), EFFECTS.DEFAULTS, 'nothing but the sliders, and nothing off their scales');
  assert.deepEqual(Object.keys(EFFECTS.sanitize(hostile)), EFFECTS.SLIDERS.map((slider) => slider.id), 'exactly the sliders, in their order');
  assert.deepEqual(EFFECTS.sanitize([1, 2, 3]), EFFECTS.DEFAULTS, 'a list is no settings at all');
  assert.equal(EFFECTS.KEY, 'effects', 'the storage key the gist and the content script share');
});

test('the whole effect can be switched off, and the switch leads the card', () => {
  const toggleSpec = EFFECTS.SLIDERS[0];
  assert.equal(toggleSpec.id, 'enabled', 'the off switch is the first control');
  assert.ok(toggleSpec.toggle, 'it renders as a switch, not a slider');
  assert.deepEqual([toggleSpec.min, toggleSpec.max, toggleSpec.value], [0, 1, 1], 'on or off, and on by default');
  assert.equal(EFFECTS.resolve({}).enabled, true, 'the effect plays unless switched off');
  assert.equal(EFFECTS.resolve({ enabled: 0 }).enabled, false, 'switched off means no animation at all');
});

test('every slider has a usable range, a default on its scale, and its settings-page text', () => {
  for (const slider of EFFECTS.SLIDERS) {
    assert.ok(slider.min < slider.max, `${slider.id} has a usable range`);
    assert.ok(slider.value >= slider.min && slider.value <= slider.max, `${slider.id} default is on its own scale`);
    assert.equal(EFFECTS.DEFAULTS[slider.id], slider.value, `${slider.id} default matches the slider spec`);
    assert.ok(slider.label && slider.hint, `${slider.id} carries its settings-page text`);
  }
});

const calm = EFFECTS.resolve({});
const slowest = EFFECTS.resolve({ speed: 25 });

test('the defaults are the classic effect', () => {
  assert.equal(calm.tint, 0, 'colour 0 is the steel blade');
  assert.equal(calm.bloomHeight, 26, 'epicness 0 keeps the classic bloom');
  assert.equal(calm.haloSize, 6, 'epicness 0 keeps the classic halo');
  assert.equal(calm.sparkCount, 0, 'no sparks until the dial moves');
  assert.equal(calm.flarePeak, 0, 'no flare until the dial moves');
  assert.ok(!('shakeAmplitude' in calm), 'the screen never shakes');
  assert.ok(!('flashPeak' in calm) && !('flashSpread' in calm), 'the screen-wide flash is gone for good');
});

// The slice follows the speed slider exactly; the aftermath trails it, so a fast slice keeps its
// slow drama. The two agree at the slowest setting, where the whole effect is one slow motion.
test('the slice follows the speed slider exactly; the aftermath trails it', () => {
  assert.equal(calm.pace, 1, 'speed 100 is the classic slice pace');
  assert.equal(slowest.pace, 4, 'the slowest slice is four times the classic');
  assert.equal(slowest.afterPace, slowest.pace, 'at the slowest speed the aftermath and the slice agree');
  assert.ok(
    calm.afterPace > slowest.afterPace * 0.7 && calm.afterPace < slowest.afterPace,
    `the classic aftermath keeps most of the slowest setting's drama (${calm.afterPace})`,
  );
  const fastest = EFFECTS.resolve({ speed: 200 });
  assert.equal(fastest.pace, 0.5, 'double speed halves the slice');
  assert.ok(
    fastest.afterPace > slowest.afterPace * 0.6,
    `even at double speed the beat after the impact barely shortens (${fastest.afterPace})`,
  );
  let quicker = slowest;
  for (const speed of [50, 100, 150, 200]) {
    const next = EFFECTS.resolve({ speed });
    assert.ok(next.afterPace < quicker.afterPace, `the aftermath still answers the dial at speed ${speed}`);
    assert.ok(next.afterPace >= next.pace, `the aftermath is never faster than the slice at speed ${speed}`);
    // The faster the blade, the larger the share of the whole effect that the beat after it is —
    // this is what keeps the dark from treading on the heels of a quick slice.
    assert.ok(
      next.afterPace / next.pace > quicker.afterPace / quicker.pace,
      `the beat after the slice grows against it at speed ${speed}`,
    );
    quicker = next;
  }
});

// The menu's beat after the impact is the user's to set, and it rides the aftermath's clock like
// the wound and the scrim do — so the wait it produces stretches with slow motion rather than
// leaving the menu to arrive into a cut that has barely opened.
test('the menu’s beat after the impact is the user’s to set, and rides the aftermath’s clock', () => {
  const delaySpec = EFFECTS.SLIDERS.find((slider) => slider.id === 'menuDelay');
  assert.equal(delaySpec.value, 140, 'the classic beat is what the slider defaults to');
  assert.equal(delaySpec.min, 0, 'the menu can rise the instant the blade leaves');
  assert.equal(calm.panelAt, 140, 'the default reproduces the beat that shipped');
  assert.equal(EFFECTS.resolve({ menuDelay: 0 }).panelAt, 0, 'no wait at all is a setting');
  assert.equal(EFFECTS.sanitize({ menuDelay: 9000 }).menuDelay, delaySpec.max, 'the wait cannot run away');
  assert.equal(EFFECTS.sanitize({ menuDelay: -50 }).menuDelay, 0, 'nor can it go negative');
  for (const speed of [25, 100, 200]) {
    const at = EFFECTS.resolve({ speed, menuDelay: 200 });
    assert.equal(at.panelAt, 200, `the setting itself is untouched by speed ${speed}`);
    assert.ok(at.panelAt * at.afterPace > 200, `the wait it produces keeps the aftermath's drama at speed ${speed}`);
  }
  assert.ok(
    EFFECTS.resolve({ speed: 25, menuDelay: 140 }).panelAt * slowest.afterPace >
      calm.panelAt * calm.afterPace,
    'slow motion holds the menu back longer than the classic pace does',
  );
});

test('any colour above zero tints the blade', () => {
  const painted = EFFECTS.resolve({ colour: 210 });
  assert.equal(painted.hue, 210);
  assert.ok(painted.tint > 0, 'any colour above zero tints the blade');
});

test('the colour control is named swatches, each a distinct, valid, visible choice', () => {
  const colourSpec = EFFECTS.SLIDERS.find((slider) => slider.id === 'colour');
  assert.equal(colourSpec.swatches, EFFECTS.SWATCHES, 'the colour control renders the shared swatches');
  assert.ok(EFFECTS.SWATCHES.length >= 6, 'a real choice of swatches');
  assert.deepEqual(EFFECTS.SWATCHES[0], { name: 'steel', value: 0 }, 'steel leads and is the default');
  // The chips are laid out nine to a row, so a part-filled row would leave a ragged gap on the card.
  assert.equal(EFFECTS.SWATCHES.length % 9, 0, `the swatches fill whole rows of nine (${EFFECTS.SWATCHES.length})`);
  const seenValues = new Set();
  for (const swatch of EFFECTS.SWATCHES) {
    assert.ok(swatch.name && typeof swatch.name === 'string', 'every swatch has a name to show');
    assert.ok(!seenValues.has(swatch.value), `${swatch.name} is a distinct colour`);
    seenValues.add(swatch.value);
    assert.equal(EFFECTS.sanitize({ colour: swatch.value }).colour, swatch.value, `${swatch.name} survives sanitize`);
    const tinted = EFFECTS.resolve({ colour: swatch.value });
    if (swatch.value === 0) assert.equal(tinted.tint, 0, 'steel stays untinted');
    else assert.ok(tinted.tint > 0, `${swatch.name} tints the blade`);
  }
});

// Two chips a viewer cannot tell apart are one chip and a lie, so every pair of hues keeps its
// distance around the wheel — steel is exempt: it is the achromatic one, not a hue.
test('every pair of hues keeps its distance around the wheel', () => {
  const hues = EFFECTS.SWATCHES.filter((swatch) => swatch.value !== 0);
  for (const one of hues) {
    for (const other of hues) {
      if (one === other) continue;
      const apart = Math.abs(one.value - other.value) % 360;
      assert.ok(
        Math.min(apart, 360 - apart) >= 15,
        `${one.name} and ${other.name} are too close to tell apart (${one.value}° vs ${other.value}°)`,
      );
    }
  }
});

const mid = EFFECTS.resolve({ epicness: 55 });

test('the dial is staged: glow and sparks lead, the flare joins from the middle', () => {
  const early = EFFECTS.resolve({ epicness: 20 });
  assert.ok(early.bloomHeight > calm.bloomHeight, 'glow grows from the first stretch');
  assert.ok(early.sparkCount > 0, 'sparks arrive early');
  assert.equal(early.flarePeak, 0, 'the flare sleeps until mid-dial');
  assert.ok(mid.flarePeak > 0, 'the flare has joined by the middle');
});

test('no channel ever shrinks across the dial, and once one has woken it keeps climbing', () => {
  let previous = calm;
  for (const epicness of [25, 50, 75, 100]) {
    const next = EFFECTS.resolve({ epicness });
    for (const key of ['bloomHeight', 'haloSize', 'sparkCount', 'sparkEnergy', 'flarePeak', 'flareHeight']) {
      if (previous[key] > calm[key]) {
        assert.ok(next[key] > previous[key], `${key} still grows at epicness ${epicness}`);
      } else {
        assert.ok(next[key] >= previous[key], `${key} never shrinks at epicness ${epicness}`);
      }
    }
    previous = next;
  }
});

test('the top of the dial is unmistakably different from a timid middle', () => {
  const full = EFFECTS.resolve({ epicness: 100 });
  assert.ok(full.bloomHeight >= 130, `full bloom is a blaze (${full.bloomHeight}px)`);
  assert.ok(full.sparkCount >= 150, `full sparks are a storm (${full.sparkCount})`);
  assert.ok(full.sparkEnergy >= 2.5, `full sparks fly hard (${full.sparkEnergy})`);
  assert.equal(full.flarePeak, 1, 'the full flare burns at its brightest');
  assert.ok(full.flareHeight >= 400, `the full flare erupts tall from the cut (${full.flareHeight}px)`);
  assert.ok(full.sparkCount >= 2 * mid.sparkCount, 'the top half of the dial doubles the sparks');
});
