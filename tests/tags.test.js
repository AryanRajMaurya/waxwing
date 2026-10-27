import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeText, readId3v2, readTags, syncSafe, tagsFromFilename } from '../src/tags.js';

function syncSafeBytes(value) {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

function uint32Bytes(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function frame(id, body, major = 3) {
  const size = major === 4 ? syncSafeBytes(body.length) : uint32Bytes(body.length);
  return [...Buffer.from(id, 'latin1'), ...size, 0, 0, ...body];
}

function textBody(text, encoding = 3) {
  if (encoding === 0) return [0, ...Buffer.from(text, 'latin1')];
  if (encoding === 1) return [1, 0xff, 0xfe, ...Buffer.from(text, 'utf16le')];
  return [3, ...Buffer.from(text, 'utf8')];
}

function tag(frames, major = 3) {
  const body = frames.flat();
  return new Uint8Array([0x49, 0x44, 0x33, major, 0, 0, ...syncSafeBytes(body.length), ...body]);
}

test('syncsafe reads a 28-bit integer', () => {
  assert.equal(syncSafe([0x00, 0x00, 0x02, 0x01], 0), 257);
  assert.equal(syncSafe([0x7f, 0x7f, 0x7f, 0x7f], 0), 0x0fffffff);
});

test('text with a UTF-8 encoding byte decodes', () => {
  assert.equal(decodeText(new Uint8Array(textBody('Beyoncé'))), 'Beyoncé');
});

test('text with a UTF-16 BOM decodes, both byte orders', () => {
  assert.equal(decodeText(new Uint8Array(textBody('Sigur Rós', 1))), 'Sigur Rós');

  const be = new Uint8Array([1, 0xfe, 0xff, 0x00, 0x53, 0x00, 0x61]);
  assert.equal(decodeText(be), 'Sa');
});

test('latin-1 text decodes without mangling accents', () => {
  assert.equal(decodeText(new Uint8Array([0, ...Buffer.from('Björk', 'latin1')])), 'Björk');
});

test('ID3v2.3 frames are read into fields', () => {
  const bytes = tag([
    frame('TIT2', textBody('Hyperballad')),
    frame('TPE1', textBody('Björk')),
    frame('TALB', textBody('Post')),
    frame('TRCK', textBody('3/11')),
    frame('TYER', textBody('1995')),
    frame('TCON', textBody('Electronic')),
  ]);

  assert.deepEqual(readId3v2(bytes), {
    title: 'Hyperballad',
    artist: 'Björk',
    album: 'Post',
    track: '3/11',
    year: '1995',
    genre: 'Electronic',
  });
});

test('ID3v2.4 syncsafe frame sizes are read', () => {
  const bytes = tag([frame('TIT2', textBody('Jóga')), frame('TPE1', textBody('Björk'))], 4);
  const tags = readId3v2(bytes);
  assert.equal(tags.title, 'Jóga');
  assert.equal(tags.artist, 'Björk');
});

test('an attached picture is extracted with its mime type', () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4];
  const body = [0, ...Buffer.from('image/png\0', 'latin1'), 3, 0, ...png];
  const bytes = tag([frame('TIT2', textBody('Cover')), frame('APIC', body)]);

  const tags = readId3v2(bytes);
  assert.equal(tags.picture.mime, 'image/png');
  assert.deepEqual([...tags.picture.data], png);
});

test('padding after the last frame is ignored, not parsed as a frame', () => {
  const bytes = new Uint8Array([
    0x49, 0x44, 0x33, 3, 0, 0,
    ...syncSafeBytes(30),
    ...frame('TIT2', textBody('A')),
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  assert.equal(readId3v2(bytes).title, 'A');
});

test('a file with no tag is not a tag', () => {
  assert.equal(readId3v2(new Uint8Array([0xff, 0xfb, 0x90, 0x00])), null);
  assert.equal(readId3v2(new Uint8Array(0)), null);
});

test('filenames split into artist and title', () => {
  assert.deepEqual(tagsFromFilename('01 - Björk - Jóga.mp3'), {
    artist: 'Björk',
    title: 'Jóga',
  });
  assert.deepEqual(tagsFromFilename('03. Hyperballad.flac'), {
    artist: '',
    title: 'Hyperballad',
  });
  assert.deepEqual(tagsFromFilename('untitled.mp3'), { artist: '', title: 'untitled' });
  assert.deepEqual(tagsFromFilename('a_b_c.mp3'), { artist: '', title: 'a b c' });
});

test('readTags prefers the file, then falls back to its name', () => {
  const tagged = tag([frame('TIT2', textBody('Jóga'))]);
  const merged = readTags(tagged, 'Björk - Jóga.mp3');
  assert.equal(merged.title, 'Jóga');
  assert.equal(merged.artist, 'Björk');
  assert.equal(merged.tagged, true);

  const bare = readTags(new Uint8Array([0xff, 0xfb]), '04 - Someone - Somewhere.mp3');
  assert.equal(bare.title, 'Somewhere');
  assert.equal(bare.artist, 'Someone');
  assert.equal(bare.tagged, false);
});
