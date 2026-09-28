window.__gitchop = window.__gitchop || {};

window.__gitchop.CSS = `
:host {
  color-scheme: dark;
  font: 400 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --gc-panel: #0b0d10;
  --gc-line: rgba(255, 255, 255, 0.09);
  --gc-edge: rgba(255, 255, 255, 0.5);
  --gc-text: #e8edf2;
  --gc-dim: #7d8894;
  --gc-heading: #b3bcc6;
  --gc-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --gc-blade-hi: rgba(255, 255, 255, 0.92);
  --gc-blade-lo: rgba(255, 255, 255, 0.5);
  --gc-blade-halo: rgba(255, 255, 255, 0.55);
  --gc-glint-hi: #fff;
  --gc-glint-mid: rgba(255, 255, 255, 0.55);
  --gc-bloom-hi: rgba(255, 255, 255, 0.26);
  --gc-bloom-lo: rgba(255, 255, 255, 0.1);
  --gc-spark: #fff;
  --gc-spark-halo: rgba(255, 255, 255, 0.7);
  --gc-flare: #fff;
  --gc-halo-size: 6px;
  --gc-pr-row: 32px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.gc-scrim {
  position: fixed;
  inset: 0;
  background: radial-gradient(120% 90% at 50% 45%, rgba(9, 11, 14, 0.95), rgba(2, 3, 4, 0.985));
  backdrop-filter: blur(4px) saturate(0.65);
  opacity: 0;
}

.gc-menu-layer {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.gc-wipe {
  position: fixed;
  top: 50%;
  left: 50%;
  opacity: 0;
  pointer-events: none;
  background: linear-gradient(180deg, transparent, rgba(9, 11, 14, 0.97) 6%, rgba(9, 11, 14, 0.97) 94%, transparent);
}

.gc-edge {
  position: fixed;
  top: 50%;
  left: 50%;
  height: 2px;
  opacity: 0;
  pointer-events: none;
  background: linear-gradient(90deg, var(--gc-blade-hi), var(--gc-blade-lo));
  filter: drop-shadow(0 0 var(--gc-halo-size) var(--gc-blade-halo));
}

.gc-cut {
  position: fixed;
  top: 50%;
  left: 50%;
  height: 2px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  background: linear-gradient(90deg, var(--gc-blade-hi), var(--gc-blade-lo));
  filter: drop-shadow(0 0 var(--gc-halo-size) var(--gc-blade-halo));
}

.gc-glint {
  position: absolute;
  top: -3px;
  bottom: -3px;
  background: linear-gradient(90deg, var(--gc-glint-hi), var(--gc-glint-hi) 12%, var(--gc-glint-mid) 55%, transparent);
}

.gc-bloom {
  position: fixed;
  top: 50%;
  left: 50%;
  height: 26px;
  opacity: 0;
  pointer-events: none;
  background: linear-gradient(90deg, var(--gc-bloom-hi), var(--gc-bloom-lo));
  filter: blur(11px);
}

.gc-sparks {
  position: fixed;
  top: 50%;
  left: 50%;
  height: 0;
  pointer-events: none;
}

.gc-spark {
  position: absolute;
  top: -1px;
  opacity: 0;
  background: var(--gc-spark);
  box-shadow: 0 0 6px var(--gc-spark-halo);
}

.gc-flare {
  position: fixed;
  top: 50%;
  left: 50%;
  opacity: 0;
  pointer-events: none;
  background: radial-gradient(50% 50% at 50% 50%, var(--gc-flare), transparent 72%);
  filter: blur(14px);
}

/*
 * The stage is the slab the chop raises: the panel alone, or the panel with the news on its left
 * and the pull requests on its right. Every column stretches to the same height, so their bottoms
 * align whatever is in them. The widths are what the columns want; a viewport just short of them
 * squeezes all three a little before one has to go.
 */
.gc-stage {
  display: flex;
  align-items: stretch;
  gap: 16px;
  width: min(460px, 100%);
  opacity: 0;
}

.gc-stage[data-pulls="true"] {
  width: min(916px, 100%);
}

.gc-stage[data-news="true"] {
  width: min(876px, 100%);
}

.gc-stage[data-news="true"][data-pulls="true"] {
  width: min(1332px, 100%);
}

.gc-panel,
.gc-pulls,
.gc-news {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--gc-panel);
  border: 1px solid var(--gc-line);
  box-shadow: 0 30px 70px -20px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.6);
  color: var(--gc-text);
}

.gc-panel {
  flex: 0 1 460px;
}

.gc-pulls {
  flex: 0 1 440px;
}

/* In the tree whenever the news is on; in the layout only while something is subscribed. */
.gc-news {
  flex: 0 1 400px;
  display: none;
}

.gc-stage[data-news="true"] .gc-news {
  display: flex;
}

/* Three columns need this much; below it the news steps out first, being the newer arrival. */
@media (max-width: 1279px) {
  .gc-stage[data-pulls="true"] .gc-news {
    display: none;
  }

  .gc-stage[data-news="true"][data-pulls="true"] {
    width: min(916px, 100%);
  }
}

/* Below this there is no room beside the panel at all; the menu is exactly what it was. */
@media (max-width: 979px) {
  .gc-pulls,
  .gc-stage[data-news="true"] .gc-news {
    display: none;
  }

  .gc-stage[data-pulls="true"],
  .gc-stage[data-news="true"],
  .gc-stage[data-news="true"][data-pulls="true"] {
    width: min(460px, 100%);
  }
}

/*
 * The panel switched off in Settings: the columns stand on their own, at their own widths, and no
 * rule about room beside the panel applies — there is no panel to be beside. The stage holds the
 * keys then, so it may be focused, quietly.
 */
.gc-stage[data-panel="false"] {
  width: min(440px, 100%);
}

.gc-stage[data-panel="false"][data-news="true"] {
  width: min(400px, 100%);
}

.gc-stage[data-panel="false"][data-pulls="true"] {
  width: min(440px, 100%);
}

.gc-stage[data-panel="false"][data-news="true"][data-pulls="true"] {
  width: min(856px, 100%);
}

.gc-stage[data-panel="false"] .gc-pulls,
.gc-stage[data-panel="false"][data-news="true"] .gc-news,
.gc-stage[data-panel="false"][data-news="true"][data-pulls="true"] .gc-news {
  display: flex;
}

.gc-stage:focus {
  outline: none;
}

/* In a column's head the count sits by the title; the news keeps its own right-hand fact. */
.gc-news .gc-count {
  margin-left: 0;
}

.gc-panel::before,
.gc-pulls::before,
.gc-news::before {
  content: "";
  position: absolute;
  top: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--gc-edge), transparent);
}

.gc-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 13px 15px 11px;
  border-bottom: 1px solid var(--gc-line);
}

.gc-title {
  font: 600 11px/1 var(--gc-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gc-heading);
}

/*
 * The year's contributions, in the head beside the title, as the profile prints them. Each digit
 * is a reel: a strip of glyphs sliding behind a window one digit tall, so a change rolls rather
 * than blinks and the first paint spins in like a slot machine's once the panel is on screen, every
 * reel turning at once and stopping in turn, the first at once and each next one a beat later. The strip
 * moves by a percentage of its own height, so the digit's size is written once, here, and the
 * head stays exactly as tall as its title. It is not a link: hovering it hangs the years before
 * this one beneath, and that is all.
 */
.gc-count {
  margin-left: auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: inherit;
  white-space: nowrap;
  cursor: default;
}

.gc-odo {
  display: inline-flex;
  align-items: center;
  height: 11px;
  font: 600 12px/11px var(--gc-mono);
  font-variant-numeric: tabular-nums;
  color: var(--gc-text);
}

.gc-odo-digit {
  display: block;
  height: 11px;
  overflow: hidden;
}

/* The script times each reel's roll, so they spin together and stop one at a time. */
.gc-odo-reel {
  display: block;
  transition: transform var(--gc-odo-roll, 600ms) var(--gc-odo-ease, cubic-bezier(0.2, 0.7, 0.15, 1));
  transition-delay: var(--gc-odo-delay, 0ms);
  will-change: transform;
}

.gc-odo-reel > span {
  display: block;
  height: 11px;
  line-height: 11px;
}

.gc-odo-bar {
  width: 2.8em;
  height: 7px;
}

.gc-count-label {
  font: 400 10px/1 var(--gc-mono);
  letter-spacing: 0.03em;
  color: var(--gc-dim);
}

/* Taken down when there is no number to show; the class above would otherwise outrank the attribute. */
.gc-count[hidden] {
  display: none;
}

/* Lit while the mouse is on it, since the years before this one hang under it then. */
.gc-count:hover .gc-count-label {
  color: var(--gc-text);
}

.gc-filter {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--gc-line);
  background: transparent;
  color: var(--gc-text);
  font: 400 15px/1.2 inherit;
  padding: 13px 15px;
  outline: none;
}

.gc-filter::placeholder {
  color: var(--gc-dim);
}

.gc-list {
  list-style: none;
  height: min(48vh, 344px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.16) transparent;
}

.gc-list::-webkit-scrollbar {
  width: 8px;
}

.gc-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.16);
}

.gc-item {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 8px 15px 8px 13px;
  border-left: 2px solid transparent;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}

.gc-item[data-active="true"] {
  background: rgba(255, 255, 255, 0.05);
  border-left-color: #fff;
}

.gc-item[data-blocked="true"] {
  cursor: default;
  opacity: 0.42;
}

.gc-item[data-owned="true"] {
  border-left-color: rgba(255, 255, 255, 0.22);
}

.gc-item[data-owned="true"][data-active="true"] {
  border-left-color: #fff;
}

.gc-item--ghost {
  cursor: default;
}

/* A column without the cursor keeps its place marked, but quietly. */
.gc-stage:not([data-region="panel"]) .gc-panel .gc-item[data-active="true"],
.gc-stage:not([data-region="pulls"]) .gc-pulls .gc-item[data-active="true"] {
  background: transparent;
  border-left-color: rgba(255, 255, 255, 0.28);
}

.gc-stage:not([data-region="panel"]) .gc-panel .gc-item[data-active="true"] .gc-tail {
  opacity: 0;
}

.gc-bar {
  height: 9px;
  background: rgba(255, 255, 255, 0.08);
  animation: gc-pulse 1.3s ease-in-out infinite;
}

@keyframes gc-pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gc-bar {
    animation: none;
  }

  .gc-pop,
  .gc-odo-reel {
    transition: none;
  }
}

.gc-icon {
  font-size: 14px;
  line-height: 1;
  text-align: center;
}

.gc-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
}

.gc-tail {
  font: 400 13px/1 var(--gc-mono);
  color: var(--gc-text);
  padding: 2px 3px;
  opacity: 0;
  transition: opacity 90ms ease-out;
}

.gc-item[data-active="true"] .gc-tail {
  opacity: 1;
}

.gc-reason {
  font: 400 10.5px/1 var(--gc-mono);
  color: var(--gc-dim);
  white-space: nowrap;
}

.gc-section {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 15px 6px;
  font: 600 11px/1 var(--gc-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gc-heading);
}

.gc-section::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--gc-line);
}

.gc-note {
  padding: 8px 15px 8px 13px;
  border-left: 2px solid transparent;
  font-size: 13.5px;
  color: var(--gc-dim);
}

.gc-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  border-top: 1px solid var(--gc-line);
}

.gc-keys {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 14px;
  font: 400 10.5px/1 var(--gc-mono);
  color: var(--gc-dim);
  letter-spacing: 0.03em;
}

.gc-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.gc-key {
  font: 600 10px/1 var(--gc-mono);
  text-transform: uppercase;
  color: var(--gc-heading);
  border: 1px solid var(--gc-line);
  border-bottom-width: 2px;
  padding: 2px 4px;
}

.gc-btn {
  border: 1px solid transparent;
  background: transparent;
  color: var(--gc-dim);
  font: 500 10.5px/1 var(--gc-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 6px 8px;
  cursor: pointer;
}

.gc-btn:hover,
.gc-btn:focus-visible {
  color: var(--gc-text);
  border-color: var(--gc-line);
  outline: none;
}

.gc-btn--primary {
  color: #0b0d10;
  background: #f2f5f8;
}

.gc-btn--primary:hover,
.gc-btn--primary:focus-visible {
  color: #0b0d10;
  background: #fff;
  border-color: transparent;
}

.gc-form {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 8px;
  padding: 13px 15px;
  border-bottom: 1px solid var(--gc-line);
}

.gc-form input {
  border: 1px solid var(--gc-line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--gc-text);
  font: 400 13px/1.2 inherit;
  padding: 8px 9px;
  outline: none;
  min-width: 0;
}

.gc-form input:focus {
  border-color: var(--gc-edge);
}

.gc-form input.gc-form-url {
  grid-column: 1 / -1;
  font-family: var(--gc-mono);
  font-size: 11.5px;
}

.gc-form-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

/* Pull requests: lanes of two-line rows; skeletons hold the slots until the snapshot lands. */
.gc-lanes {
  height: auto;
  flex: 1 1 0;
  min-height: 0;
  outline: none;
}

.gc-section--lane {
  padding: 18px 15px 6px;
}

.gc-section--lane:first-child {
  padding-top: 11px;
}

.gc-section--lane::after {
  content: none;
}

.gc-rule {
  flex: 1;
  height: 1px;
  background: var(--gc-line);
}

/*
 * One line: the title, the repository, and how long since it moved. No tail — the age is the last
 * thing on the row, and ends where the lane's divider does.
 */
.gc-pr {
  grid-template-columns: 18px minmax(0, 1fr) minmax(0, 36%) auto;
  min-height: var(--gc-pr-row);
  padding: 7px 15px 7px 13px;
}

.gc-pr-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.gc-pr-repo {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  font: 400 10px/1 var(--gc-mono);
  color: var(--gc-dim);
}

.gc-pr-age {
  min-width: 3ch;
  text-align: right;
  font: 400 10px/1 var(--gc-mono);
  color: var(--gc-dim);
}

/*
 * The full title of a row that had to cut it short, under the row it belongs to. It settles into
 * place — a short fade and a few pixels of travel toward the row — rather than snapping; the
 * timing is quick enough to read as instant. The script sets left, top and max-width per row.
 */
.gc-pop {
  position: absolute;
  z-index: 1;
  padding: 5px 8px;
  background: #14171b;
  border: 1px solid var(--gc-line);
  box-shadow: 0 12px 28px -8px rgba(0, 0, 0, 0.85);
  color: var(--gc-text);
  font-size: 11.5px;
  line-height: 1.4;
  pointer-events: none;
  opacity: 0;
  transform: translateY(calc(-100% - 4px));
  transition: opacity 120ms ease-out, transform 120ms ease-out;
}

.gc-pop[data-below="true"] {
  transform: translateY(4px);
}

.gc-pop[data-shown="true"] {
  opacity: 1;
  transform: translateY(-100%);
}

.gc-pop[data-below="true"][data-shown="true"] {
  transform: none;
}

.gc-pr--more {
  min-height: 0;
  padding-top: 4px;
  padding-bottom: 4px;
}

.gc-pr--more .gc-pr-title {
  font: 400 11px/1.2 var(--gc-mono);
  color: var(--gc-dim);
}

.gc-pr--more .gc-icon {
  color: var(--gc-dim);
}

.gc-icon[data-verdict="changes"] {
  color: #ffb3a8;
}

.gc-lanes .gc-item--ghost {
  min-height: var(--gc-pr-row);
}

.gc-note--pr {
  min-height: var(--gc-pr-row);
  display: flex;
  align-items: center;
}

.gc-note[data-error="true"] {
  color: #ffb3a8;
}

/*
 * News: one section per repository, rows of a glyph, a title and a tail word. The header carries
 * the one fact the whole column shares — what it covers — where the panel's head has its title.
 */
.gc-since {
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 400 10px/1 var(--gc-mono);
  letter-spacing: 0.03em;
  color: var(--gc-dim);
}

.gc-section--repo > span:first-child {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * One repository is a few sentences, and every fact in them is a chip: the thing the mouse hovers
 * and clicks. The words between are dimmer, so the facts read first.
 */
.gc-prose-row {
  padding: 2px 15px 9px 13px;
}

.gc-prose {
  font-size: 13px;
  line-height: 1.65;
  color: var(--gc-heading);
}

.gc-chip {
  color: var(--gc-text);
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.28);
  padding: 1px 0;
  cursor: pointer;
  white-space: nowrap;
}

/* Lit while hovered, and while its popover is the one that is up. */
.gc-chip:hover,
.gc-chip[data-open="true"] {
  background: rgba(255, 255, 255, 0.07);
  border-bottom-color: #fff;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.07);
}

/*
 * What a fact is made of: a list under its sentence, one line per pull request, commit or
 * release, each a link — every one of them, scrolling inside the card past about twenty (the
 * script sets the height). The outer element is the bridge: transparent, sitting flush under the
 * chip's line, its padding the visible gap, so the mouse crossing the gap is still in the popover
 * and not on the next line's chips. It takes the pointer only while shown, or an invisible sheet
 * would sit over the prose.
 */
.gc-pop--list {
  padding: 6px 0 0;
  background: none;
  border: 0;
  box-shadow: none;
}

.gc-pop--list[data-below="false"] {
  padding: 0 0 6px;
}

.gc-pop--list[data-shown="true"] {
  pointer-events: auto;
}

.gc-pop-card {
  padding: 5px 0;
  background: #14171b;
  border: 1px solid var(--gc-line);
  box-shadow: 0 12px 28px -8px rgba(0, 0, 0, 0.85);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.16) transparent;
}

.gc-pop-card::-webkit-scrollbar {
  width: 8px;
}

.gc-pop-card::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.16);
}

.gc-pop-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 12px;
  padding: 5px 10px;
  color: var(--gc-text);
  text-decoration: none;
}

a.gc-pop-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.gc-pop-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.gc-pop-detail {
  font: 400 10px/1 var(--gc-mono);
  color: var(--gc-dim);
  white-space: nowrap;
}

.gc-pop-item--more .gc-pop-title {
  font: 400 11px/1.2 var(--gc-mono);
  color: var(--gc-dim);
}

/*
 * The years before this one, under the number in the head and right edge to right edge with it:
 * the news popover's card and rows, a year where the title goes and its total where the detail
 * goes — spaced as the reels space theirs, and in the text colour, since here the figure is the
 * point. It hangs from the same bridge but takes no pointer: there is nothing in it to click, so it
 * is a tooltip that goes when the mouse leaves the number. The script sets right and top.
 */
.gc-pop--years[data-shown="true"] {
  pointer-events: none;
}

.gc-pop--years .gc-pop-detail {
  font-size: 11px;
  color: var(--gc-text);
}
`;
