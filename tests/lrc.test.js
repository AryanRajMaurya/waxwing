import assert from 'node:assert/strict';
import test from 'node:test';

import { activeIndex, parseLrc, windowAt } from '../src/lrc.js';

const LRC = `[ar:Björk]
[ti:Jóga]
[offset:0]
[00:00.00] All that you are
[00:12.34] is all that you need
[00:24.5] [00:36.75] a second chorus
[01:02.05] the end`;

test('metadata lines are collected, not treated as lyrics', () => {
  const { meta } = parseLrc(LRC);
  assert.equal(meta.ar, 'Björk');
  assert.equal(meta.ti, 'Jóga');
});

test('timestamped lines are parsed and sorted', () => {
  const { lines } = parseLrc(LRC);
  assert.deepEqual(lines.map((l) => l.time), [0, 12.34, 24.5, 36.75, 62.05]);
  assert.equal(lines[0].text, 'All that you are');
});

test('one line with two stamps becomes two lines', () => {
  const { lines } = parseLrc(LRC);
  assert.equal(lines.filter((l) => l.text === 'a second chorus').length, 2);
});

test('a two-digit fraction is hundredths, not tenths', () => {
  const { lines } = parseLrc('[00:01.25] x\n[00:01.5] y');
  assert.deepEqual(lines.map((l) => l.time), [1.25, 1.5]);
});

test('an offset shifts every line and never goes below zero', () => {
  const { lines } = parseLrc('[offset:500]\n[00:00.10] a\n[00:10.00] b');
  assert.equal(lines[0].time, 0);
  assert.equal(lines[1].time, 9.5);
});

test('the active line is the last one that has started', () => {
  const { lines } = parseLrc(LRC);
  assert.equal(activeIndex(lines, 0), 0);
  assert.equal(activeIndex(lines, 12.339), 0);
  assert.equal(activeIndex(lines, 12.34), 1);
  assert.equal(activeIndex(lines, 999), lines.length - 1);
});

test('before the first line there is nothing active', () => {
  const { lines } = parseLrc('[00:05.00] later');
  assert.equal(activeIndex(lines, 0), -1);
  assert.equal(windowAt(lines, 0).index, -1);
});

test('a window keeps the active line in context', () => {
  const { lines } = parseLrc(LRC);
  const { index, lines: visible } = windowAt(lines, 25, 2);
  assert.equal(index, 2);
  assert.ok(visible.length <= 5);
  assert.ok(visible.some((line) => line.time === 24.5));
});

test('junk lines do not become lyrics', () => {
  const { lines } = parseLrc('not a lyric\n\n[00:01.00]\n[bad]');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '');
});
