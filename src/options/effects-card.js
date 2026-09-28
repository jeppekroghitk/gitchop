import { api } from '../lib/links.js';

/**
 * The chop itself is previewed with the real thing: options.html loads the content-script stage
 * (effects.js, styles.js, chop.js) as classic scripts, so this card can run the exact animation
 * the next keypress on GitHub will play — over the settings page instead of over GitHub.
 */
const gc = window.__gitchop;
const { KEY, SLIDERS, DEFAULTS, sanitize, resolve } = gc.EFFECTS;

const host = document.getElementById('effects');
const statusEl = document.getElementById('effects-status');

let effects = { ...DEFAULTS };
let saveTimer = null;
let lastWritten = '';
let statusTimer = null;
let stage = null;
let slidersEl = null;
const updaters = new Map();

function flash(text) {
  statusEl.textContent = text;
  statusEl.dataset.shown = 'true';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.dataset.shown = 'false';
  }, 1400);
}

async function commit() {
  clearTimeout(saveTimer);
  saveTimer = null;
  effects = sanitize(effects);
  lastWritten = JSON.stringify(effects);
  try {
    await api.storage.sync.set({ [KEY]: effects });
    flash('saved');
  } catch (error) {
    flash('save failed');
    console.error('gitchop: could not save the effect settings', error);
  }
}

function scheduleCommit() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(commit, 400);
}

function shown(spec, value) {
  if (spec.toggle) return value === 1 ? 'on' : 'off';
  if (spec.swatches) return spec.swatches.find((swatch) => swatch.value === value)?.name ?? `${value}°`;
  if (spec.id === 'speed') return `${value}%`;
  // The stored delay is on the aftermath's clock, which the speed slider stretches; the number
  // worth reading is the wait it actually produces, so it is the one shown.
  if (spec.id === 'menuDelay') return `${Math.round(value * resolve(effects).afterPace)} ms`;
  return String(value);
}

function reflect() {
  for (const update of updaters.values()) update();
  if (slidersEl) slidersEl.dataset.off = String(effects.enabled === 0);
}

function chipColour(value) {
  return value === 0 ? '#f2f5f8' : `hsl(${value} 75% 60%)`;
}

function buildToggle(spec) {
  const row = document.createElement('div');
  row.className = 'slider slider-toggle';
  row.title = spec.hint;

  const label = document.createElement('span');
  label.className = 'slider-label';
  label.id = `fx-${spec.id}-label`;
  label.textContent = spec.label;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-labelledby', label.id);
  button.addEventListener('click', () => {
    effects[spec.id] = effects[spec.id] === 1 ? 0 : 1;
    reflect();
    commit();
  });

  const output = document.createElement('output');

  updaters.set(spec.id, () => {
    const on = effects[spec.id] === 1;
    button.dataset.on = String(on);
    button.setAttribute('aria-checked', String(on));
    output.textContent = shown(spec, effects[spec.id]);
  });
  row.append(label, button, output);
  return row;
}

function buildSwatches(spec) {
  const row = document.createElement('div');
  row.className = 'slider';
  row.title = spec.hint;

  const label = document.createElement('span');
  label.className = 'slider-label';
  label.textContent = spec.label;

  const chips = document.createElement('div');
  chips.className = 'swatches';
  chips.setAttribute('role', 'radiogroup');
  chips.setAttribute('aria-label', spec.label);

  const output = document.createElement('output');

  const buttons = new Map();
  for (const swatch of spec.swatches) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'swatch';
    chip.style.background = chipColour(swatch.value);
    chip.title = swatch.name;
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-label', swatch.name);
    chip.addEventListener('click', () => {
      effects[spec.id] = swatch.value;
      reflect();
      commit();
    });
    buttons.set(swatch.value, chip);
    chips.append(chip);
  }

  updaters.set(spec.id, () => {
    for (const [value, chip] of buttons) {
      const selected = value === effects[spec.id];
      chip.dataset.selected = String(selected);
      chip.setAttribute('aria-checked', String(selected));
      chip.disabled = effects.enabled === 0;
    }
    output.textContent = shown(spec, effects[spec.id]);
  });
  row.append(label, chips, output);
  return row;
}

function buildSlider(spec) {
  if (spec.toggle) return buildToggle(spec);
  if (spec.swatches) return buildSwatches(spec);

  const row = document.createElement('div');
  row.className = 'slider';
  row.title = spec.hint;

  const label = document.createElement('label');
  label.textContent = spec.label;
  label.htmlFor = `fx-${spec.id}`;

  const input = document.createElement('input');
  input.type = 'range';
  input.id = `fx-${spec.id}`;
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = '1';

  const output = document.createElement('output');
  output.htmlFor = input.id;

  // Every row is redrawn, not just this one: the menu delay is shown in real milliseconds, so
  // dragging speed changes a number that lives on another row.
  input.addEventListener('input', () => {
    effects[spec.id] = Number(input.value);
    reflect();
    scheduleCommit();
  });
  input.addEventListener('change', commit);

  updaters.set(spec.id, () => {
    input.value = String(effects[spec.id]);
    input.disabled = effects.enabled === 0;
    output.textContent = shown(spec, effects[spec.id]);
  });
  row.append(label, input, output);
  return row;
}

/**
 * The options page never loads menu.js — there is no GitHub page to read a context from — so the
 * preview raises an empty shell of the panel instead, on the stage's own schedule. Without it the
 * menu delay would be the one setting the preview could not show: a beat between two things, with
 * only the first of them on screen.
 */
function standIn() {
  const panel = document.createElement('div');
  panel.className = 'gc-panel';
  panel.setAttribute('aria-hidden', 'true');

  const head = document.createElement('div');
  head.className = 'gc-head';
  const title = document.createElement('span');
  title.className = 'gc-title';
  title.textContent = 'Links';
  head.append(title);

  const filter = document.createElement('input');
  filter.className = 'gc-filter';
  filter.type = 'text';
  filter.placeholder = 'Filter links, or search repositories…';
  filter.readOnly = true;
  filter.tabIndex = -1;

  const list = document.createElement('ul');
  list.className = 'gc-list';

  const foot = document.createElement('div');
  foot.className = 'gc-foot';
  const keys = document.createElement('span');
  keys.className = 'gc-keys';
  for (const [key, label] of [['enter', 'open'], ['esc', 'close']]) {
    const hint = document.createElement('span');
    hint.className = 'gc-hint';
    const chip = document.createElement('kbd');
    chip.className = 'gc-key';
    chip.textContent = key;
    hint.append(chip, document.createTextNode(label));
    keys.append(hint);
  }
  foot.append(keys);

  panel.append(head, filter, list, foot);
  return panel;
}

/**
 * Plays the current slider values, saved or not, and cleans up by itself; a click or Escape ends
 * it early. Guarded so a second press while one is running does nothing.
 */
function preview() {
  if (stage) return;
  const fx = sanitize(effects);
  const play = resolve(fx);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const running = gc.createStage({ reduced, effects: fx });
  stage = running;

  let linger = null;
  function onKey(event) {
    if (event.key === 'Escape') close();
  }
  function close() {
    if (stage !== running) return;
    stage = null;
    clearTimeout(linger);
    window.removeEventListener('keydown', onKey);
    running.close();
  }
  running.menuLayer.addEventListener('mousedown', close);
  window.addEventListener('keydown', onKey);

  const panel = standIn();
  running.menuLayer.append(panel);

  // The stage itself says when the dark has settled and when the menu has arrived, so the preview
  // leaves on its own the moment the effect is over. The hold after that is only the beat the last
  // ember needs at this speed. Nothing here restates the stage's timings: a guess that outlives
  // the animation is a black screen the user has to click away, and a guess that undercuts it
  // would cut off the very delay being tuned.
  Promise.all([running.chop(), running.revealPanel(panel)]).then(() => {
    if (stage !== running) return;
    linger = setTimeout(close, play.enabled ? 220 * play.afterPace : 320);
  });
}

function render() {
  const sliders = document.createElement('div');
  sliders.className = 'sliders';
  slidersEl = sliders;
  for (const spec of SLIDERS) sliders.append(buildSlider(spec));

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'btn btn-primary';
  previewBtn.textContent = 'Preview chop';
  previewBtn.addEventListener('click', preview);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn';
  reset.textContent = 'Restore defaults';
  reset.addEventListener('click', () => {
    effects = { ...DEFAULTS };
    reflect();
    commit();
  });

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  foot.append(previewBtn, reset);

  host.append(sliders, foot);
  reflect();
}

export async function load() {
  try {
    const stored = await api.storage.sync.get(KEY);
    effects = sanitize(stored[KEY]);
  } catch {
    effects = { ...DEFAULTS };
  }
  lastWritten = JSON.stringify(effects);
  render();

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[KEY]) return;
    const incoming = JSON.stringify(sanitize(changes[KEY].newValue));
    if (incoming === lastWritten || saveTimer) return;
    effects = sanitize(changes[KEY].newValue);
    reflect();
  });

  window.addEventListener('beforeunload', () => {
    if (saveTimer) commit();
  });
}
