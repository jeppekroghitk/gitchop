/**
 * The chop's settings, in one place for everything that reads them: the content script plays them,
 * the settings page edits and previews them, and the background holds the gist's copy to the same
 * scales before it is let into storage.
 */
export const KEY = 'effects';

/**
 * The chop's settings as stored, each a whole number on its slider's scale.
 * @typedef {{ enabled: number, colour: number, epicness: number, speed: number, menuDelay: number }} EffectsSettings
 */

/**
 * The colour control is these named chips rather than a hue slider — a swatch you can see beats
 * a number of degrees. The stored value is still a hue (steel is the special 0), so any hue that
 * arrives from elsewhere keeps working; these are just the ones the page offers. The chips lay
 * out nine to a row, so the list comes in nines: the first row is the coarse sweep of the wheel
 * that shipped, the second fills the gaps between those, and both read left to right in hue
 * order. Every chromatic hue sits at least 15° from every other, or the chips stop being
 * distinguishable and the second row is just decoration.
 */
export const SWATCHES = [
  { name: 'steel', value: 0 },
  { name: 'crimson', value: 360 },
  { name: 'ember', value: 25 },
  { name: 'gold', value: 48 },
  { name: 'emerald', value: 140 },
  { name: 'cyan', value: 180 },
  { name: 'azure', value: 210 },
  { name: 'violet', value: 275 },
  { name: 'pink', value: 320 },
  { name: 'citron', value: 72 },
  { name: 'lime', value: 96 },
  { name: 'fern', value: 118 },
  { name: 'jade', value: 160 },
  { name: 'sky', value: 195 },
  { name: 'cobalt', value: 232 },
  { name: 'indigo', value: 253 },
  { name: 'magenta', value: 300 },
  { name: 'rose', value: 340 },
];

/**
 * One entry per control on the settings page; `value` is the default. The defaults reproduce the
 * effect exactly as it shipped before it was configurable, so nothing changes until a control
 * moves. An entry with `swatches` renders as chips instead of a slider; one with `toggle`
 * renders as an on/off switch.
 */
export const SLIDERS = [
  { id: 'enabled', label: 'Effect', min: 0, max: 1, value: 1, toggle: true, hint: 'Off skips the whole animation: the dot opens the menu instantly.' },
  { id: 'colour', label: 'Colour', min: 0, max: 360, value: 0, swatches: SWATCHES, hint: 'Steel is the classic blade; any other swatch paints the blade, sparks and light.' },
  { id: 'epicness', label: 'Epicness', min: 0, max: 100, value: 0, hint: 'From a clean quiet cut to a full action scene: more glow, then sparks, then light bursting from the cut.' },
  { id: 'speed', label: 'Speed', min: 25, max: 200, value: 100, hint: '100 is the classic pace; lower is slow motion. The slice follows it exactly, the aftermath keeps its drama at any speed.' },
  { id: 'menuDelay', label: 'Menu delay', min: 0, max: 400, value: 140, hint: 'How long the menu waits after the blade leaves the screen. At 0 it rises the instant the cut lands; at the top it waits for the dark to settle first. Shown as the real wait at the current speed.' },
];

export const DEFAULTS = Object.fromEntries(SLIDERS.map((slider) => [slider.id, slider.value]));

/**
 * Storage is shared state: whatever shape comes back, every value ends up on its slider's scale.
 * @param {unknown} [raw]
 * @returns {EffectsSettings}
 */
export function sanitize(raw) {
  /** @type {Record<string, unknown>} */
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {Record<string, number>} */
  const effects = {};
  for (const { id, min, max, value } of SLIDERS) {
    const number = Number(source[id]);
    effects[id] = Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : value;
  }
  return /** @type {EffectsSettings} */ (effects);
}

/**
 * What the sliders mean, in the stage's units. The epicness dial is staged rather than linear:
 * the glow deepens from the first notch, sparks arrive early, and the flare joins from the
 * middle — so every part of the range reads differently, and 100 is unmistakably not 60. The
 * flare is a burst of light along the cut itself; there is no screen-wide flash at any setting.
 * @param {unknown} [raw]
 */
export function resolve(raw) {
  const fx = sanitize(raw);
  const e = fx.epicness / 100;
  /** @type {(from: number, to: number, power?: number) => number} */
  const stage = (from, to, power = 1) => Math.min(1, Math.max(0, (e - from) / (to - from))) ** power;
  const flare = stage(0.25, 0.9);
  const pace = 100 / fx.speed;
  const slowest = 100 / /** @type {(typeof SLIDERS)[number]} */ (SLIDERS.find((slider) => slider.id === 'speed')).min;
  return {
    enabled: fx.enabled === 1,
    // The slice runs at the slider's pace exactly. The aftermath — the wound, the flare, the
    // embers, the menu — follows the slider only a fifth of the way (in log space), pinned so
    // the two coincide at the slowest setting: speed 25 is untouched, while a fast slice keeps
    // its slow, deliberate endarkening instead of racing past it. This exponent is what sets
    // the beat between the blade leaving the screen and the dark arriving: the flatter it is,
    // the more of the effect that beat is at speed, which is where a short one shows.
    pace,
    afterPace: slowest * (pace / slowest) ** 0.2,
    // Measured from the impact on the aftermath's clock, like the wound and the scrim are, so
    // the menu keeps its place in the sequence at every speed: a slider that named a fixed
    // number of milliseconds would have the menu arrive into a barely-opened cut in slow
    // motion. The settings page multiplies it out and shows the real wait.
    panelAt: fx.menuDelay,
    hue: fx.colour,
    tint: fx.colour === 0 ? 0 : 80,
    bloomHeight: Math.round(26 + 110 * stage(0, 1, 1.3)),
    haloSize: Math.round(6 + 14 * e),
    sparkCount: Math.round(170 * stage(0.08, 1, 1.25)),
    sparkEnergy: 1 + 1.8 * e,
    flarePeak: flare,
    flareHeight: Math.round(120 + 300 * flare),
  };
}
