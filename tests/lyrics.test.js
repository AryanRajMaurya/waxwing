import test from 'node:test';
import assert from 'node:assert/strict';

import { lrclibSearchUrl, pickLyrics } from '../src/lyrics.js';

test('the search URL carries the track, and the artist when there is one', () => {
  const url = new URL(lrclibSearchUrl({ track: 'heat waves', artist: 'glass animals' }));
  assert.equal(url.hostname, 'lrclib.net');
  assert.equal(url.pathname, '/api/search');
  assert.equal(url.searchParams.get('track_name'), 'heat waves');
  assert.equal(url.searchParams.get('artist_name'), 'glass animals');
  assert.equal(url.searchParams.get('album_name'), null);
});

test('an empty artist is left out rather than sent blank', () => {
  const url = new URL(lrclibSearchUrl({ track: 'x', artist: '' }));
  assert.equal(url.searchParams.has('artist_name'), false);
});

test('synced lyrics beat plain lyrics', () => {
  const results = [
    { id: 1, trackName: 'X', plainLyrics: '[00:01.00] plain' },
    { id: 2, trackName: 'X', syncedLyrics: '[00:01.00] synced' },
  ];
  assert.equal(pickLyrics(results).id, 2);
});

test('among synced results the closest duration wins', () => {
  const results = [
    { id: 1, syncedLyrics: '[00:01.00] a', duration: 60 },
    { id: 2, syncedLyrics: '[00:01.00] b', duration: 210 },
    { id: 3, syncedLyrics: '[00:01.00] c', duration: 400 },
  ];
  assert.equal(pickLyrics(results, { duration: 239 }).id, 2);
});

test('a karaoke mix and a single sharing a title are told apart by duration', () => {
  const results = [
    { id: 1, syncedLyrics: '[00:01.00] karaoke mix', duration: 600 },
    { id: 2, syncedLyrics: '[00:01.00] album version', duration: 241 },
  ];
  assert.equal(pickLyrics(results, { duration: 240 }).id, 2);
});

test('the duration term is gentle: a few seconds either way does not overturn a match', () => {
  const results = [
    { id: 1, syncedLyrics: 'a', duration: 235 },
    { id: 2, syncedLyrics: 'b', duration: 245 },
  ];
  assert.equal(pickLyrics(results, { duration: 240 }).id, 1); // stable: first wins a tie
});

test('nothing usable answers null, not a throw', () => {
  assert.equal(pickLyrics([]), null);
  assert.equal(pickLyrics([{ id: 1, trackName: 'X' }]), null);
  assert.equal(pickLyrics(undefined), null);
});

test('the original list is not reordered', () => {
  const results = [
    { id: 1, syncedLyrics: 'a', duration: 100 },
    { id: 2, syncedLyrics: 'b', duration: 200 },
  ];
  pickLyrics(results, { duration: 200 });
  assert.deepEqual(results.map((r) => r.id), [1, 2]);
});
