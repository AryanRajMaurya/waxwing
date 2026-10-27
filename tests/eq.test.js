import assert from 'node:assert/strict';
import test from 'node:test';

import { BANDS, MAX_GAIN, MIN_GAIN, PRESETS, clampGain, preampFor, responseCurve } from '../src/eq.js';

test('there are ten bands, ascending, covering the audible range', () => {
  assert.equal(BANDS.length, 10);
  assert.deepEqual(BANDS, [...BANDS].sort((a, b) => a - b));
  assert.equal(BANDS[0], 32);
  assert.equal(BANDS[9], 16000);
});

test('gains are clamped to the panel range', () => {
  assert.equal(clampGain(99), MAX_GAIN);
  assert.equal(clampGain(-99), MIN_GAIN);
  assert.equal(clampGain('x'), 0);
  assert.equal(clampGain(6), 6);
});

test('the preamp cancels the largest boost and nothing else', () => {
  assert.equal(preampFor([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 0);
  assert.equal(preampFor([0, 0, 4, 0, 0, 0, 0, 0, 0, 0]), -4);
  assert.equal(preampFor([-3, -2, -1, 0, 0, 0, 0, 0, 0, 0]), 0, 'cuts never raise the preamp');
});

test('every preset is ten gains inside the range', () => {
  for (const [name, gains] of Object.entries(PRESETS)) {
    assert.equal(gains.length, 10, `${name} has ${gains.length} bands`);
    for (const gain of gains) {
      assert.ok(gain >= MIN_GAIN && gain <= MAX_GAIN, `${name} has ${gain}`);
    }
  }
});

test('the drawn curve follows the gains it is given', () => {
  const flat = responseCurve(PRESETS.flat);
  assert.equal(flat.length, 64);
  assert.ok(flat.every((point) => Math.abs(point.db) < 0.001));

  const warm = responseCurve(PRESETS.warm).map((p) => p.db);
  assert.ok(warm[0] < 0, 'a boost plus preamp lowers the rest of the curve');
  // The peak lands on the boosted band, at 0 dB once the preamp is applied.
  // Sampling is logarithmic, so it can land a hair under the exact centre.
  assert.ok(Math.max(...warm) > -0.5, `peak was ${Math.max(...warm)}`);
  assert.ok(Math.max(...warm) <= 0.001, 'nothing exceeds 0 dBFS');
});

test('the curve is sampled logarithmically across the spectrum', () => {
  const curve = responseCurve(PRESETS.flat);
  assert.ok(curve[0].frequency >= 20 && curve[0].frequency < 25);
  assert.ok(curve[curve.length - 1].frequency <= 20000);
  assert.ok(curve[curve.length - 1].frequency > 19000);
});
