import assert from 'node:assert/strict';
import test from 'node:test';

import { odesliUrl, summarizeOdesli, PLATFORMS } from '../src/odesli.js';
import { lookupiTunes } from '../src/wax.js';

test('the odesli request encodes whatever link was pasted', () => {
  const url = new URL(odesliUrl('https://song.link/s/1Bxfu'));
  assert.equal(url.origin + url.pathname, 'https://api.song.link/v1-alpha.1/links');
  assert.equal(url.searchParams.get('url'), 'https://song.link/s/1Bxfu');
  assert.equal(url.searchParams.get('usercountry'), 'US');
});

const PAYLOAD = {
  entityUniqueId: 'SPOTIFY_SONG::3Bafu',
  entities: [
    { id: 'id.1440809498', platforms: [PLATFORMS.APPLE], title: 'Glass', artistName: 'IZGIV', thumbnailUrl: 'https://a/t.jpg' },
    { id: 'dQw4w9WgXcQ', platforms: [PLATFORMS.YOUTUBE, PLATFORMS.YOUTUBE_MUSIC], title: 'Glass', artistName: 'IZGIV' },
    { id: '3Bafu', platforms: [PLATFORMS.SPOTIFY], title: 'Glass', artistName: 'IZGIV' },
  ],
};

test('the payload summary keeps the youtube id and the bare apple id', () => {
  const summary = summarizeOdesli(PAYLOAD);
  assert.equal(summary.youtubeId, 'dQw4w9WgXcQ');
  assert.equal(summary.appleId, '1440809498', 'the id. prefix goes');
  assert.equal(summary.title, 'Glass');
  assert.equal(summary.artist, 'IZGIV');
  assert.equal(summary.coverUrl, 'https://a/t.jpg');
});

test('a primary entity without artwork falls back to any entity that has it', () => {
  const payload = {
    entityUniqueId: 'SPOTIFY_SONG::3Bafu2',
    entities: [
      { id: '3Bafu2', platforms: [PLATFORMS.SPOTIFY], title: 'Digital', artistName: 'Who' },
      { id: 'id.0', platforms: [PLATFORMS.APPLE], title: 'Digital', artistName: 'Who', thumbnailUrl: 'http://t/2.jpg', audioPreview: { url: 'https://o/prev.m4a' } },
    ],
  };
  const summary = summarizeOdesli(payload);
  assert.equal(summary.coverUrl, 'http://t/2.jpg');
  assert.equal(summary.applePreview, 'https://o/prev.m4a');
});

test('garbage in, null out', () => {
  assert.equal(summarizeOdesli(null), null);
  assert.equal(summarizeOdesli({ entities: [] }).youtubeId, null);
  assert.equal(summarizeOdesli({}).title, '');
});

test('an apple id lookup request is a one-hit lookup, with a clean id', async () => {
  await assert.rejects(lookupiTunes(''), /no apple id/);
  await assert.rejects(lookupiTunes('1440809498'), /browser/, 'node has no document; the promise must reject, not hang');
});
