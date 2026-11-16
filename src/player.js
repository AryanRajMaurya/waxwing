/**
 * Playback, on Howler.
 *
 * Howler owns transport — format fallback, the autoplay policy, seeking,
 * volume, fade, unload — which is the part the old hand-rolled player spent
 * most of its code pretending to do. What it does not give us is a place to
 * hang an equaliser: every sound ends at `Howler.masterGain`, and that node is
 * public. So we unplug masterGain from the speakers and plug it into our own
 * chain instead:
 *
 *     sound -> Howler.masterGain -> preamp -> 10 bands -> analyser -> speakers
 *
 * That one reroute is the whole integration. The equaliser and the visualiser
 * then apply to every Web Audio sound, and HTML5-mode sounds (NCS, whose CDN
 * sends no CORS header) keep working without a graph they cannot join.
 *
 * Howler emits no per-frame clock, so the caller polls `time()` from its own
 * animation frame — which it needs anyway to draw the spectrum.
 */

import { BANDS, PRESETS, clampGain, createEq } from './eq.js';
import { SOURCES } from './sources.js';

export class Player {
  /**
   * @param {{onReady?:Function, onEnded?:Function, onError?:Function, onMode?:Function}} handlers
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.howl = null;
    this.track = null;
    this.graph = null;
    this.gains = [...PRESETS.flat];
    this.volume = 0.8;
    this.muted = false;
  }

  /** Web Audio is available and Howler will use it. */
  static supported() {
    return typeof window !== 'undefined' && !!window.Howler && !!Howler.usingWebAudio;
  }

  get trackMode() {
    return (this.track && SOURCES[this.track.source]?.mode) || null;
  }

  /** A graph exists, so the analyser has data and the EQ is in circuit. */
  get eqActive() {
    return Boolean(this.graph && this.trackMode === 'web');
  }

  /**
   * Reroute Howler's master gain through the EQ and the analyser.
   * Done once, lazily: the context does not exist until Howler has made one.
   */
  _ensureGraph() {
    if (this.graph) return this.graph;
    if (!Player.supported() || !Howler.ctx || !Howler.masterGain) return null;

    const context = Howler.ctx;
    const eq = createEq(context, this.gains);
    const analyser = context.createAnalyser();
    // 2048 bins is ~21 Hz per bin at 44.1 kHz: fine enough to separate a bass
    // line from a kick, which the default 256 bins cannot.
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;

    Howler.masterGain.disconnect();
    Howler.masterGain.connect(eq.input);
    eq.output.connect(analyser);
    analyser.connect(context.destination);

    this.graph = { context, eq, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
    return this.graph;
  }

  setGains(gains) {
    this.gains = gains.map(clampGain);
    this.graph?.eq.setGains(this.gains);
  }

  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, Number(value)));
    Howler.volume(this.volume);
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    Howler.mute(this.muted);
  }

  /**
   * Cue a track. Any previous sound is unloaded first: Howler caches by URL,
   * and a queue of streams would otherwise sit in memory for the session.
   */
  load(track, { autoplay = true } = {}) {
    this.unload();
    this.track = track;
    this.handlers.onMode?.(this.trackMode);

    const format = track.format || 'mp3';
    const html5 = this.trackMode === 'html5';

    this.howl = new Howl({
      src: [track.url],
      format: [format],
      html5,
      preload: true,
      volume: this.volume,
      onload: () => this.handlers.onReady?.(this.duration()),
      onloaderror: (_id, error) => this.handlers.onError?.(`could not load that audio (${error ?? 'unknown error'})`),
      onplayerror: (_id, error) => this.handlers.onError?.(`playback was refused (${error ?? 'unknown error'})`),
      onend: () => {
        this.handlers.onEnded?.();
      },
    });

    if (this.trackMode === 'web') this._ensureGraph();
    if (autoplay) this.play();
    return this.howl;
  }

  unload() {
    if (this.howl) {
      this.howl.unload();
      this.howl = null;
    }
  }

  play() {
    if (!this.howl) return;
    // A context can still be suspended if the first play was not a gesture.
    if (Player.supported() && Howler.ctx?.state === 'suspended') Howler.ctx.resume();
    this.howl.play();
  }

  pause() {
    this.howl?.pause();
  }

  toggle() {
    if (!this.howl) return false;
    if (this.howl.playing()) {
      this.howl.pause();
      return false;
    }
    this.play();
    return true;
  }

  stop() {
    this.howl?.stop();
  }

  /** Seconds. Howler returns the howl when given an argument, a number when not. */
  time() {
    return this.howl ? Number(this.howl.seek()) || 0 : 0;
  }

  duration() {
    return this.howl?.duration() || 0;
  }

  playing() {
    return Boolean(this.howl?.playing());
  }

  seek(seconds) {
    if (!this.howl) return;
    const target = Math.min(Math.max(0, Number(seconds) || 0), this.duration() || Infinity);
    this.howl.seek(target);
  }

  /** Frequency data for the visualiser, or null when no graph is in circuit. */
  spectrum() {
    const graph = this.graph;
    if (!graph || this.trackMode !== 'web') return null;
    graph.analyser.getByteFrequencyData(graph.data);
    return { data: graph.data, sampleRate: graph.context.sampleRate };
  }
}

export { BANDS, PRESETS, clampGain };
