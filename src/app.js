/**
 * Waxwing, in the browser.
 *
 * The UI is a broadsheet: a find rail on the left, the plate in the middle, the
 * running order on the right. Everything under it is a module:
 *
 *   sources.js  the four catalogues            player.js  Howler + EQ graph
 *   tags.js     ID3v2 reader                   lrc.js     lyric timing
 *   color.js    accent from the cover          eq.js      the filter chain
 *   queue.js    play order and repeat
 */

import { readTags } from './tags.js';
import { activeIndex, parseLrc } from './lrc.js';
import { dominantColor, ensureOnPaper, css } from './color.js';
import { BANDS, PRESETS, clampGain } from './eq.js';
import { SOURCES, search, resolve as resolveSource } from './sources.js';
import { searchLyrics, asLrc } from './lyrics.js';
import { Player } from './player.js';
import { BARS, binsFor } from './viz.js';
import * as q from './queue.js';

const $ = (id) => document.getElementById(id);

const el = {
  fileInput: $('file-input'),
  importBtn: $('import-btn'),
  clearBtn: $('clear-btn'),
  form: $('search-form'),
  search: $('search'),
  sourceNote: $('source-note'),
  resultsStatus: $('results-status'),
  results: $('results'),
  art: $('art'),
  title: $('title-text'),
  titleGhost: document.querySelector('.title-ghost'),
  subtitle: $('subtitle'),
  lyrics: $('lyrics'),
  lyricsLines: $('lyrics-lines'),
  visualizer: $('visualizer'),
  timeCurrent: $('time-current'),
  timeTotal: $('time-total'),
  seek: $('seek'),
  play: $('play'),
  prev: $('prev'),
  next: $('next'),
  shuffle: $('shuffle'),
  repeat: $('repeat'),
  repeatBadge: $('repeat-badge'),
  volume: $('volume'),
  mute: $('mute'),
  eqToggle: $('eq-toggle'),
  eqPanel: $('eq-panel'),
  eqClose: $('eq-close'),
  eqPresets: $('eq-presets'),
  eqSliders: $('eq-sliders'),
  eqNote: $('eq-note'),
  library: $('library'),
  libraryCount: $('library-count'),
  empty: $('empty'),
  toast: $('toast'),
  editionSource: $('edition-source'),
  editionCounts: $('edition-counts'),
};

const DEMO = { name: 'Waxwing — Glass.mp3', url: 'demo/demo.mp3', lyrics: 'demo/demo.lrc' };
const STORE_KEY = 'waxwing.settings.v3';

/** Live radio has no end and no length: the transport says so instead of lying. */
const isLive = () => Boolean(currentTrack()?.live);

const state = {
  tracks: new Map(),
  queue: q.createQueue([]),
  currentId: null,
  finds: [],
  source: 'deezer',
  nextId: 1,
  gains: [...PRESETS.flat],
  volume: 0.8,
  muted: false,
  lyrics: null,
  lastLyric: -1,
  lyricsByBase: new Map(),
  seeking: false,
};

let objectUrls = [];

/* ── helpers ──────────────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
const clock = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
};
const baseName = (name) => String(name || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3600);
}

function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

/* ── accent ────────────────────────────────────────────────────────────── */

function setAccent(color) {
  const accent = ensureOnPaper(color || { r: 179, g: 65, b: 10 });
  document.documentElement.style.setProperty('--accent', css(accent));
}

/**
 * Take the accent from a cover, when the cover allows it.
 *
 * Reading pixels out of a cross-origin image taints the canvas unless the
 * server sends `Access-Control-Allow-Origin`, so only hosts known to send it
 * are probed. Everywhere else the default spot colour stays, and the artwork
 * itself is unaffected — the plate image is a plain `<img>` and needs no CORS.
 */
const CORS_COVER_HOSTS = ['dzcdn.net', 'mzstatic.com', 'archive.org'];

function coverIsReadable(url) {
  try {
    const { hostname } = new URL(url);
    return CORS_COVER_HOSTS.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function accentFromImage(url) {
  if (!url || !coverIsReadable(url)) return;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, 32, 32);
      setAccent(dominantColor(ctx.getImageData(0, 0, 32, 32).data));
    } catch {
      /* tainted or undecodable: the default spot colour stays */
    }
  };
  image.src = url;
}

/* ── the player ────────────────────────────────────────────────────────── */

const player = new Player({
  onMode: (mode) => {
    document.body.dataset.mode = mode || 'web';
    const note = mode === 'html5'
      ? 'This source plays in HTML5 mode — the sound is untouched, so the equaliser and the spectrum do not apply.'
      : 'Equaliser and spectrum are in circuit for this track.';
    el.eqNote.textContent = note;
  },
  onReady: (duration) => {
    if (duration) {
      const track = currentTrack();
      if (track && !track.duration) {
        track.duration = duration;
        renderLibrary();
      }
    }
  },
  onEnded: () => advance('automatic'),
  onError: (message) => toast(message),
});

const currentTrack = () => state.tracks.get(state.currentId);

function advance(kind) {
  const nextId = q.next(state.queue, { automatic: kind === 'automatic' });
  if (nextId) selectTrack(nextId, { play: true });
  else {
    document.body.classList.remove('is-playing');
    toast('End of the running order.');
  }
}

function step(direction) {
  const nextId = direction > 0
    ? q.next(state.queue, { automatic: false })
    : q.previous(state.queue);
  if (nextId) selectTrack(nextId, { play: true });
}

/* ── library ───────────────────────────────────────────────────────────── */

function addTrack(input) {
  const id = `t${state.nextId++}`;
  const track = {
    id,
    source: input.source || 'local',
    title: input.title || 'Untitled',
    artist: input.artist || '',
    album: input.album || '',
    url: input.url,
    cover: input.cover || '',
    duration: input.duration || 0,
    format: input.format || '',
    live: Boolean(input.live),
    local: Boolean(input.local),
    demo: Boolean(input.demo),
  };
  state.tracks.set(id, track);
  q.append(state.queue, [id]);
  renderLibrary();
  return track;
}

function renderLibrary() {
  const ids = state.queue.ids;
  el.library.replaceChildren();
  el.libraryCount.textContent = `${ids.length} ${ids.length === 1 ? 'track' : 'tracks'} in the crate`;
  el.empty.hidden = ids.length > 0;
  el.editionCounts.textContent = `${ids.length} in the crate`;

  ids.forEach((id, index) => {
    const track = state.tracks.get(id);
    if (!track) return;

    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'library-item';
    button.dataset.id = id;
    button.setAttribute('aria-current', String(id === state.currentId));

    const indexEl = document.createElement('span');
    indexEl.className = 'library-index';
    indexEl.textContent = String(index + 1).padStart(2, '0');

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'library-title';
    title.textContent = track.title;
    const artist = document.createElement('span');
    artist.className = 'library-artist';
    artist.textContent = track.artist || (track.demo ? 'demo' : 'unknown artist');
    text.append(title, artist);

    const meta = document.createElement('span');
    meta.className = 'library-meta';
    meta.textContent = track.live ? 'live' : (track.duration ? clock(track.duration) : '');

    button.append(indexEl, text, meta);
    li.append(button);
    el.library.append(li);
  });
}

function selectTrack(id, { play = true } = {}) {
  const track = state.tracks.get(id);
  if (!track) return;

  state.currentId = id;
  q.jumpTo(state.queue, id);

  el.art.src = track.cover || '';
  el.art.style.display = track.cover ? '' : 'none';
  el.title.textContent = track.title;
  el.titleGhost.textContent = track.title;
  el.subtitle.textContent = [track.artist, track.album].filter(Boolean).join(' · ')
    || 'unknown artist';

  // Radio has no position and no length; a scrubber that cannot move is worse
  // than no scrubber.
  el.seek.disabled = Boolean(track.live);

  if (track.cover) accentFromImage(track.cover);
  else setAccent(null);

  loadLyricsFor(track);
  renderLibrary();

  player.load(track, { autoplay: play });
  syncTransport();
}

function syncTransport() {
  el.play.setAttribute('aria-label', player.playing() ? 'Pause' : 'Play');
}

/* ── searching ─────────────────────────────────────────────────────────── */

function setSource(source) {
  if (!SOURCES[source]) return;
  state.source = source;
  state.finds = [];

  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.source === source));
  }
  el.search.placeholder = SOURCES[source].placeholder;
  el.sourceNote.textContent = SOURCES[source].note;
  el.editionSource.textContent = SOURCES[source].label;
  el.results.replaceChildren();
  el.resultsStatus.textContent = '';
  renderResults();
}

let searchToken = 0;
let searchTimer;

async function runSearch() {
  const term = el.search.value.trim();
  const token = ++searchToken;

  if (term.length < 2) {
    state.finds = [];
    el.resultsStatus.textContent = '';
    renderResults();
    return;
  }

  el.resultsStatus.textContent = `Searching ${SOURCES[state.source].label}…`;
  try {
    const rows = await search(state.source, term);
    if (token !== searchToken) return;
    state.finds = rows;
    el.resultsStatus.textContent = rows.length
      ? `${rows.length} result${rows.length === 1 ? '' : 's'}`
      : 'Nothing found.';
    renderResults();
  } catch (err) {
    if (token !== searchToken) return;
    state.finds = [];
    el.resultsStatus.textContent = '';
    toast(`${SOURCES[state.source].label}: ${err.message}`);
    renderResults();
  }
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 320);
}

function renderResults() {
  el.results.replaceChildren();

  if (!state.finds.length) {
    if (el.resultsStatus.textContent) {
      const li = document.createElement('li');
      li.className = 'results-empty';
      li.textContent = 'Nothing in this catalogue matches.';
      el.results.append(li);
    }
    return;
  }

  state.finds.forEach((item, index) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result';

    const indexEl = document.createElement('span');
    indexEl.className = 'result-index';
    indexEl.textContent = String(index + 1).padStart(2, '0');

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'result-title';
    title.textContent = item.title;
    const artist = document.createElement('span');
    artist.className = 'result-artist';
    artist.textContent = item.artist || 'unknown artist';
    text.append(title, artist);

    const badge = document.createElement('span');
    badge.className = 'result-badge';
    badge.dataset.mode = SOURCES[item.source]?.mode || 'web';
    badge.textContent = `${item.live ? 'live · ' : ''}${SOURCES[item.source]?.label || item.source}`;

    button.append(indexEl, text, badge);
    button.addEventListener('click', () => cue(item));
    li.append(button);
    el.results.append(li);
  });
}

/** Cue a search result: resolve lazy sources, file it, play it. */
async function cue(item) {
  if (!item) return;
  el.resultsStatus.textContent = 'Fetching the file…';
  try {
    const resolved = await resolveSource(item);
    if (!resolved?.url) {
      toast('That item has no audio file.');
      el.resultsStatus.textContent = '';
      return;
    }
    const track = addTrack(resolved);
    selectTrack(track.id, { play: true });
    el.search.value = '';
    state.finds = [];
    el.resultsStatus.textContent = '';
    renderResults();
    persist();
  } catch (err) {
    toast(`${SOURCES[item.source]?.label || 'Source'}: ${err.message}`);
    el.resultsStatus.textContent = '';
  }
}

/* ── local files ───────────────────────────────────────────────────────── */

async function readTrack(file) {
  const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const tags = readTags(head, file.name);
  let cover = '';

  if (tags.picture?.data?.length) {
    const blob = new Blob([tags.picture.data.slice()], { type: tags.picture.mime || 'image/jpeg' });
    cover = objectUrl(blob);
  }

  return {
    source: 'local',
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    cover,
    url: objectUrl(file),
    format: (file.name.split('.').pop() || '').toLowerCase(),
    local: true,
  };
}

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  const lyricsFiles = files.filter((f) => /\.lrc$/i.test(f.name));
  for (const file of lyricsFiles) rememberLyrics(file.name, await file.text());

  const audioFiles = files.filter((f) =>
    /\.(mp3|flac|ogg|oga|m4a|aac|wav|opus|webm)$/i.test(f.name) || f.type.startsWith('audio/'));

  if (!audioFiles.length) {
    toast(lyricsFiles.length
      ? 'Lyrics added — drop the audio with the same name.'
      : 'No audio files in that drop.');
    return;
  }

  let added = 0;
  for (const file of audioFiles) {
    try {
      const track = addTrack(await readTrack(file));
      added += 1;
      if (!state.currentId) selectTrack(track.id, { play: false });
    } catch (err) {
      console.error('could not read', file.name, err);
    }
  }

  if (added) {
    toast(`Added ${added} ${added === 1 ? 'track' : 'tracks'}.`);
    persist();
  }
}

async function loadDemo() {
  try {
    const response = await fetch(DEMO.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const tags = readTags(bytes, DEMO.name);

    let cover = '';
    if (tags.picture?.data?.length) {
      cover = objectUrl(new Blob([tags.picture.data.slice()], { type: tags.picture.mime || 'image/jpeg' }));
    }

    try {
      const lrc = await fetch(DEMO.lyrics);
      if (lrc.ok) rememberLyrics(DEMO.lyrics, await lrc.text());
    } catch {
      /* lyrics are optional */
    }

    const track = addTrack({
      source: 'local',
      title: tags.title,
      artist: tags.artist || 'Waxwing',
      album: tags.album || 'Demo',
      cover,
      url: objectUrl(new Blob([bytes], { type: 'audio/mpeg' })),
      format: 'mp3',
      demo: true,
      local: true,
    });
    selectTrack(track.id, { play: false });
  } catch (err) {
    console.warn('demo unavailable:', err.message);
  }
}

/* ── lyrics ────────────────────────────────────────────────────────────── */

function rememberLyrics(fileName, text) {
  const { meta } = parseLrc(text);
  const keys = new Set([baseName(fileName)]);
  if (meta.ti) keys.add(baseName(meta.ti));
  for (const key of keys) if (key) state.lyricsByBase.set(key, text);
}

function loadLyricsFor(track) {
  const local = state.lyricsByBase.get(baseName(track.title));
  if (local) {
    showLyrics(local);
    return;
  }

  // No file beside the audio: ask LRClib. A live station has no fixed track,
  // so there is nothing to look up.
  showLyrics(null);
  if (!track.live) fetchLyrics(track);
}

let lyricsToken = 0;
async function fetchLyrics(track) {
  const token = ++lyricsToken;
  try {
    const entry = await searchLyrics({
      track: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
    });
    if (token !== lyricsToken) return; // a newer track has taken over
    showLyrics(entry ? asLrc(entry) : null);
  } catch {
    if (token === lyricsToken) showLyrics(null);
  }
}

function showLyrics(text) {
  const lines = text ? parseLrc(text).lines : null;
  state.lyrics = lines;
  state.lastLyric = -1;

  el.lyrics.hidden = !lines?.length;
  el.lyricsLines.replaceChildren();
  if (lines?.length) {
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line.text || '♪';
      el.lyricsLines.append(li);
    }
  }
}

function syncLyrics(time) {
  if (!state.lyrics?.length) return;
  const index = activeIndex(state.lyrics, time);
  if (index === state.lastLyric) return;
  state.lastLyric = index;

  [...el.lyricsLines.children].forEach((li, i) => li.classList.toggle('is-active', i === index));
  const active = el.lyricsLines.children[index];
  if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ── equaliser ─────────────────────────────────────────────────────────── */

function renderEq() {
  el.eqSliders.replaceChildren();
  BANDS.forEach((frequency, index) => {
    const band = document.createElement('label');
    band.className = 'eq-band';

    const label = document.createElement('span');
    label.className = 'eq-band-label';
    label.textContent = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '-12';
    slider.max = '12';
    slider.step = '1';
    slider.value = String(state.gains[index]);
    slider.setAttribute('aria-label', `${frequency} hertz`);
    slider.addEventListener('input', () => {
      state.gains[index] = clampGain(slider.value);
      player.setGains(state.gains);
      persist();
    });

    const value = document.createElement('span');
    value.className = 'eq-band-label';
    value.textContent = `${Number(state.gains[index]) > 0 ? '+' : ''}${state.gains[index]}`;

    band.append(label, slider, value);
    el.eqSliders.append(band);
  });

  markActivePreset();
}

/** Light the chip whose preset the current gains actually match. */
function markActivePreset() {
  const current = state.gains.join(',');
  for (const chip of el.eqPresets.querySelectorAll('[data-preset]')) {
    const preset = PRESETS[chip.dataset.preset];
    chip.classList.toggle('is-active', Boolean(preset) && preset.join(',') === current);
  }
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  state.gains = [...preset];
  player.setGains(state.gains);
  renderEq();
  persist();
}

/* ── visualiser ────────────────────────────────────────────────────────── */

function sizeCanvas() {
  const canvas = el.visualizer;
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function draw() {
  const canvas = el.visualizer;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  sizeCanvas();
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b3410a';
  const spectrum = player.spectrum();

  if (!spectrum) {
    // No graph in circuit (HTML5 mode, or nothing loaded yet): a ruled line,
    // and an honest label when the source is the reason.
    ctx.fillStyle = 'rgb(23 19 15 / 0.28)';
    ctx.fillRect(0, height / 2 - 0.5, width, 1);

    if (player.trackMode === 'html5') {
      ctx.fillStyle = 'rgb(23 19 15 / 0.55)';
      ctx.font = `${Math.max(10, Math.round(height * 0.15))}px ui-monospace, Menlo, monospace`;
      ctx.textBaseline = 'middle';
      ctx.fillText('SPECTRUM UNAVAILABLE — THIS SOURCE PLAYS IN HTML5 MODE', 10, height / 2 - 11);
    }
    return;
  }

  const { data, sampleRate } = spectrum;
  const nyquist = sampleRate / 2;
  const barWidth = width / BARS;

  for (let i = 0; i < BARS; i += 1) {
    const [from, to] = binsFor(i, data.length, nyquist);
    let sum = 0;
    for (let bin = from; bin <= to; bin += 1) sum += data[bin];
    const value = sum / (to - from + 1) / 255;

    const barHeight = Math.max(1.5, value ** 1.15 * height * 0.94);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.24 + value * 0.76;
    ctx.fillRect(i * barWidth + barWidth * 0.22, (height - barHeight) / 2, barWidth * 0.56, barHeight);
  }
  ctx.globalAlpha = 1;
}

/* ── the clock loop ────────────────────────────────────────────────────── */

function tick() {
  requestAnimationFrame(tick);

  const playing = player.playing();
  document.body.classList.toggle('is-playing', playing);

  if (!state.seeking) {
    const time = player.time();
    const duration = player.duration();
    const live = isLive();

    el.timeCurrent.textContent = live ? 'LIVE' : clock(time);
    el.timeTotal.textContent = live ? '' : clock(duration);
    if (duration && !live) {
      el.seek.value = String(Math.round((time / duration) * 1000));
      el.seek.style.setProperty('--progress', `${(time / duration) * 100}%`);
    }
    syncLyrics(time);
  }

  draw();
}

/* ── settings ──────────────────────────────────────────────────────────── */

function persist() {
  try {
    const saved = [...state.tracks.values()]
      .filter((t) => !t.local && t.url)
      .slice(-400)
      .map(({ id, ...track }) => track);
    localStorage.setItem(STORE_KEY, JSON.stringify({
      gains: state.gains,
      volume: state.volume,
      muted: state.muted,
      source: state.source,
      shuffle: state.queue.shuffle,
      repeat: state.queue.repeat,
      nextId: state.nextId,
      tracks: saved,
    }));
  } catch {
    /* private mode: the player still works */
  }
}

function restore() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    saved = {};
  }

  if (Array.isArray(saved.gains) && saved.gains.length === BANDS.length) {
    state.gains = saved.gains.map(clampGain);
  }
  if (Number.isFinite(saved.volume)) state.volume = Math.min(1, Math.max(0, saved.volume));
  if (typeof saved.muted === 'boolean') state.muted = saved.muted;
  if (SOURCES[saved.source]) state.source = saved.source;
  if (saved.shuffle) q.setShuffle(state.queue, true);
  if (['off', 'all', 'one'].includes(saved.repeat)) q.setRepeat(state.queue, saved.repeat);

  if (Array.isArray(saved.tracks)) {
    for (const track of saved.tracks.filter((t) => t && t.url && SOURCES[t.source])) {
      addTrack(track);
    }
  }
  state.nextId = Math.max(state.nextId, Number(saved.nextId) || 0);
}

/* ── wiring ────────────────────────────────────────────────────────────── */

function syncControls() {
  el.shuffle.setAttribute('aria-pressed', String(state.queue.shuffle));
  el.repeat.setAttribute('aria-pressed', String(state.queue.repeat !== 'off'));
  el.repeatBadge.hidden = state.queue.repeat !== 'one';
  el.mute.setAttribute('aria-pressed', String(state.muted));
  el.volume.value = String(Math.round(state.volume * 100));
  player.setVolume(state.volume);
  player.setMuted(state.muted);
}

function wire() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      setSource(tab.dataset.source);
      runSearch();
    });
  }

  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });
  el.search.addEventListener('input', scheduleSearch);

  el.library.addEventListener('click', (event) => {
    const button = event.target.closest('.library-item');
    if (button) selectTrack(button.dataset.id);
  });

  el.play.addEventListener('click', () => {
    if (!state.currentId) {
      const first = state.queue.ids[0];
      if (first) selectTrack(first);
      return;
    }
    player.toggle();
  });
  el.next.addEventListener('click', () => step(1));
  el.prev.addEventListener('click', () => step(-1));

  el.shuffle.addEventListener('click', () => {
    q.setShuffle(state.queue, !state.queue.shuffle);
    syncControls();
    persist();
    toast(state.queue.shuffle ? 'Shuffle on.' : 'Shuffle off.');
  });

  el.repeat.addEventListener('click', () => {
    const order = ['off', 'all', 'one'];
    const at = order.indexOf(state.queue.repeat);
    q.setRepeat(state.queue, order[(at + 1) % order.length]);
    syncControls();
    persist();
    toast(`Repeat: ${state.queue.repeat}.`);
  });

  el.seek.addEventListener('input', () => {
    state.seeking = true;
    const duration = player.duration();
    const fraction = Number(el.seek.value) / 1000;
    el.seek.style.setProperty('--progress', `${fraction * 100}%`);
    el.timeCurrent.textContent = clock(fraction * duration);
  });
  el.seek.addEventListener('change', () => {
    state.seeking = false;
    player.seek((Number(el.seek.value) / 1000) * player.duration());
  });

  el.volume.addEventListener('input', () => {
    state.volume = Number(el.volume.value) / 100;
    player.setVolume(state.volume);
    persist();
  });

  el.mute.addEventListener('click', () => {
    state.muted = !state.muted;
    player.setMuted(state.muted);
    syncControls();
    persist();
  });

  el.eqToggle.addEventListener('click', () => {
    const opening = el.eqPanel.hidden;
    el.eqPanel.hidden = !opening;
    el.eqToggle.setAttribute('aria-expanded', String(opening));
  });
  el.eqClose.addEventListener('click', () => {
    el.eqPanel.hidden = true;
    el.eqToggle.setAttribute('aria-expanded', 'false');
  });
  el.eqPresets.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-preset]');
    if (chip) applyPreset(chip.dataset.preset);
  });

  el.importBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => {
    addFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  el.clearBtn.addEventListener('click', () => {
    player.unload();
    state.currentId = null;
    state.tracks.clear();
    state.queue = q.createQueue([]);
    state.lyrics = null;
    el.lyrics.hidden = true;
    el.lyricsLines.replaceChildren();
    el.title.textContent = 'Nothing cued';
    el.titleGhost.textContent = 'Nothing cued';
    el.subtitle.textContent = 'Search a catalogue, or drop your own files anywhere on this page.';
    el.art.removeAttribute('src');
    el.art.style.display = 'none';
    setAccent(null);
    renderLibrary();
    persist();
    toast('The crate is empty.');
  });

  // Drop anywhere on the window, so a miss does not navigate away.
  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    document.body.classList.add('is-dragging');
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('is-dragging');
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
  });

  document.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.metaKey || event.ctrlKey) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        el.play.click();
        break;
      case 'ArrowRight':
        player.seek(player.time() + 5);
        break;
      case 'ArrowLeft':
        player.seek(player.time() - 5);
        break;
      case 'n': step(1); break;
      case 'p': step(-1); break;
      case 'm': el.mute.click(); break;
      case 'e': el.eqToggle.click(); break;
      default: break;
    }
  });
}

/* ── boot ──────────────────────────────────────────────────────────────── */

async function boot() {
  window.addEventListener('error', (event) => {
    document.documentElement.dataset.ready = 'error';
    toast(`Waxwing could not start: ${event.message}`);
  });

  player.setGains(state.gains);
  restore();
  setSource(state.source);
  renderEq();
  syncControls();
  wire();
  renderLibrary();
  requestAnimationFrame(tick);
  await loadDemo();
  syncControls();

  document.documentElement.dataset.ready = 'ready';
}

boot();

// A handle for the smoke test and for debugging in the console. Not part of
// the UI; nothing here is required for the player to work.
window.__wax = { player, state, setAccent };
