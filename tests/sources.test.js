import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeLucene, pickArchiveFile, ARCHIVE_FORMAT_ORDER } from '../src/sources.js';

test('Lucene metacharacters are escaped so a query cannot change meaning', () => {
  const nasty = 'the "bar" song + (live) [remix] - edit';
  const escaped = escapeLucene(nasty);
  for (const character of ['"', '+', '(', ')', '[', ']', '-']) {
    assert.ok(escaped.includes(`\\${character}`), `${character} was not escaped`);
  }
  assert.equal(escapeLucene(''), '');
  assert.equal(escapeLucene(null), '');
});

test('a 128 kbps MP3 beats a FLAC: quality per byte, not per resolution', () => {
  const files = [
    { name: 'song.flac', format: 'Flac' },
    { name: 'song.mp3', format: '128Kbps MP3' },
    { name: 'song.ogg', format: 'Ogg Vorbis' },
  ];
  assert.equal(pickArchiveFile(files).name, 'song.mp3');
});

test('VBR MP3 is the best file an item can hold', () => {
  const files = [
    { name: 'a.mp3', format: 'VBR MP3' },
    { name: 'b.mp3', format: 'MP3' },
  ];
  assert.equal(pickArchiveFile(files).name, 'a.mp3');
});

test('an item with no recognised audio is refused, not guessed at', () => {
  const files = [
    { name: 'cover.jpg', format: 'JPEG' },
    { name: 'booklet.pdf', format: 'Text PDF' },
  ];
  assert.equal(pickArchiveFile(files), null);
  assert.equal(pickArchiveFile(undefined), null);
});

test('format matching is case-insensitive', () => {
  const files = [{ name: 'x.mp3', format: 'mp3' }];
  assert.equal(pickArchiveFile(files).name, 'x.mp3');
});

test('the format order puts every MP3 variant ahead of lossless', () => {
  const mp3Variants = ARCHIVE_FORMAT_ORDER.filter((f) => f.includes('MP3'));
  const flac = ARCHIVE_FORMAT_ORDER.indexOf('Flac');
  assert.ok(mp3Variants.length >= 4);
  for (const variant of mp3Variants) {
    assert.ok(ARCHIVE_FORMAT_ORDER.indexOf(variant) < flac, `${variant} should beat Flac`);
  }
});
