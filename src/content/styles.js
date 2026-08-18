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
  --gc-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
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

.gc-cut {
  position: fixed;
  top: 50%;
  left: 50%;
  height: 2px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.5));
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.55));
}

.gc-glint {
  position: absolute;
  top: -3px;
  bottom: -3px;
  background: linear-gradient(90deg, #fff, #fff 12%, rgba(255, 255, 255, 0.55) 55%, transparent);
}

.gc-bloom {
  position: fixed;
  top: 50%;
  left: 50%;
  height: 26px;
  opacity: 0;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0.1));
  filter: blur(11px);
}

.gc-panel {
  position: relative;
  width: min(460px, 100%);
  display: flex;
  flex-direction: column;
  background: var(--gc-panel);
  border: 1px solid var(--gc-line);
  box-shadow: 0 30px 70px -20px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.6);
  color: var(--gc-text);
  opacity: 0;
}

.gc-panel::before {
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

.gc-wordmark {
  font: 600 10.5px/1 var(--gc-mono);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--gc-dim);
}

.gc-wordmark b {
  color: #fff;
  font-weight: 600;
}

.gc-context {
  margin-left: auto;
  font: 400 11px/1 var(--gc-mono);
  color: var(--gc-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
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
  font: 500 9.5px/1 var(--gc-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--gc-dim);
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
  font: 400 10px/1 var(--gc-mono);
  color: var(--gc-dim);
  letter-spacing: 0.04em;
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
`;
