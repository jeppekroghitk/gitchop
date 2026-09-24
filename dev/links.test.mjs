import assert from 'node:assert';
import { PANEL_SWITCHES, isSafeUrl, sanitize, sanitizePanel } from '../src/lib/links.js';

// The panel's switch: on or off, on by default, whatever storage hands back.
assert.deepEqual(sanitizePanel(), { enabled: 1 }, 'the panel rises until switched off');
assert.deepEqual(sanitizePanel(null), { enabled: 1 });
assert.deepEqual(sanitizePanel('junk'), { enabled: 1 });
assert.equal(sanitizePanel({ enabled: 0 }).enabled, 0);
assert.equal(sanitizePanel({ enabled: '0' }).enabled, 0, 'a numeric string is a number');
assert.equal(sanitizePanel({ enabled: 7 }).enabled, 1, 'anything at or above one is on');
assert.equal(sanitizePanel({ enabled: {} }).enabled, 1, 'a non-number falls back to the default');
for (const item of PANEL_SWITCHES) assert.ok(item.label && item.hint, `${item.id} carries its settings-page text`);

// Links: only http(s) may be stored, placeholders and all, and every field is cut to size.
assert.ok(isSafeUrl('https://github.com/{repoFull}/actions'), 'placeholders stand in for anything');
assert.ok(isSafeUrl('http://example.test/'));
assert.ok(!isSafeUrl('javascript:alert(1)'), 'nothing that could run on click');
assert.ok(!isSafeUrl('not a url'));
const clean = sanitize({ id: '', icon: '🔗🔗🔗🔗🔗', label: 'x'.repeat(100), url: ` https://a.test/${'y'.repeat(3000)} ` });
assert.ok(clean.id, 'a missing id is minted');
assert.equal(clean.icon.length, 4, 'icons are capped');
assert.equal(clean.label.length, 80, 'labels are capped');
assert.equal(clean.url.length, 2000, 'URLs are trimmed and capped');

console.log('links ok');
