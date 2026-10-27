/**
 * Accent colour, taken from the album art.
 *
 * The naive answer -- average every pixel -- always lands on mud, because most
 * covers are mostly one dull background. What reads as "the colour of this
 * cover" is the most common *vivid* colour, so vivid pixels are counted into
 * coarse buckets and the winning bucket is averaged for precision.
 */

/** Relative luminance, per WCAG. */
export function luminance({ r, g, b }) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Black or white, whichever is readable on top of `color`. */
export function textOn(color) {
  return luminance(color) > 0.42 ? '#12100e' : '#f6f2ea';
}

function saturation({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * @param {Uint8ClampedArray|number[]} pixels RGBA, as ImageData stores it
 * @returns {{r:number,g:number,b:number}} the accent, or a warm neutral
 */
export function dominantColor(pixels) {
  const NEUTRAL = { r: 168, g: 132, b: 96 };
  if (!pixels || pixels.length < 4) return NEUTRAL;

  // 5 bits per channel: enough to separate hues, coarse enough to be fast.
  const buckets = new Map();
  const step = 4 * 2; // every other pixel; covers are large and this is a preview

  for (let i = 0; i < pixels.length - 3; i += step) {
    const a = pixels[i + 3];
    if (a < 128) continue;

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    // Near-black and near-white pixels carry no hue worth showing.
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 24 || min > 232) continue;

    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { r: 0, g: 0, b: 0, count: 0, saturation: 0 };
      buckets.set(key, bucket);
    }
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count += 1;
    bucket.saturation += saturation({ r, g, b });
  }

  if (!buckets.size) return NEUTRAL;

  let best = null;
  for (const bucket of buckets.values()) {
    // How vivid the bucket is, squared: a small splash of strong colour beats
    // a large field of grey, which is what the eye does. Area still counts,
    // but only as a square root, so a big dull background cannot outvote it.
    const mean = bucket.saturation / bucket.count;
    const score = (0.01 + mean * mean) ** 2 * Math.sqrt(bucket.count);
    if (!best || score > best.score) best = { bucket, score };
  }

  const { bucket } = best;
  return {
    r: Math.round(bucket.r / bucket.count),
    g: Math.round(bucket.g / bucket.count),
    b: Math.round(bucket.b / bucket.count),
  };
}

/** RGB (0-255) to HSL with h in degrees, s and l in 0-1. */
function toHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;

  return { h, s, l };
}

function fromHsl({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/**
 * Lift a dark accent until it reads on a near-black page.
 *
 * Scaling the channels equally (the obvious fix) keeps the hue but turns a
 * deep amber into a slightly-less-deep amber that still disappears against
 * the background. Lightness has to move on its own, so this works in HSL:
 * the hue is kept, the lightness is pulled into a band that is visible but
 * not glaring, and a near-grey cover gets just enough saturation to look
 * deliberate rather than washed out.
 */
export function ensureReadable(color, { minLightness = 0.56, maxLightness = 0.72 } = {}) {
  const hsl = toHsl(color);
  const lightness = Math.min(maxLightness, Math.max(minLightness, hsl.l));
  const saturation = hsl.s < 0.08 ? 0.14 : Math.min(0.68, hsl.s);
  return fromHsl({ h: hsl.h, s: saturation, l: lightness });
}

export function css({ r, g, b }, alpha = 1) {
  return alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}
