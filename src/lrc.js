/**
 * LRC lyrics: `[mm:ss.xx] a line`, sometimes several stamps on one line, plus
 * `[ar:...]`-style metadata at the top.
 *
 * A player only needs two things -- the parsed lines, and which line is active
 * at a given second. The second is a binary search, because it runs sixty
 * times a second while a song plays.
 */

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META = /^\[(ar|ti|al|by|offset):(.*)\]$/i;

/** Parse LRC text into `{ lines, meta }`, sorted by time. */
export function parseLrc(text) {
  const lines = [];
  const meta = {};

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const metaMatch = line.match(META);
    if (metaMatch) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }

    STAMP.lastIndex = 0;
    const stamps = [];
    let match;
    while ((match = STAMP.exec(line)) !== null) {
      const [, minutes, seconds, fraction = '0'] = match;
      // ".5" is half a second, ".50" is fifty hundredths, ".500" is 500 ms.
      const millis = Number(fraction.padEnd(3, '0').slice(0, 3));
      stamps.push(Number(minutes) * 60 + Number(seconds) + millis / 1000);
    }
    if (!stamps.length) continue;

    const content = line.replace(STAMP, '').trim();
    for (const time of stamps) lines.push({ time, text: content });
  }

  lines.sort((a, b) => a.time - b.time);

  const offset = Number(meta.offset || 0);
  if (offset) {
    for (const line of lines) line.time = Math.max(0, line.time - offset / 1000);
  }

  return { lines, meta };
}

/**
 * Index of the last line whose timestamp has passed, or -1 before the first.
 * Lines with an empty body (instrumental breaks) still count as active, which
 * keeps the highlight moving instead of freezing on the previous lyric.
 */
export function activeIndex(lines, time) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** The line to show at `time`, with its neighbours for a scrolling view. */
export function windowAt(lines, time, radius = 2) {
  const index = activeIndex(lines, time);
  if (index < 0) return { index, lines: lines.slice(0, radius * 2 + 1) };
  return {
    index,
    lines: lines.slice(Math.max(0, index - radius), index + radius + 1),
  };
}
