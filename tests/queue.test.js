import assert from 'node:assert/strict';
import test from 'node:test';

import {
  append,
  createQueue,
  current,
  jumpTo,
  next,
  previous,
  setRepeat,
  setShuffle,
} from '../src/queue.js';

/** A deterministic RNG, so shuffle assertions mean something. */
function seeded(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const IDS = ['a', 'b', 'c', 'd'];

test('a fresh queue starts on the first track', () => {
  const q = createQueue(IDS);
  assert.equal(current(q), 'a');
  assert.equal(next(q), 'b');
  assert.equal(current(q), 'b');
});

test('next stops at the end when repeat is off', () => {
  const q = createQueue(['a', 'b']);
  assert.equal(next(q), 'b');
  assert.equal(next(q), null);
  assert.equal(current(q), 'b', 'the last track stays current');
});

test('repeat all wraps to the beginning', () => {
  const q = createQueue(['a', 'b'], { repeat: 'all' });
  next(q);
  assert.equal(next(q), 'a');
});

test('repeat one repeats on a natural end but not on a manual next', () => {
  const q = createQueue(['a', 'b'], { repeat: 'one' });
  assert.equal(next(q, { automatic: true }), 'a');
  assert.equal(next(q), 'b', 'pressing next still moves');
});

test('previous walks back and clamps at the start', () => {
  const q = createQueue(['a', 'b', 'c']);
  next(q);
  next(q);
  assert.equal(previous(q), 'b');
  assert.equal(previous(q), 'a');
  assert.equal(previous(q), 'a');
});

test('previous wraps backwards when repeat is all', () => {
  const q = createQueue(['a', 'b'], { repeat: 'all' });
  assert.equal(previous(q), 'b');
});

test('shuffle plays every track before repeating any', () => {
  const q = createQueue(IDS, { shuffle: true, rng: seeded(7) });
  const played = [current(q)];
  for (let i = 1; i < IDS.length; i += 1) played.push(next(q));

  assert.deepEqual([...played].sort(), [...IDS].sort());
  assert.equal(new Set(played).size, IDS.length);
});

test('turning shuffle on keeps the current track playing', () => {
  const q = createQueue(IDS, { rng: seeded(3) });
  next(q); // now on 'b'
  setShuffle(q, true);
  assert.equal(current(q), 'b');
});

test('turning shuffle off returns to library order at the same track', () => {
  const q = createQueue(IDS, { shuffle: true, rng: seeded(3) });
  jumpTo(q, 'c');
  setShuffle(q, false);
  assert.equal(current(q), 'c');
  assert.equal(next(q), 'd');
});

test('jumpTo moves to a known track and refuses an unknown one', () => {
  const q = createQueue(IDS, { shuffle: true, rng: seeded(5) });
  assert.equal(jumpTo(q, 'd'), 'd');
  assert.equal(current(q), 'd');
  assert.equal(jumpTo(q, 'nope'), null);
  assert.equal(current(q), 'd');
});

test('append adds new ids once and starts playback if the queue was empty', () => {
  const q = createQueue([]);
  append(q, ['a', 'a', 'b']);
  assert.equal(current(q), 'a');
  append(q, ['b', 'c']);
  assert.deepEqual(q.ids, ['a', 'b', 'c']);
});

test('an unknown repeat mode is refused instead of silently ignored', () => {
  const q = createQueue(IDS);
  assert.throws(() => setRepeat(q, 'sometimes'), /unknown repeat mode/);
});

test('an empty queue has nothing to play', () => {
  const q = createQueue([]);
  assert.equal(current(q), null);
  assert.equal(next(q), null);
  assert.equal(previous(q), null);
});
