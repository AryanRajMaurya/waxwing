import assert from 'node:assert/strict';
import test from 'node:test';

import { dominantColor, ensureReadable, luminance, textOn } from '../src/color.js';

/** Build RGBA pixels: [r,g,b,a] repeated. */
function pixels(entries) {
  const out = new Uint8ClampedArray(entries.length * 4);
  entries.forEach(([r, g, b, a = 255], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  });
  return out;
}

test('a mostly grey cover with one vivid patch returns the patch', () => {
  const grey = Array.from({ length: 400 }, () => [128, 128, 128]);
  const red = Array.from({ length: 40 }, () => [220, 30, 40]);
  const accent = dominantColor(pixels([...grey, ...red]));

  // It is the red that reads as the colour of this cover, not the grey.
  assert.ok(accent.r > 150, `red channel was ${accent.r}`);
  assert.ok(accent.g < 100, `green channel was ${accent.g}`);
});

test('transparent pixels are ignored', () => {
  const transparentRed = Array.from({ length: 100 }, () => [255, 0, 0, 0]);
  const blue = Array.from({ length: 20 }, () => [20, 60, 220]);
  const accent = dominantColor(pixels([...transparentRed, ...blue]));
  assert.ok(accent.b > accent.r, `expected blue, got ${JSON.stringify(accent)}`);
});

test('a flat black cover falls back to the neutral accent', () => {
  const black = Array.from({ length: 50 }, () => [0, 0, 0]);
  const accent = dominantColor(pixels(black));
  assert.deepEqual(accent, { r: 168, g: 132, b: 96 });
});

test('an empty or missing image does not throw', () => {
  assert.deepEqual(dominantColor(null), { r: 168, g: 132, b: 96 });
  assert.deepEqual(dominantColor(new Uint8ClampedArray(0)), { r: 168, g: 132, b: 96 });
});

test('luminance separates light from dark', () => {
  assert.ok(luminance({ r: 255, g: 255, b: 255 }) > 0.9);
  assert.ok(luminance({ r: 0, g: 0, b: 0 }) < 0.01);
});

test('text colour flips to dark on a light accent', () => {
  assert.equal(textOn({ r: 245, g: 240, b: 220 }), '#12100e');
  assert.equal(textOn({ r: 20, g: 18, b: 16 }), '#f6f2ea');
});

test('a dark accent is lifted until it is visible on a dark background', () => {
  const lifted = ensureReadable({ r: 10, g: 8, b: 6 });
  assert.ok(Math.max(lifted.r, lifted.g, lifted.b) >= 100);
});
