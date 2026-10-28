import assert from 'node:assert/strict';
import test from 'node:test';

import { youTubeId, youTubeThumb } from '../src/yt.js';

const ID = 'dQw4w9WgXcQ';

test('a watch URL yields its id', () => {
  assert.equal(youTubeId(`https://www.youtube.com/watch?v=${ID}&list=PL123`), ID);
  assert.equal(youTubeId(`https://youtube.com/watch?v=${ID}`), ID);
});

test('share, embed, shorts and live URLs yield their id', () => {
  assert.equal(youTubeId(`https://youtu.be/${ID}`), ID);
  assert.equal(youTubeId(`https://www.youtube.com/embed/${ID}`), ID);
  assert.equal(youTubeId(`https://www.youtube.com/shorts/${ID}`), ID);
  assert.equal(youTubeId(`https://www.youtube.com/live/${ID}`), ID);
});

test('a bare id is accepted, with or without the frame', () => {
  assert.equal(youTubeId(ID), ID);
  assert.equal(youTubeId(`  ${ID} `), ID);
});

test('URLs close to the real thing are refused', () => {
  assert.equal(youTubeId('https://www.youtube.com/watch?p=dQw4wQWgXc'), null, 'wrong param');
  assert.equal(youTubeId('https://youtu.be/tooshort'), null, 'a 1993 tape is not an id');
  assert.equal(youTubeId(''), null);
  assert.equal(youTubeId(null), null);
  assert.equal(youTubeId('hello'), null);
});

test('the id never leaks into something else', () => {
  // An eleven-character tail from an unrelated URL must not become an id.
  assert.equal(youTubeId('https://example.com/a/dQw4w9WgXcQ'), null);
});

test('thumbnails come from the stable hqdefault slot', () => {
  assert.equal(youTubeThumb(ID), `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
});
