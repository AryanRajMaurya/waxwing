import test from 'node:test';
import assert from 'node:assert/strict';

import { BARS, MIN_HZ, MAX_HZ, bandRange, bandEdges, binsFor } from '../src/viz.js';

test('every bar owns at least one bin', () => {
  const total = 1024;
  const nyquist = 22050;
  for (let i = 0; i < BARS; i += 1) {
    const [from, to] = binsFor(i, total, nyquist);
    assert.ok(from >= 1, `bar ${i} starts at ${from}`);
    assert.ok(to >= from, `bar ${i} ends before it starts`);
    assert.ok(to <= total - 1, `bar ${i} runs past the last bin`);
  }
});

test('the first bar is the lowest and the last is the highest', () => {
  const total = 1024;
  const nyquist = 22050;
  const first = binsFor(0, total, nyquist);
  const last = binsFor(BARS - 1, total, nyquist);
  assert.ok(first[0] < last[0], 'bars must ascend in frequency');
  assert.ok(first[1] < last[1], 'bar bands must not overlap backwards');
});

test('bands never skip a bin between neighbours', () => {
  const edges = bandEdges(1024, 22050);
  for (let i = 1; i < edges.length; i += 1) {
    assert.equal(edges[i][0], edges[i - 1][1] + 1, `gap between bar ${i - 1} and ${i}`);
  }
});

test('the last band stops at the top of the band the eye can use', () => {
  // MAX_HZ is 14 kHz, below the 22.05 kHz Nyquist: the bins above it are
  // deliberately unowned rather than folded into the top bar.
  const edges = bandEdges(1024, 22050);
  assert.equal(edges[edges.length - 1][1], Math.ceil((MAX_HZ / 22050) * 1024) - 1);
  assert.ok(edges[edges.length - 1][1] < 1024);
});

test('the span is logarithmic, so bass bands are narrower in Hz than treble', () => {
  const width = (i) => bandRange(i)[1] - bandRange(i)[0];
  assert.ok(width(0) < width(Math.floor(BARS / 2)), 'bass bands must be narrower in Hz');
  assert.ok(width(Math.floor(BARS / 2)) < width(BARS - 1), 'treble bands must be the widest');
  assert.ok(MIN_HZ < MAX_HZ);
});
