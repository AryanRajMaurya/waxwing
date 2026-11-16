/**
 * Spectrum geometry, kept out of the UI so it can be tested.
 *
 * Frequencies are laid out logarithmically because hearing is: with linear
 * bars, an entire bassline and a kick drum fight over the first two bars and
 * the remaining fifty sit dark. Each bar owns every bin between its lower and
 * upper edge, and the edges are generated in one pass so neighbouring bars
 * tile the spectrum with no gap and no overlap.
 */

export const BARS = 56;
export const MIN_HZ = 40;
export const MAX_HZ = 14000;

const LOG_SPAN = Math.log(MAX_HZ / MIN_HZ);

/** The frequency range, in Hz, that bar `index` owns. */
export function bandRange(index) {
  return [
    MIN_HZ * Math.exp((index / BARS) * LOG_SPAN),
    MIN_HZ * Math.exp(((index + 1) / BARS) * LOG_SPAN),
  ];
}

/** Bin edges for every bar, tiled across `1 … total - 1`. */
export function bandEdges(total, nyquist = 22050) {
  const edges = [];
  let previousTo = 0;

  for (let index = 0; index < BARS; index += 1) {
    const [lowHz, highHz] = bandRange(index);
    const from = Math.min(total - 1, Math.max(previousTo + 1, Math.floor((lowHz / nyquist) * total)));
    const to = Math.min(total - 1, Math.max(from, Math.ceil((highHz / nyquist) * total) - 1));
    edges.push([from, to]);
    previousTo = to;
  }

  return edges;
}

const edgeCache = new Map();

/** Which analysis bins feed bar `index`. */
export function binsFor(index, total, nyquist = 22050) {
  const key = `${total}:${nyquist}`;
  let edges = edgeCache.get(key);
  if (!edges) {
    edges = bandEdges(total, nyquist);
    edgeCache.set(key, edges);
  }
  return edges[index] || [1, 1];
}
