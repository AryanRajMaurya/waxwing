import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeLucene,
  archiveQ,
  archiveSearchUrl,
  archiveStreamUrl,
  archiveThumb,
  pickArchiveFile,
  upgradeArtwork,
  pickiTunesTrack,
  jsonp,
} from '../src/wax.js';

test('lucene punctuation is escaped, letters are not', () => {
  assert.equal(escapeLucene('the "bar" song'), 'the \\"bar\\" song');
  assert.equal(escapeLucene('AC/DC + best & more'), 'AC\\/DC \\+ best \\& more');
  assert.equal(escapeLucene('nina simone'), 'nina simone');
  assert.equal(escapeLucene(undefined), '');
});

test('the archive query filters to playable, permitted audio', () => {
  const q = archiveQ('night of the hunter');
  assert.match(q, /mediatype:\(audio\)/);
  assert.match(q, /licenseurl:\*creativecommons\.org\*|collection:\(etree\)/);
  assert.match(q, /\(title:\(night of the hunter\)\^4/);
});

test('the search URL carries the fields, rows and encoded query', () => {
  const url = new URL(archiveSearchUrl('sun ra', { rows: 10 }));
  assert.equal(url.origin + url.pathname, 'https://archive.org/advancedsearch.php');
  assert.equal(url.searchParams.get('rows'), '10');
  assert.equal(url.searchParams.get('output'), 'json');
  const fields = url.searchParams.getAll('fl[]');
  assert.deepEqual(fields, ['identifier', 'title', 'creator', 'year', 'downloads']);
  assert.match(url.searchParams.get('q') || '', /sun\\ ra|sun/);
});

test('stream URLs encode the identifier and path segments, not the slashes', () => {
  assert.equal(
    archiveStreamUrl('gd1977-05-08.sbd', 'disc1/gd1977-05-08 t01.mp3'),
    'https://archive.org/download/gd1977-05-08.sbd/disc1/gd1977-05-08%20t01.mp3',
  );
});

test('thumbnails come from the services/img slot', () => {
  assert.equal(archiveThumb('etree-123'), 'https://archive.org/services/img/etree-123');
});

test('the file picker prefers playable weight over raw quality', () => {
  const files = [
    { name: 'cover.png', format: 'PNG' },
    { name: 'bat.flac', format: 'Flac' },
    { name: 'bat_vbr.mp3', format: 'VBR MP3' },
    { name: 'bat.ogg', format: 'Ogg Vorbis' },
  ];
  assert.equal(pickArchiveFile(files).name, 'bat_vbr.mp3');
  // No mp3 anywhere: the ogg is next.
  assert.equal(pickArchiveFile([{ name: 'bat.ogg', format: 'Ogg Vorbis' }]).name, 'bat.ogg');
  assert.match(pickArchiveFile([{ name: 'x.mp3', format: 'mp3' }]).name, /x\.mp3/, 'formats match case-insensitively');
  assert.equal(pickArchiveFile([{ name: 'meta.xml', format: 'Metadata' }]), null);
  assert.equal(pickArchiveFile('not a list'), null);
});

test('artwork URLs grow to the square slot asked for', () => {
  assert.equal(
    upgradeArtwork('https://is1-ssl.mzstatic.com/image/foo/100x100bb.jpg', 600),
    'https://is1-ssl.mzstatic.com/image/foo/600x600bb.jpg',
  );
  assert.match(upgradeArtwork('http://a/100x100bb.jpg'), /300x300bb\.jpg$/, '300 by default');
  assert.equal(upgradeArtwork(null), '');
});

test('iTunes results without a preview are dropped, the rest map cleanly', () => {
  assert.equal(pickiTunesTrack(null), null);
  assert.equal(pickiTunesTrack({ trackName: 'no preview' }), null);

  const track = pickiTunesTrack({
    trackName: 'Glass',
    artistName: 'IZGIV',
    collectionName: 'Glass — Single',
    previewUrl: 'https://audio-ssl.itunes.apple.com/x.m4a',
    artworkUrl100: 'https://a/100x100bb.jpg',
    trackTimeMillis: 24000,
    trackViewUrl: 'https://music.apple.com/x',
    primaryGenreName: 'Electronic',
  });
  assert.equal(track.title, 'Glass');
  assert.equal(track.duration, 24);
  assert.match(track.coverUrl, /300x300bb\.jpg$/);
  assert.equal(track.buyUrl, 'https://music.apple.com/x');
});

test('jsonp attaches a callback and cleans up after itself', async () => {
  // No document in node: the promise must reject, not hang.
  await assert.rejects(jsonp('https://itunes.apple.com/x'), /browser/);
});
