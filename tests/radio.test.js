import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePls } from '../src/sources.js';

test('a playlist gives up its stream URLs in order', () => {
  const body = [
    '[playlist]',
    'numberofentries=3',
    'File1=https://ice4.somafm.com/beatblender-128-mp3',
    'Title1=SomaFM: Beat Blender (#1)',
    'Length1=-1',
    'File2=https://ice6.somafm.com/beatblender-128-mp3',
    'Version=2',
  ].join('\n');
  assert.deepEqual(parsePls(body), [
    'https://ice4.somafm.com/beatblender-128-mp3',
    'https://ice6.somafm.com/beatblender-128-mp3',
  ]);
});

test('crlf line endings and extra whitespace are handled', () => {
  assert.deepEqual(parsePls('File1 = https://a.example/s\r\nFile10=https://b.example/s\r\n'), [
    'https://a.example/s',
    'https://b.example/s',
  ]);
});

test('a playlist with no File entries is empty, not an error', () => {
  assert.deepEqual(parsePls('[playlist]\nnumberofentries=0\n'), []);
  assert.deepEqual(parsePls(''), []);
});
