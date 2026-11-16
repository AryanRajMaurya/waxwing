/**
 * Where the music comes from.
 *
 * Four sources, none of which wants a key or an account:
 *
 * - Deezer   — open search API, 30-second MP3 previews at ~320 kbps, real cover
 *              art. The *search* endpoint sends no CORS header, so it is read
 *              as JSONP; the preview CDN does send `Access-Control-Allow-
 *              Origin: *`, which is what lets the audio run through the Web
 *              Audio graph so the equaliser and visualiser apply to it.
 * - Apple    — the iTunes Search API. No CORS header on the search endpoint,
 *              so it is reached as JSONP (the documented `callback` parameter).
 *              Preview audio itself *is* CORS-open, so it takes the Web Audio
 *              path too.
 * - Archive  — archive.org: the Live Music Archive and Creative Commons
 *              uploads. Full-length, CORS-open on both search and audio.
 * - NCS      — NoCopyrightSounds. No public API and the S3 bucket refuses
 *              listing, so `tools/scrape-ncs.py` freezes the library into
 *              `catalog/ncs.json`. The audio host sends no CORS header, so NCS
 *              plays in HTML5 mode: sound, but no equaliser. Labelled as such
 *              in the UI rather than quietly pretending otherwise.
 */

const DEEZER_SEARCH = 'https://api.deezer.com/search';
const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php';
const ARCHIVE_METADATA = 'https://archive.org/metadata';
const ARCHIVE_DOWNLOAD = 'https://archive.org/download';
const ARCHIVE_THUMB = 'https://archive.org/services/img';
const NCS_CATALOG = 'catalog/ncs.json';

export const SOURCES = {
  // Local files are the best-behaved source of all: a blob URL is same-origin,
  // so the audio can always take the Web Audio path and the tags are read from
  // the file itself. It has no tab — you get here by dropping files.
  local: {
    label: 'Your files',
    note: 'full-length · tags and cover art read from the file',
    mode: 'web',
    placeholder: '',
  },
  deezer: {
    label: 'Deezer',
    note: '30-second previews · equaliser applies',
    mode: 'web',
    placeholder: 'Search the Deezer catalogue',
  },
  archive: {
    label: 'Archive',
    note: 'full-length · Live Music Archive & Creative Commons',
    mode: 'web',
    placeholder: 'Search archive.org recordings',
  },
  itunes: {
    label: 'Apple',
    note: '30-second previews · equaliser applies',
    mode: 'web',
    placeholder: 'Search the Apple catalogue',
  },
  ncs: {
    label: 'NCS',
    note: 'full-length · free to use · no equaliser',
    mode: 'html5',
    placeholder: 'Search the NCS library',
  },
};

export const SOURCE_ORDER = ['deezer', 'archive', 'itunes', 'ncs'];

/** Grow a Deezer cover from the size it hands out to the size the frame takes. */
function deezerCover(url, size = 512) {
  return String(url || '').replace(/\/\d+x\d+\//, `/${size}x${size}/`);
}

/**
 * NCS library entries only ever expose the 100×100 thumbnail: the 850×850 and
 * 1998×1000 renditions exist for the featured release and 403 for everything
 * else. So the cover is used at the size it exists, and the plate is sized so
 * the upscale stays flattering.
 */
function ncsCover(url) {
  return String(url || '');
}

const row = (source, extra) => ({ source, ...extra });

/* ── Deezer ─────────────────────────────────────────────────────────────── */

/**
 * Deezer's search endpoint sends no `Access-Control-Allow-Origin` header, so a
 * browser cannot read it with fetch. It does answer JSONP, which is what the
 * old iTunes integration used for the same reason — so both catalogues go out
 * as a script tag. The preview CDN in the results *is* CORS-open, which is what
 * lets the audio itself run through the equaliser.
 */
export function searchDeezer(term, limit = 30) {
  const params = new URLSearchParams({ q: term, limit: String(limit), output: 'jsonp' });
  return jsonp(`${DEEZER_SEARCH}?${params}`).then((data) =>
    (Array.isArray(data?.data) ? data.data : [])
      .filter((track) => track?.preview && track?.title)
      .map((track) => row('deezer', {
        id: `dz${track.id}`,
        title: track.title,
        artist: track.artist?.name || '',
        album: track.album?.title || '',
        url: track.preview,
        cover: deezerCover(track.album?.cover_big || track.artist?.picture_big || ''),
        duration: Number(track.duration) || 0,
        link: track.link || '',
        format: 'mp3',
      })),
  );
}

/* ── Apple / iTunes ─────────────────────────────────────────────────────── */

/** One JSONP request, promise-shaped. The search endpoint has no CORS header. */
export function jsonp(url, timeout = 9000) {
  if (typeof document === 'undefined') return Promise.reject(new Error('jsonp needs a browser'));
  const callbackName = `waxJsonp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const stop = (fn, arg) => {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
      fn(arg);
    };
    const timer = setTimeout(() => stop(reject, new Error('the search timed out')), timeout);

    window[callbackName] = (data) => stop(resolve, data);
    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${callbackName}`;
    script.onerror = () => stop(reject, new Error('the Apple catalogue could not be reached'));
    document.head.append(script);
  });
}

export function searchITunes(term, limit = 30) {
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    limit: String(limit),
    country: 'US',
  });
  return jsonp(`${ITUNES_SEARCH}?${params}`).then((data) =>
    (data?.results || [])
      .filter((raw) => raw?.previewUrl)
      .map((raw) => row('itunes', {
        id: `it${raw.trackId}`,
        title: raw.trackName || raw.collectionName || 'Untitled',
        artist: raw.artistName || '',
        album: raw.collectionName || '',
        url: raw.previewUrl,
        cover: String(raw.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/512x512bb.'),
        duration: Math.round((raw.trackTimeMillis || 30000) / 1000),
        link: raw.trackViewUrl || '',
        format: 'm4a',
      })),
  );
}

/* ── Internet Archive ──────────────────────────────────────────────────── */

export function escapeLucene(text) {
  return String(text ?? '').replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

/** Performer-permitted (etree) or openly licensed. */
export function archiveQuery(term) {
  return `(title:(${escapeLucene(term)})^4 OR creator:(${escapeLucene(term)})^2 OR ${escapeLucene(term)})`
    + ' AND mediatype:(audio) AND (licenseurl:*creativecommons.org* OR collection:(etree))';
}

export async function searchArchive(term, rows = 30) {
  const params = new URLSearchParams({
    q: archiveQuery(term),
    rows: String(rows),
    page: '1',
    output: 'json',
  });
  for (const field of ['identifier', 'title', 'creator', 'year', 'downloads']) {
    params.append('fl[]', field);
  }

  const response = await fetch(`${ARCHIVE_SEARCH}?${params}`);
  if (!response.ok) throw new Error(`archive.org answered ${response.status}`);
  const data = await response.json();

  return (data?.response?.docs || []).map((doc) => row('archive', {
    id: `ar${doc.identifier}`,
    identifier: doc.identifier,
    title: Array.isArray(doc.title) ? doc.title[0] : (doc.title || doc.identifier),
    artist: Array.isArray(doc.creator) ? doc.creator.join(', ') : (doc.creator || ''),
    album: doc.year ? String(doc.year) : '',
    cover: `${ARCHIVE_THUMB}/${encodeURIComponent(doc.identifier)}`,
    downloads: doc.downloads || 0,
    url: '',
  }));
}

/** Quality-vs-weight order: never put a 300 MB FLAC between someone and a song. */
export const ARCHIVE_FORMAT_ORDER = [
  'VBR MP3', 'MP3', '192Kbps MP3', '128Kbps MP3', '64Kbps MP3', 'Ogg Vorbis', 'Flac',
];

/**
 * Choose the one file worth streaming from an item's file list.
 * Best format match wins; unknown formats lose to known ones.
 */
export function pickArchiveFile(files) {
  const list = Array.isArray(files) ? files : [];
  for (const wanted of ARCHIVE_FORMAT_ORDER) {
    const hit = list.find(
      (file) => typeof file?.name === 'string' && file.format?.toLowerCase() === wanted.toLowerCase(),
    );
    if (hit) return hit;
  }
  return null;
}

/** Resolve an archive item to a streamable file. Returns null when it has none. */
export async function resolveArchive(item) {
  const response = await fetch(`${ARCHIVE_METADATA}/${encodeURIComponent(item.identifier)}`);
  if (!response.ok) throw new Error(`archive.org answered ${response.status}`);
  const data = await response.json();

  const chosen = pickArchiveFile(data?.files);
  if (!chosen) return null;

  return {
    ...item,
    url: `${ARCHIVE_DOWNLOAD}/${encodeURIComponent(item.identifier)}/${chosen.name.split('/').map(encodeURIComponent).join('/')}`,
    format: chosen.format,
  };
}

/* ── NCS ───────────────────────────────────────────────────────────────── */

let ncsCache = null;

/** The frozen NCS library. Loaded once; the file is a static asset. */
export async function loadNcs() {
  if (ncsCache) return ncsCache;
  const response = await fetch(NCS_CATALOG);
  if (!response.ok) throw new Error(`the NCS catalogue answered ${response.status}`);
  const data = await response.json();
  ncsCache = (data?.tracks || []).map((track) => row('ncs', {
    id: `ncs${track.id || track.url}`,
    title: track.title || 'Untitled',
    artist: track.artist || '',
    album: 'NCS',
    url: track.url,
    cover: ncsCover(track.cover || ''),
    duration: 0,
    link: 'https://ncs.io',
    format: 'mp3',
  }));
  return ncsCache;
}

export async function searchNcs(term) {
  const all = await loadNcs();
  const needle = term.trim().toLowerCase();
  if (!needle) return all;
  return all.filter((track) =>
    `${track.title} ${track.artist}`.toLowerCase().includes(needle));
}

/* ── dispatch ──────────────────────────────────────────────────────────── */

/**
 * Search the given source. `signal` lets the caller cancel a stale request
 * when the user has already typed past it.
 */
export async function search(source, term, { limit = 30, signal } = {}) {
  switch (source) {
    case 'deezer': return searchDeezer(term, limit);
    case 'itunes': return searchITunes(term, limit);
    case 'archive': return searchArchive(term, limit);
    case 'ncs': {
      if (signal?.aborted) return [];
      return searchNcs(term);
    }
    default: throw new Error(`unknown source: ${source}`);
  }
}

/** Turn a search row into something playable, resolving lazy sources. */
export async function resolve(item) {
  if (item.source === 'archive' && !item.url) return resolveArchive(item);
  return item;
}
