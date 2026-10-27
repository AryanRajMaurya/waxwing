/**
 * The 10-band equalizer, as a Web Audio graph.
 *
 *   source -> preamp -> band 0 -> ... -> band 9 -> analyser -> destination
 *
 * Every band is a peaking filter at a fixed centre frequency. The preamp gain
 * is the negative of the largest boost, which is the cheapest way to keep a
 * full-scale signal from clipping once the bands are pushed up. It costs some
 * loudness when the EQ is flat-free, which is exactly what a preamp is for.
 */

export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const MIN_GAIN = -12;
export const MAX_GAIN = 12;

export const PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  warm: [4, 3, 2, 1, 0, -1, -1, 0, 1, 1],
  vocal: [-3, -2, 0, 2, 4, 4, 2, 0, -1, -2],
  night: [-4, -2, 0, 0, 1, 2, 1, -1, -3, -5],
};

export function clampGain(value) {
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, Number(value) || 0));
}

/** The preamp that keeps the loudest band from pushing the mix past 0 dBFS. */
export function preampFor(gains) {
  const peak = Math.max(0, ...gains.map(clampGain));
  return peak === 0 ? 0 : -peak;
}

/**
 * Build the filter chain. Returns the chain's input and output so the caller
 * can wire a media element to the front and the speakers to the back.
 */
export function createEq(context, gains = PRESETS.flat) {
  const preamp = context.createGain();
  const filters = BANDS.map((frequency) => {
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    // One octave per band: at these centres, adjacent bands overlap just
    // enough to sound like a curve rather than ten separate bumps.
    filter.Q.value = 1.1;
    filter.gain.value = 0;
    return filter;
  });

  let node = preamp;
  for (const filter of filters) {
    node.connect(filter);
    node = filter;
  }

  const setGains = (values) => {
    values.slice(0, filters.length).forEach((value, index) => {
      filters[index].gain.value = clampGain(value);
    });
    preamp.gain.value = 10 ** (preampFor(values) / 20);
  };

  setGains(gains);

  return {
    input: preamp,
    output: filters[filters.length - 1],
    filters,
    preamp,
    setGains,
  };
}

/**
 * Draw a frequency response for the current gains, for the EQ panel.
 * Pure maths over the same numbers the filters use, so it can be tested.
 */
export function responseCurve(gains, points = 64, from = 20, to = 20000) {
  const curve = [];
  for (let i = 0; i < points; i += 1) {
    const frequency = from * (to / from) ** (i / (points - 1));
    let db = preampFor(gains);
    for (let band = 0; band < BANDS.length; band += 1) {
      const gain = clampGain(gains[band] || 0);
      if (!gain) continue;
      // A peaking filter's contribution falls off with distance in octaves;
      // one octave of width is what Q=1.1 approximates.
      const distance = Math.abs(Math.log2(frequency / BANDS[band]));
      db += gain * Math.max(0, 1 - distance);
    }
    curve.push({ frequency, db });
  }
  return curve;
}
