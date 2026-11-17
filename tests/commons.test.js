import test from 'node:test';
import assert from 'node:assert/strict';

import { commonsSearchUrl, stripMarkup, cleanFileUrl } from '../src/sources.js';

test('the Commons query asks for audio files in the file namespace', () => {
  const url = new URL(commonsSearchUrl('beethoven', 20));
  assert.equal(url.hostname, 'commons.wikimedia.org');
  assert.equal(url.searchParams.get('srsearch'), 'filetype:audio beethoven');
  assert.equal(url.searchParams.get('srnamespace'), '6');
  assert.equal(url.searchParams.get('srlimit'), '20');
  assert.equal(url.searchParams.get('origin'), '*');
});

test('markup comes out of Commons text fields', () => {
  assert.equal(stripMarkup('<bdi><a href="x">Ludwig van Beethoven</a></bdi>'), 'Ludwig van Beethoven');
  assert.equal(stripMarkup('  multiple   spaces  '), 'multiple spaces');
  assert.equal(stripMarkup(undefined), '');
});

test('the tracking query is stripped from a file URL', () => {
  const dirty = 'https://upload.wikimedia.org/wikipedia/commons/8/87/a.ogg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original';
  assert.equal(cleanFileUrl(dirty), 'https://upload.wikimedia.org/wikipedia/commons/8/87/a.ogg');
});

test('a URL that will not parse is handed back rather than thrown on', () => {
  assert.equal(cleanFileUrl('not a url'), 'not a url');
});
