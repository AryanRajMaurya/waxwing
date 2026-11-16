import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureOnPaper, luminance, css } from '../src/color.js';

const PAPER = { r: 236, g: 228, b: 211 };

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test('a pale accent is pulled dark enough to read on paper', () => {
  const pale = { r: 255, g: 224, b: 189 };
  const accent = ensureOnPaper(pale);
  assert.ok(contrast(accent, PAPER) >= 4.5, `contrast was ${contrast(accent, PAPER)}`);
});

test('a near-black accent is lifted so it is not a hole in the page', () => {
  const deep = { r: 12, g: 10, b: 8 };
  const accent = ensureOnPaper(deep);
  assert.ok(luminance(accent) > luminance(deep), 'lightness should rise');
  assert.ok(contrast(accent, PAPER) >= 4.5, `contrast was ${contrast(accent, PAPER)}`);
});

test('a grey cover still gets a deliberate spot colour', () => {
  const grey = { r: 128, g: 128, b: 128 };
  const accent = ensureOnPaper(grey);
  const max = Math.max(accent.r, accent.g, accent.b);
  const min = Math.min(accent.r, accent.g, accent.b);
  assert.ok(max - min > 20, 'a neutral cover should gain some chroma');
});

test('the hue of the cover survives', () => {
  const red = { r: 220, g: 40, b: 30 };
  const accent = ensureOnPaper(red);
  assert.ok(accent.r > accent.g && accent.r > accent.b, 'red should stay red');
});

test('the accent is emitted as a CSS colour', () => {
  assert.equal(css({ r: 179, g: 65, b: 10 }), 'rgb(179 65 10)');
  assert.equal(css({ r: 179, g: 65, b: 10 }, 0.5), 'rgb(179 65 10 / 0.5)');
});
