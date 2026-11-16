/**
 * Lyrics from LRClib (https://lrclib.net).
 *
 * Open, no key, CORS `*`, and it carries *synced* lyrics — the timed lines the
 * player already knows how to scroll. The search endpoint answers with a list;
 * the useful work here is choosing between them: a result with synced lines
 * beats one with only plain text, and among those the closest duration wins,
 * because a karaoke mix and a single share a title and only one is the song
 * you are playing.
 */

const LRCLIB = 'https://lrclib.net/api';

export function lrclibSearchUrl({ track, artist = '', album = '' } = {}) {
  const params = new URLSearchParams({ track_name: String(track || '') });
  if (artist) params.set('artist_name', artist);
  if (album) params.set('album_name', album);
  return `${LRCLIB}/search?${params}`;
}

/**
 * Choose the best entry from a LRClib result list.
 * Returns null when nothing usable is there.
 */
export function pickLyrics(results, { duration = 0 } = {}) {
  const list = Array.isArray(results) ? results : [];
  const usable = list.filter((row) => row && (row.syncedLyrics || row.plainLyrics));
  if (!usable.length) return null;

  const score = (row) => {
    let points = 0;
    if (row.syncedLyrics) points += 100;
    if (duration && Number.isFinite(Number(row.duration))) {
      // Closer duration is better; 30 seconds out costs a point.
      points += Math.max(0, 20 - Math.abs(Number(row.duration) - duration) / 2);
    }
    return points;
  };

  return [...usable].sort((a, b) => score(b) - score(a))[0];
}

/** Search LRClib and return the best entry, or null. */
export async function searchLyrics({ track, artist = '', album = '', duration = 0 }) {
  const response = await fetch(lrclibSearchUrl({ track, artist, album }));
  if (!response.ok) throw new Error(`LRClib answered ${response.status}`);
  return pickLyrics(await response.json(), { duration });
}

/**
 * LRClib serves plain text with `[mm:ss.xx]` stamps, which is exactly what the
 * `.lrc` parser reads — so a fetched result can go straight into it.
 */
export function asLrc(entry) {
  return entry?.syncedLyrics || entry?.plainLyrics || '';
}
