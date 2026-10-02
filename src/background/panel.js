import { PANEL_KEY, api, sanitizePanel } from '../lib/links.js';

/**
 * Whether the panel itself — the links and the search — rises with the menu. Off, the columns stand
 * on their own; the menu decides for itself that with no column to stand, the panel stays.
 */
export async function readPanel() {
  try {
    const stored = await api.storage.sync.get(PANEL_KEY);
    return sanitizePanel(stored[PANEL_KEY]);
  } catch {
    return sanitizePanel();
  }
}

export async function panelState() {
  const settings = await readPanel();
  return { settings, show: settings.enabled === 1 };
}
