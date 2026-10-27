#!/usr/bin/env node
/**
 * Synthesise the demo track, "Glass".
 *
 * The demo exists so the player has something to play before anyone imports a
 * file — and so the visualiser, the lyrics panel and the accent-from-cover
 * have something to show. A single sine tone proves the audio path works but
 * makes the spectrum look broken: all of its energy sits in four bars.
 *
 * So this is a real (if small) piece: four chords, a pad, a bass and a bell
 * arpeggio, 24 seconds, in A minor. Everything is generated from oscillators,
 * which keeps the repository free of sample licences and makes the result
 * reproducible byte for byte.
 *
 *   node demo/make-demo.mjs /tmp/glass.wav
 *   ffmpeg -i /tmp/glass.wav -i demo/cover.jpg -map 0:a -map 1:v \
 *     -c:a libmp3lame -b:a 128k -c:v copy -id3v2_version 3 \
 *     -metadata title=Glass -metadata artist=IZGIV -metadata album=Demo \
 *     -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" \
 *     demo/demo.mp3
 */

import { writeFileSync } from 'node:fs';

const RATE = 44100;
const DURATION = 24;
const FRAMES = RATE * DURATION;

/* ── a sine table, so this runs in seconds rather than minutes ──────────── */

const TABLE_SIZE = 4096;
const SINE = new Float64Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i += 1) SINE[i] = Math.sin((2 * Math.PI * i) / TABLE_SIZE);

/** Sine at `phase` turns (0-1), interpolated between table entries. */
function sine(phase) {
  const x = (phase - Math.floor(phase)) * TABLE_SIZE;
  const index = x | 0;
  const frac = x - index;
  return SINE[index] + (SINE[index + 1] - SINE[index]) * frac;
}

/* ── the score ──────────────────────────────────────────────────────────── */

// Four bars of six seconds: Am, F, C, G. Frequencies in Hz.
const CHORDS = [
  { bass: 110.0, notes: [110.0, 164.81, 220.0, 261.63, 329.63] }, // A minor
  { bass: 87.31, notes: [87.31, 130.81, 174.61, 220.0, 261.63] }, // F major
  { bass: 130.81, notes: [130.81, 196.0, 261.63, 329.63, 392.0] }, // C major
  { bass: 98.0, notes: [98.0, 146.83, 196.0, 246.94, 293.66] }, // G major
];

const BAR = DURATION / CHORDS.length; // 6 s
const OVERLAP = 1.3; // chords bleed into each other

const left = new Float64Array(FRAMES);
const right = new Float64Array(FRAMES);

/** Raised-cosine fade, so notes enter and leave without a click. */
function window(t, start, end, fade) {
  if (t < start || t > end) return 0;
  const inGain = Math.min(1, (t - start) / fade);
  const outGain = Math.min(1, (end - t) / fade);
  const shape = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  return Math.min(shape(inGain), shape(outGain));
}

/* ── the pad: five detuned voices per chord, spread across the stereo field */

for (let c = 0; c < CHORDS.length; c += 1) {
  const start = c * BAR - OVERLAP;
  const end = (c + 1) * BAR + OVERLAP;

  CHORDS[c].notes.forEach((frequency, voice) => {
    // Higher voices sit further from the centre, which widens the chord.
    const spread = 0.15 + 0.35 * (voice / (CHORDS[c].notes.length - 1));
    const panL = 0.5 - spread / 2;
    const panR = 0.5 + spread / 2;

    const detune = 0.0012;
    const phaseA = 0.0;
    const phaseB = 0.37;

    const from = Math.max(0, Math.floor(start * RATE));
    const to = Math.min(FRAMES, Math.ceil(end * RATE));
    const gain = 0.16 / Math.sqrt(CHORDS[c].notes.length);

    for (let i = from; i < to; i += 1) {
      const t = i / RATE;
      const env = window(t, start, end, OVERLAP);
      if (env <= 0) continue;

      // Two oscillators a hair apart beat slowly against each other.
      const a = sine(frequency * (1 + detune) * t + phaseA);
      const b = sine(frequency * (1 - detune) * t + phaseB);
      const fundamental = (a + b) * 0.5;
      const second = sine(frequency * 2 * t) * 0.14;
      const third = sine(frequency * 3 * t) * 0.05;
      const sample = (fundamental + second + third) * gain * env;

      left[i] += sample * panL * 2;
      right[i] += sample * panR * 2;
    }
  });
}

/* ── the bass: one long note per chord, an octave below the root ─────────── */

for (let c = 0; c < CHORDS.length; c += 1) {
  const start = c * BAR;
  const end = (c + 1) * BAR + 0.4;
  const frequency = CHORDS[c].bass / 2;
  const from = Math.floor(start * RATE);
  const to = Math.min(FRAMES, Math.ceil(end * RATE));

  for (let i = from; i < to; i += 1) {
    const t = i / RATE;
    const env = window(t, start, end, 0.9);
    if (env <= 0) continue;
    // A touch of the octave keeps it audible on laptop speakers, which roll
    // off everything below about 150 Hz.
    const sample = (sine(frequency * t) + sine(frequency * 2 * t) * 0.35) * 0.20 * env;
    left[i] += sample;
    right[i] += sample;
  }
}

/* ── the bell: an arpeggio picked from the chord that is sounding ────────── */

const BELL_STEP = 0.75; // a note every three-quarters of a second
for (let n = 0; n * BELL_STEP < DURATION; n += 1) {
  const at = n * BELL_STEP + 0.35;
  const chord = CHORDS[Math.min(CHORDS.length - 1, Math.floor(at / BAR))];
  const frequency = chord.notes[(n * 2) % chord.notes.length] * 2;
  const pan = n % 2 === 0 ? 0.35 : 0.65;
  const decay = 0.85;

  const from = Math.floor(at * RATE);
  const to = Math.min(FRAMES, Math.floor((at + decay * 4) * RATE));

  for (let i = from; i < to; i += 1) {
    const t = i / RATE - at;
    if (t < 0) continue;
    const env = Math.exp(-t / decay) * Math.min(1, t / 0.006); // 6 ms attack
    const sample = (sine(frequency * t) + sine(frequency * 3 * t) * 0.18) * 0.10 * env;
    left[i] += sample * pan * 2;
    right[i] += sample * (1 - pan) * 2;
  }
}

/* ── air: filtered noise, quiet enough to read as breath ─────────────────── */

let lowpass = 0;
let noiseState = 22222;
for (let i = 0; i < FRAMES; i += 1) {
  noiseState = (noiseState * 1664525 + 1013904223) % 4294967296;
  const white = (noiseState / 4294967296) * 2 - 1;
  lowpass += (white - lowpass) * 0.06; // one-pole, around 1.2 kHz
  const t = i / RATE;
  const swell = 0.004 + 0.003 * Math.sin((2 * Math.PI * t) / 9);
  left[i] += lowpass * swell;
  right[i] += lowpass * swell * 0.9;
}

/* ── ping-pong delay, then a master fade ────────────────────────────────── */

const DELAY = Math.round(0.375 * RATE); // dotted eighth at 80 bpm
const FEEDBACK = 0.3;
const MIX = 0.22;

for (let i = DELAY; i < FRAMES; i += 1) {
  left[i] += right[i - DELAY] * MIX;
  right[i] += left[i - DELAY] * MIX * FEEDBACK;
}

const fadeIn = Math.floor(1.2 * RATE);
const fadeOut = Math.floor(2.4 * RATE);
for (let i = 0; i < FRAMES; i += 1) {
  const inGain = Math.min(1, i / fadeIn);
  const outGain = Math.min(1, (FRAMES - i) / fadeOut);
  const gain = Math.min(inGain, outGain);
  left[i] *= gain;
  right[i] *= gain;
}

/* ── normalise, then write 16-bit stereo PCM ────────────────────────────── */

let peak = 0;
for (let i = 0; i < FRAMES; i += 1) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const scale = peak > 0 ? 0.89 / peak : 1;

const bytes = Buffer.alloc(44 + FRAMES * 4);
bytes.write('RIFF', 0, 'latin1');
bytes.writeUInt32LE(36 + FRAMES * 4, 4);
bytes.write('WAVE', 8, 'latin1');
bytes.write('fmt ', 12, 'latin1');
bytes.writeUInt32LE(16, 16); // PCM chunk size
bytes.writeUInt16LE(1, 20); // format: PCM
bytes.writeUInt16LE(2, 22); // channels
bytes.writeUInt32LE(RATE, 24);
bytes.writeUInt32LE(RATE * 4, 28); // byte rate
bytes.writeUInt16LE(4, 32); // block align
bytes.writeUInt16LE(16, 34); // bits per sample
bytes.write('data', 36, 'latin1');
bytes.writeUInt32LE(FRAMES * 4, 40);

for (let i = 0; i < FRAMES; i += 1) {
  // tanh soft clip: the delay tail can otherwise poke above the peak
  bytes.writeInt16LE(Math.round(Math.tanh(left[i] * scale) * 32767), 44 + i * 4);
  bytes.writeInt16LE(Math.round(Math.tanh(right[i] * scale) * 32767), 46 + i * 4);
}

const out = process.argv[2] || '/tmp/glass.wav';
writeFileSync(out, bytes);

let sum = 0;
for (let i = 0; i < FRAMES; i += 1) sum += left[i] * left[i] + right[i] * right[i];
const rms = Math.sqrt(sum / (FRAMES * 2));
console.log(`${out}: ${DURATION}s, peak ${(20 * Math.log10(0.89)).toFixed(1)} dBFS, rms ${(20 * Math.log10(rms * scale)).toFixed(1)} dBFS`);
