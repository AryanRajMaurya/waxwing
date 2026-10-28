/**
 * IZGIV, in the browser.
 *
 * The original was an Electron app: a Node sidecar proxied the audio, the
 * renderer drew the glass. This keeps the parts that mattered -- the warm
 * glass, the accent that follows the cover, the equalizer, the queue -- and
 * drops the parts that made it fragile: nothing is downloaded, nothing is
 * proxied, and the music is whatever is already on the disk.
 *
 * Everything below the UI is a pure module with tests behind it:
 *   tags.js   ID3v2 reader        queue.js  play order and repeat
 *   lrc.js    lyric timing        color.js  accent from the cover
 *   eq.js     the filter chain
 */

import { readTags } from './tags.js';
import { activeIndex, parseLrc } from './lrc.js';
import { BANDS, PRESETS, clampGain, createEq } from './eq.js';
import { dominantColor, ensureReadable, css } from './color.js';
import { youTubeId, youTubeThumb, YT_STATE } from './yt.js';
import * as q from './queue.js';

const $ = (id) => document.getElementById(id);

const el = {
  fileInput: $('file-input'),
  importBtn: $('import-btn'),
  ytBtn: $('yt-btn'),
  ytHost: $('yt-host'),
  demoBtn: $('demo-btn'),
  search: $('search'),
  library: $('library'),
  count: $('library-count'),
  empty: $('empty'),
  art: $('art'),
  artFallback: $('art-fallback'),
  title: $('title'),
  subtitle: $('subtitle'),
  visualizer: $('visualizer'),
  lyrics: $('lyrics'),
  lyricsLines: $('lyrics-lines'),
  play: $('play'),
  prev: $('prev'),
  next: $('next'),
  shuffle: $('shuffle'),
  repeat: $('repeat'),
  repeatBadge: $('repeat-badge'),
  seek: $('seek'),
  current: $('time-current'),
  total: $('time-total'),
  volume: $('volume'),
  mute: $('mute'),
  eqToggle: $('eq-toggle'),
  eqPanel: $('eq-panel'),
  eqClose: $('eq-close'),
  eqSliders: $('eq-sliders'),
  audio: $('audio'),
  toast: $('toast'),
};

const DEMO = { name: 'IZGIV — Demo.mp3', url: 'demo/demo.mp3', lyrics: 'demo/demo.lrc' };

/*
 * YouTube.
 *
 * The embedded player replaces the art frame while a YouTube track is up.
 * It is created once and re-used: the IFrame API is one script the browser
 * caches, and a fresh player per track would flash a black rectangle.
 */
const youTube = {
  api: null, // the promise for window.YT
  player: null, // the YT.Player
  videoFor: null, // track id currently loaded in the player
};

const state = {
  tracks: new Map(), // id -> track
  ids: [], // library order
  queue: q.createQueue([]),
  currentId: null,
  lyrics: null,
  lyricsFor: null,
  lrcByBase: new Map(), // "song name" -> lrc text, waiting for its audio
  gains: [...PRESETS.flat],
  graph: null,
  nextId: 1,
  seeking: false,
};

/* ── small helpers ──────────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
const clock = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
};

const baseName = (name) => name.replace(/\.[a-z0-9]+$/i, '').toLowerCase();

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
}

/* ── the audio graph ────────────────────────────────────────────────────── */

/**
 * Build the Web Audio graph on the first play.
 *
 * Browsers refuse an AudioContext before a gesture, and a media element can
 * only be routed through one source node, so this happens exactly once.
 */
function ensureGraph() {
  if (state.graph) {
    if (state.graph.context.state === 'suspended') state.graph.context.resume();
    return state.graph;
  }

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  const context = new Ctx();
  const source = context.createMediaElementSource(el.audio);
  const eq = createEq(context, state.gains);
  const analyser = context.createAnalyser();
  // 2048 bins is 21 Hz per bar at 44.1 kHz -- fine enough to separate a bass
  // line from a kick. The default 256 bins are 172 Hz wide, which lumps the
  // whole low end into four bars and leaves the top half of the display dark.
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  // source -> eq -> analyser -> speakers
  source.connect(eq.input);
  eq.output.connect(analyser);
  analyser.connect(context.destination);

  state.graph = { context, source, eq, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
  return state.graph;
}

/* ── accent from the cover ──────────────────────────────────────────────── */

function setAccent(color) {
  const readable = ensureReadable(color);
  document.documentElement.style.setProperty('--accent', css(readable));
  document.documentElement.style.setProperty('--accent-soft', css(readable, 0.18));
  document.documentElement.style.setProperty('--on-accent', '#12100e');
}

/** Average the cover down to a thumbnail and take its dominant colour. */
function accentFromImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, 32, 32);
        resolve(dominantColor(ctx.getImageData(0, 0, 32, 32).data));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/* ── the library ────────────────────────────────────────────────────────── */

let objectUrls = [];
function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

function addTrack({ title, artist, album, url, coverUrl, duration = 0, demo = false, source = 'local' }) {
  const id = `t${state.nextId++}`;
  const track = { id, title, artist, album, url, coverUrl, duration, demo, source };
  state.tracks.set(id, track);
  state.ids.push(id);
  q.append(state.queue, [id]);
  renderLibrary();
  return track;
}

function visibleTracks() {
  const needle = el.search.value.trim().toLowerCase();
  const ids = state.ids;
  if (!needle) return ids;
  return ids.filter((id) => {
    const t = state.tracks.get(id);
    return `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(needle);
  });
}

function renderLibrary() {
  const ids = visibleTracks();
  el.library.replaceChildren();
  el.count.textContent = `${state.ids.length} ${state.ids.length === 1 ? 'track' : 'tracks'}`;
  el.empty.hidden = state.ids.length > 0;

  for (const id of ids) {
    const track = state.tracks.get(id);
    const li = document.createElement('li');

    const button = document.createElement('button');
    button.className = 'library-item';
    button.type = 'button';
    button.dataset.id = id;
    button.setAttribute('aria-current', String(id === state.currentId));

    const art = document.createElement('img');
    art.className = 'library-art';
    art.alt = '';
    if (track.coverUrl) art.src = track.coverUrl;
    else art.src = 'icon.svg';

    const text = document.createElement('span');
    text.className = 'library-text';
    const title = document.createElement('span');
    title.className = 'library-title';
    title.textContent = track.title;
    const artist = document.createElement('span');
    artist.className = 'library-artist';
    artist.textContent = track.artist || (track.demo ? 'demo' : 'unknown artist');
    text.append(title, artist);

    const time = document.createElement('span');
    time.className = 'library-time';
    time.textContent = track.duration ? clock(track.duration) : '—';

    button.append(art, text, time);
    if (track.demo) {
      const badge = document.createElement('span');
      badge.className = 'library-time';
      badge.textContent = 'demo';
      badge.hidden = true; // the artist line already says it
    }
    li.append(button);
    el.library.append(li);
  }
}

/* ── importing ──────────────────────────────────────────────────────────── */

/**
 * Read one audio file.
 *
 * ID3 tags sit at the front, so the first megabyte is enough for the title,
 * the artist and the cover; reading the whole file would stall on a big FLAC.
 */
async function readTrack(file) {
  const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const tags = readTags(head, file.name);
  let coverUrl = '';

  if (tags.picture?.data?.length) {
    // The picture is a `Uint8Array` view over the file's buffer; copy it so the
    // blob is not tied to the parent array.
    const blob = new Blob([tags.picture.data.slice()], { type: tags.picture.mime || 'image/jpeg' });
    coverUrl = objectUrl(blob);
  }

  return {
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    coverUrl,
    url: objectUrl(file),
    size: file.size,
  };
}

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  const lyricsFiles = files.filter((f) => /\.lrc$/i.test(f.name));
  for (const file of lyricsFiles) {
    rememberLyrics(file.name, await file.text());
  }

  const audioFiles = files.filter((f) => /\.(mp3|flac|ogg|oga|m4a|aac|wav|opus|webm)$/i.test(f.name) || f.type.startsWith('audio/'));
  if (!audioFiles.length) {
    if (lyricsFiles.length) toast('Lyrics added — drop the audio with the same name.');
    else toast('No audio files in that drop.');
    return;
  }

  let added = 0;
  for (const file of audioFiles) {
    try {
      const info = await readTrack(file);
      const track = addTrack(info);
      added += 1;
      if (!state.currentId) selectTrack(track.id, { play: false });
    } catch (err) {
      console.error('could not read', file.name, err);
    }
  }

  if (added) toast(`Added ${added} ${added === 1 ? 'track' : 'tracks'}.`);
}

/** Load the bundled demo so the page does something before any import. */
async function loadDemo() {
  try {
    const response = await fetch(DEMO.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const tags = readTags(bytes, DEMO.name);
    let coverUrl = '';
    if (tags.picture?.data?.length) {
      coverUrl = objectUrl(new Blob([tags.picture.data.slice()], { type: tags.picture.mime || 'image/jpeg' }));
    }

    // The lyrics are optional: a missing .lrc must not stop the demo loading.
    try {
      const lrc = await fetch(DEMO.lyrics);
      if (lrc.ok) rememberLyrics(DEMO.lyrics, await lrc.text());
    } catch (err) {
      console.warn('demo lyrics unavailable:', err.message);
    }

    const track = addTrack({
      title: tags.title,
      artist: tags.artist || 'IZGIV',
      album: tags.album || 'Demo',
      coverUrl,
      url: objectUrl(new Blob([bytes], { type: 'audio/mpeg' })),
      demo: true,
    });
    selectTrack(track.id, { play: false });
  } catch (err) {
    console.warn('demo track unavailable:', err.message);
  }
}

/* ── playback ───────────────────────────────────────────────────────────── */

function selectTrack(id, { play = true } = {}) {
  const track = state.tracks.get(id);
  if (!track) return;

  state.currentId = id;
  q.jumpTo(state.queue, id);

  const isYouTube = track.source === 'youtube';
  document.body.classList.toggle('on-youtube', isYouTube);

  if (isYouTube) {
    // The local audio must stop: two songs at once is the classic bug here.
    el.audio.pause();
    el.audio.removeAttribute('src');
    el.audio.load();

    el.art.classList.remove('is-visible');
    el.artFallback.classList.add('is-hidden');
    el.ytHost.hidden = false;
    // A thumbnail as art source for the library row and, later, if the track
    // is revisited.
    track.coverUrl ||= youTubeThumb(track.url);
    setAccent({ r: 170, g: 120, b: 80 }); // keep the default warmth; thumbs are cross-origin

    mountYouTube(track, play);
  } else {
    youTube.player?.pauseVideo?.();
    youTube.videoFor = null;
    el.ytHost.hidden = true;

    el.audio.src = track.url;
    el.audio.load();

    if (track.coverUrl) {
      el.art.src = track.coverUrl;
      el.art.classList.add('is-visible');
      el.artFallback.classList.add('is-hidden');
      accentFromImage(track.coverUrl).then((color) => { if (color) setAccent(color); });
    } else {
      el.art.removeAttribute('src');
      el.art.classList.remove('is-visible');
      el.artFallback.classList.remove('is-hidden');
      setAccent({ r: 198, g: 148, b: 92 });
    }
  }

  el.title.textContent = track.title;
  el.subtitle.textContent = [track.artist, track.album].filter(Boolean).join(' · ') || 'unknown artist';

  loadLyricsFor(track);
  renderLibrary();
  document.title = `${track.title} — IZGIV`;

  if (play && !isYouTube) playAudio();
}

async function playAudio() {
  ensureGraph();
  try {
    await el.audio.play();
  } catch (err) {
    // Autoplay policy: the first play needs a gesture, which the click was.
    console.warn('playback was refused:', err.message);
  }
}

/** The current track, or null when nothing is up. */
const currentTrack = () => state.tracks.get(state.currentId);
const youTubeUpToDate = () =>
  currentTrack()?.source === 'youtube' && youTube.player && youTube.videoFor === state.currentId;

function stopYouTube() {
  try {
    youTube.player?.pauseVideo?.();
  } catch {
    /* the iframe may already be gone */
  }
  youTube.videoFor = null;
}

async function mountYouTube(track, play) {
  try {
    if (!youTube.api) {
      youTube.api = new Promise((resolve, reject) => {
        const done = () => (window.YT?.Player ? resolve(window.YT) : null);
        if (done()) return resolve(window.YT);
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          previous?.();
          resolve(window.YT);
        };
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.onerror = () => reject(new Error('YouTube could not be reached from this network'));
        document.head.append(script);
      });
    }

    const YT = await youTube.api;
    if (!youTube.player) {
      youTube.player = new YT.Player('yt-host', {
        playerVars: { rel: 0, playsinline: 1, origin: location.origin },
        events: {
          onError: () => toast('YouTube refused to play that video.'),
        },
      });
      youTube.player.addEventListener('onStateChange', (event) => onYouTubeState(event));
    }

    if (play) {
      youTube.videoFor = track.id;
      // setVolume first: the iframe starts at YouTube's default (often 5%).
      youTube.player.setVolume(Number(el.volume.value));
      youTube.player.loadVideoById(track.url);
    }
  } catch (err) {
    console.warn('youtube:', err.message);
    toast(err.message);
  }
}

function onYouTubeState(event) {
  const playerState = event.data;

  if (playerState === YT_STATE.PLAYING) {
    document.body.classList.add('is-playing');
    // The real title and channel arrive with the video; a pasted id is a
    // poor label for either.
    const track = state.tracks.get(youTube.videoFor);
    const data = youTube.player.getVideoData?.();
    if (track && data?.title && track.title !== data.title) {
      track.title = data.title;
      track.artist = data.author || 'YouTube';
      if (state.currentId === track.id) {
        el.title.textContent = track.title;
        el.subtitle.textContent = [track.artist, track.album].filter(Boolean).join(' · ');
        document.title = `${track.title} — IZGIV`;
      }
      renderLibrary();
    }
  } else if (playerState === YT_STATE.PAUSED) {
    document.body.classList.remove('is-playing');
  } else if (playerState === YT_STATE.ENDED) {
    document.body.classList.remove('is-playing');
    const nextId = q.next(state.queue, { automatic: true });
    if (nextId) selectTrack(nextId);
  }
}

/**
 * The YouTube iframe gives no timeupdate event, so the clock, the seek bar
 * and the lyrics are fed from the draw loop instead — a few times a second
 * is finer than a song needs and coarser than the reader cares about.
 */
let lastYtPoll = 0;
function syncFromYouTube(now) {
  if (state.seeking || !youTubeUpToDate() || now - lastYtPoll < 250) return;
  lastYtPoll = now;

  const player = youTube.player;
  const time = player.getCurrentTime?.() || 0;
  const duration = player.getDuration?.() || 0;

  el.current.textContent = clock(time);
  if (duration > 0) {
    el.seek.value = String(Math.round((time / duration) * 1000));
    el.seek.style.setProperty('--progress', `${(time / duration) * 100}%`);
  }
  syncLyrics(time);
}

function togglePlay() {
  if (!state.currentId) {
    if (state.ids.length) selectTrack(state.ids[0]);
    return;
  }

  if (currentTrack()?.source === 'youtube') {
    if (!youTubeUpToDate()) {
      mountYouTube(currentTrack(), true);
      return;
    }
    const playing = youTube.player.getPlayerState?.() === YT_STATE.PLAYING;
    if (playing) {
      youTube.player.pauseVideo();
      document.body.classList.remove('is-playing');
    } else {
      youTube.player.setVolume(Number(el.volume.value));
      youTube.player.playVideo();
    }
    return;
  }

  if (el.audio.paused) playAudio();
  else el.audio.pause();
}

function step(direction) {
  const nextId = direction > 0
    ? q.next(state.queue, { automatic: false })
    : q.previous(state.queue);

  if (!nextId) {
    el.audio.pause();
    el.audio.currentTime = 0;
    stopYouTube();
    document.body.classList.remove('is-playing');
    toast('End of the queue.');
    return;
  }
  selectTrack(nextId);
}

/* ── lyrics ─────────────────────────────────────────────────────────────── */

/**
 * Remember an .lrc under every name it could be looked up by.
 *
 * A file called `demo.lrc` sitting next to `Glass.mp3` would otherwise never
 * match: the lookup is by track title. The tag inside the lyric file is the
 * reliable name, so that wins when it is there.
 */
function rememberLyrics(fileName, text) {
  const { meta } = parseLrc(text);
  const keys = new Set([baseName(fileName)]);
  if (meta.ti) keys.add(baseName(meta.ti));
  for (const key of keys) if (key) state.lrcByBase.set(key, text);
}

function loadLyricsFor(track) {
  const base = baseName(track.title || '');
  const text = state.lrcByBase.get(base);
  state.lyrics = text ? parseLrc(text).lines : null;
  state.lyricsFor = text ? track.id : null;

  el.lyrics.hidden = !state.lyrics?.length;
  document.body.classList.toggle('has-lyrics', Boolean(state.lyrics?.length));
  el.lyricsLines.replaceChildren();

  if (state.lyrics?.length) {
    for (const line of state.lyrics) {
      const li = document.createElement('li');
      li.textContent = line.text || '♪';
      el.lyricsLines.append(li);
    }
  }
}

let lastLyricIndex = -1;
function syncLyrics(time) {
  if (!state.lyrics?.length) return;
  const index = activeIndex(state.lyrics, time);
  if (index === lastLyricIndex) return;
  lastLyricIndex = index;

  [...el.lyricsLines.children].forEach((li, i) => {
    li.classList.toggle('is-active', i === index);
  });
  const active = el.lyricsLines.children[index];
  if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ── the equalizer panel ────────────────────────────────────────────────── */

function renderEq() {
  el.eqSliders.replaceChildren();
  BANDS.forEach((frequency, index) => {
    const band = document.createElement('div');
    band.className = 'eq-band';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '-12';
    slider.max = '12';
    slider.step = '1';
    slider.value = String(state.gains[index]);
    slider.setAttribute('aria-label', `${frequency} Hz`);
    slider.addEventListener('input', () => {
      state.gains[index] = clampGain(slider.value);
      state.graph?.eq.setGains(state.gains);
      persist();
    });

    const label = document.createElement('span');
    label.textContent = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);

    band.append(slider, label);
    el.eqSliders.append(band);
  });
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  state.gains = [...preset];
  state.graph?.eq.setGains(state.gains);
  renderEq();
  persist();
}

/* ── visualizer ─────────────────────────────────────────────────────────── */

const BARS = 56;
const MIN_HZ = 40;
const MAX_HZ = 14000;
const LOG_SPAN = Math.log(MAX_HZ / MIN_HZ);

/**
 * Which analysis bins feed bar `index`.
 *
 * Frequencies are laid out logarithmically because hearing is: with linear
 * bars, an entire bassline and a kick drum fight over the first two bars and
 * the remaining fifty sit dark. Each bar owns every bin between its lower and
 * upper edge, so wide treble bands still sum up to something visible.
 */
function binsFor(index, total, nyquist = 22050) {
  const lowEdge = MIN_HZ * Math.exp((index / BARS) * LOG_SPAN);
  const highEdge = MIN_HZ * Math.exp(((index + 1) / BARS) * LOG_SPAN);
  const from = Math.floor((lowEdge / nyquist) * total);
  const to = Math.max(from, Math.ceil((highEdge / nyquist) * total) - 1);
  return [Math.max(1, from), Math.min(total - 1, to)];
}

let rafId = 0;

/**
 * Match the backing store to the CSS box.
 *
 * A canvas with a fixed 720x120 backing store stretched to a 900 px column is
 * drawn through a blur filter by the browser. Sizing it to the real box (times
 * the device pixel ratio) makes the bars crisp on a retina screen.
 */
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
  rafId = requestAnimationFrame(draw);
  const canvas = el.visualizer;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  sizeCanvas();
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  syncFromYouTube(performance.now());

  const graph = state.graph;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c6945c';

  if (!graph) {
    // Idle: a flat line, so the panel does not look broken before first play.
    ctx.fillStyle = 'rgba(245,239,228,0.12)';
    ctx.fillRect(0, height / 2 - 0.5, width, 1);
    return;
  }

  graph.analyser.getByteFrequencyData(graph.data);
  const barWidth = width / BARS;
  const nyquist = graph.context.sampleRate / 2;

  for (let i = 0; i < BARS; i += 1) {
    const [from, to] = binsFor(i, graph.data.length, nyquist);
    let sum = 0;
    for (let bin = from; bin <= to; bin += 1) sum += graph.data[bin];
    const value = sum / (to - from + 1) / 255;

    const barHeight = Math.max(1.5, value ** 1.15 * height * 0.92);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.22 + value * 0.78;
    ctx.fillRect(i * barWidth + barWidth * 0.2, (height - barHeight) / 2, barWidth * 0.6, barHeight);
  }
  ctx.globalAlpha = 1;
}

/* ── settings ───────────────────────────────────────────────────────────── */

const STORE_KEY = 'izgiv.settings.v1';

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      gains: state.gains,
      volume: Number(el.volume.value),
      shuffle: state.queue.shuffle,
      repeat: state.queue.repeat,
    }));
  } catch {
    /* private mode, or no storage: the app still plays */
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
  if (Number.isFinite(saved.volume)) el.volume.value = String(saved.volume);
  if (saved.shuffle) q.setShuffle(state.queue, true);
  if (['off', 'all', 'one'].includes(saved.repeat)) q.setRepeat(state.queue, saved.repeat);
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

function syncControls() {
  el.shuffle.setAttribute('aria-pressed', String(state.queue.shuffle));
  el.repeat.setAttribute('aria-pressed', String(state.queue.repeat !== 'off'));
  el.repeatBadge.hidden = state.queue.repeat !== 'one';
  el.audio.volume = Number(el.volume.value) / 100;
  el.audio.muted = el.mute.getAttribute('aria-pressed') === 'true';
  el.volume.style.setProperty('--progress', `${el.volume.value}%`);
}

/**
 * Add a YouTube link as a track.
 *
 * The title is fetched from YouTube's oEmbed endpoint, which is public and
 * carries no key; if the fetch is refused the video id stands in until the
 * player itself reports the real title.
 */
async function addYouTube() {
  const input = prompt('Paste a YouTube link or video id:');
  if (!input) return;

  const videoId = youTubeId(input);
  if (!videoId) {
    toast('That does not look like a YouTube link.');
    return;
  }

  const track = addTrack({
    title: videoId,
    artist: 'YouTube',
    url: videoId,
    coverUrl: youTubeThumb(videoId),
    source: 'youtube',
  });

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    );
    if (response.ok) {
      const meta = await response.json();
      track.title = meta.title || track.title;
      track.artist = meta.author_name || 'YouTube';
      renderLibrary();
      if (state.currentId === track.id) {
        el.title.textContent = track.title;
        el.subtitle.textContent = [track.artist, track.album].filter(Boolean).join(' · ');
        document.title = `${track.title} — IZGIV`;
      }
    }
  } catch {
    /* offline, or oEmbed refused: the id is a workable label meanwhile */
  }

  selectTrack(track.id);
}

function wire() {
  el.importBtn.addEventListener('click', () => el.fileInput.click());
  el.ytBtn.addEventListener('click', addYouTube);
  el.fileInput.addEventListener('change', () => {
    addFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  el.demoBtn.addEventListener('click', () => {
    const demo = [...state.tracks.values()].find((t) => t.demo);
    if (demo) selectTrack(demo.id);
    else loadDemo().then(() => {
      const found = [...state.tracks.values()].find((t) => t.demo);
      if (found) selectTrack(found.id);
    });
  });

  el.search.addEventListener('input', renderLibrary);

  el.library.addEventListener('click', (event) => {
    const button = event.target.closest('.library-item');
    if (button) selectTrack(button.dataset.id);
  });

  el.play.addEventListener('click', togglePlay);
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
    const duration = el.audio.duration || 0;
    const fraction = Number(el.seek.value) / 1000;
    el.seek.style.setProperty('--progress', `${fraction * 100}%`);
    if (youTubeUpToDate()) {
      const ytDuration = youTube.player.getDuration?.() || 0;
      el.current.textContent = clock(fraction * ytDuration);
      return;
    }
    el.current.textContent = clock(fraction * duration);
  });

  el.seek.addEventListener('change', () => {
    const fraction = Number(el.seek.value) / 1000;
    if (youTubeUpToDate()) {
      const duration = youTube.player.getDuration?.() || 0;
      if (duration) youTube.player.seekTo(fraction * duration, true);
    } else {
      const duration = el.audio.duration || 0;
      if (duration) el.audio.currentTime = fraction * duration;
    }
    state.seeking = false;
  });

  el.volume.addEventListener('input', () => {
    syncControls();
    // The EQ's preamp does not touch this path: YouTube's own player holds
    // its volume.
    youTube.player?.setVolume?.(Number(el.volume.value));
    persist();
  });

  el.mute.addEventListener('click', () => {
    const muted = el.mute.getAttribute('aria-pressed') === 'true';
    el.mute.setAttribute('aria-pressed', String(!muted));
    if (youTube.player) (!muted ? youTube.player.unMute?.() : youTube.player.mute?.());
    syncControls();
  });

  el.eqToggle.addEventListener('click', () => {
    // The filters sit between the local audio element and the speakers. A
    // YouTube track bypasses that path entirely, so say so once instead of
    // letting someone push a slider that cannot do anything.
    if (currentTrack()?.source === 'youtube' && el.eqPanel.hidden) {
      toast('The equalizer shapes local files. YouTube brings its own audio.');
    }
    el.eqPanel.hidden = !el.eqPanel.hidden;
  });
  el.eqClose.addEventListener('click', () => { el.eqPanel.hidden = true; });

  el.eqPanel.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-preset]');
    if (chip) applyPreset(chip.dataset.preset);
  });

  el.audio.addEventListener('play', () => document.body.classList.add('is-playing'));
  el.audio.addEventListener('pause', () => document.body.classList.remove('is-playing'));

  el.audio.addEventListener('loadedmetadata', () => {
    el.total.textContent = clock(el.audio.duration);
    const track = state.tracks.get(state.currentId);
    if (track && Number.isFinite(el.audio.duration)) {
      track.duration = el.audio.duration;
      renderLibrary();
    }
  });

  el.audio.addEventListener('timeupdate', () => {
    const duration = el.audio.duration || 0;
    if (!state.seeking) {
      el.current.textContent = clock(el.audio.currentTime);
      el.seek.value = duration ? String(Math.round((el.audio.currentTime / duration) * 1000)) : '0';
      el.seek.style.setProperty('--progress', `${duration ? (el.audio.currentTime / duration) * 100 : 0}%`);
    }
    syncLyrics(el.audio.currentTime);
  });

  el.audio.addEventListener('ended', () => {
    const nextId = q.next(state.queue, { automatic: true });
    if (nextId) selectTrack(nextId);
    else {
      document.body.classList.remove('is-playing');
      el.audio.currentTime = 0;
    }
  });

  // Drop anywhere. The window is the target so a miss does not navigate away.
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

    // Works for both sources: five seconds is five seconds.
    const duration = youTubeUpToDate()
      ? youTube.player.getDuration?.() || 0
      : el.audio.duration || 0;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight': {
        const target = Math.min(duration, (youTubeUpToDate()
          ? youTube.player.getCurrentTime?.() || 0
          : el.audio.currentTime) + 5);
        if (youTubeUpToDate()) youTube.player.seekTo(target, true);
        else el.audio.currentTime = target;
        break;
      }
      case 'ArrowLeft': {
        const target = Math.max(0, (youTubeUpToDate()
          ? youTube.player.getCurrentTime?.() || 0
          : el.audio.currentTime) - 5);
        if (youTubeUpToDate()) youTube.player.seekTo(target, true);
        else el.audio.currentTime = target;
        break;
      }
      case 'n': step(1); break;
      case 'p': step(-1); break;
      case 'm':
        el.mute.click();
        break;
      case 'e':
        el.eqToggle.click();
        break;
      default:
        break;
    }
  });
}

/* ── boot ───────────────────────────────────────────────────────────────── */

async function boot() {
  window.addEventListener('error', (event) => {
    const box = $('boot-error');
    box.textContent = `IZGIV could not start.\n\n${event.message}`;
    box.hidden = false;
    document.documentElement.dataset.ready = 'error';
  });

  restore();
  wire();
  renderEq();
  syncControls();
  renderLibrary();
  setAccent({ r: 198, g: 148, b: 92 });
  draw();
  await loadDemo();
  syncControls();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.documentElement.dataset.ready = 'ready';
}

boot();
