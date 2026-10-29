/**
 * Waxwing finds music.
 *
 * Two sources that need no key, no account, and no scraping:
 *
 * - iTunes Search API — the mainstream catalogue. Apple grants the official
 *   30-second preview of every track, plus real artwork and metadata. A
 *   preview is labelled as one, and every row links to where the song is
 *   sold. However the browser blocks cross-site JSON from itunes.apple.com
 *   (no CORS header on the search endpoint), so the request goes out as
 *   JSONP — the documented callback parameter — instead of fetch().
 *
 * - The Internet Archive — full-length audio that is there to be played:
 *   the Live Music Archive (thousands of band-permitted concert recordings)
 *   and Creative Commons-licensed uploads. Search, item metadata and files
 *   all answer with CORS opened, so fetch() works and so does the artwork.
 */

const ITUNES = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php';
const ARCHIVE_METADATA = 'https://archive.org/metadata';
const ARCHIVE_DOWNLOAD = 'https://archive.org/download';
const ARCHIVE_THUMB = 'https://archive.org/services/img';

/** Fields the item list returns; everything else is dead weight. */
export const ARCHIVE_FIELDS = ['identifier', 'title', 'creator', 'year', 'downloads'];

/**
 * Escape a term for a Lucene query string. The advancedsearch endpoint treats
 * most punctuation as syntax; an unescaped `"bar"` in a search for
 * `the "bar" song` flips the whole query.
 */
export function escapeLucene(text) {
  return String(text ?? '').replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1');
}

/** The Live Music Archive plus anything Creative Commons. Performer-permitted, or openly licensed. */
export function archiveQ(term) {
  return `(title:(${escapeLucene(term)})^4 OR creator:(${escapeLucene(term)})^2 OR ${escapeLucene(term)}) AND mediatype:(audio) AND (licenseurl:*creativecommons.org* OR collection:(etree))`;
}

export function archiveSearchUrl(term, { rows = 24 } = {}) {
  const params = new URLSearchParams({
    q: archiveQ(term),
    rows: String(rows),
    page: '1',
    output: 'json',
  });
  for (const field of ARCHIVE_FIELDS) params.append('fl[]', field);
  return `${ARCHIVE_SEARCH}?${params}`;
}

export function archiveMetadataUrl(identifier) {
  return `${ARCHIVE_METADATA}/${encodeURIComponent(identifier)}`;
}

export function archiveStreamUrl(identifier, file) {
  return `${ARCHIVE_DOWNLOAD}/${encodeURIComponent(identifier)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

export function archiveThumb(identifier) {
  return `${ARCHIVE_THUMB}/${encodeURIComponent(identifier)}`;
}

/**
 * The one audio file an item is worth streaming: pick by quality-vs-weight,
 * so a three-hundred-megabyte FLAC never stands between someone and a song.
 */
export const ARCHIVE_FORMAT_ORDER = [
  'VBR MP3',
  'MP3',
  '192Kbps MP3',
  '128Kbps MP3',
  '64Kbps MP3',
  'Ogg Vorbis',
  'Flac',
];

/**
 * Choose a file from an item's metadata. `files` is the raw list; a format
 * is best matched case-insensitively, and unknown formats lose to known
 * ones whatever their name suggests.
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

/**
 * Apple serves artwork at whatever size the URL asks for. The API hands out
 * 100×100; the square slot takes a size and grows the number inside the URL.
 */
export function upgradeArtwork(url, size = 300) {
  return String(url ?? '').replace(/\/\d+x\d+bb\.([a-z]+)$/i, `/${size}x${size}bb.$1`);
}

/** The raw iTunes result reduced to what a track row needs. */
export function pickiTunesTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.previewUrl) return null;
  return {
    title: raw.trackName || raw.collectionName || 'Untitled',
    artist: raw.artistName || '',
    album: raw.collectionName || '',
    url: raw.previewUrl,
    coverUrl: upgradeArtwork(raw.artworkUrl100 || ''),
    duration: Math.round((raw.trackTimeMillis || 30000) / 1000),
    buyUrl: raw.trackViewUrl || '',
    genre: raw.primaryGenreName || '',
  };
}

/** One JSONP request, promise-shaped. */
export function jsonp(url, timeout = 9000) {
  if (typeof document === 'undefined') return Promise.reject(new Error('jsonp needs a browser'));
  const callbackName = `waxJsonpCallback${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

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
    script.src = `${url}&callback=${callbackName}`;
    script.onerror = () => stop(reject, new Error('the search endpoint could not be reached'));
    document.head.append(script);
  });
}

/** Search the mainstream catalogue. Resolves to an array of track shapes. */
export function searchiTunes(term) {
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    limit: '24',
  });
  return jsonp(`${ITUNES}?${params}`).then((data) =>
    (data?.results || []).map(pickiTunesTrack).filter(Boolean),
  );
}

/**
 * Look one song up by its Apple numeric id — the direct route when Odesli
 * has already told us which song it is. Same shape as a search row, or null.
 */
export function lookupiTunes(id) {
  if (!id) return Promise.reject(new Error('no apple id'));
  return jsonp(`${ITUNES_LOOKUP}?${new URLSearchParams({ id: String(id) })}`)
    .then((data) => pickiTunesTrack(data?.results?.[0]));
}

/** Search the Archive. Resolves to lightweight item descriptors. */
export async function searchArchive(term, { rows = 24 } = {}) {
  const response = await fetch(archiveSearchUrl(term, { rows }));
  if (!response.ok) throw new Error(`archive.org answered ${response.status}`);
  const data = await response.json();
  const docs = data?.response?.docs || [];
  return docs.map((doc) => ({
    identifier: doc.identifier,
    title: Array.isArray(doc.title) ? doc.title[0] : (doc.title || doc.identifier),
    creator: Array.isArray(doc.creator) ? doc.creator.join(', ') : (doc.creator || ''),
    year: doc.year || '',
    downloads: doc.downloads || 0,
    coverUrl: archiveThumb(doc.identifier),
  }));
}

/**
 * Resolve an item descriptor to something playable: metadata first, then the
 * best audio file it holds. Returns null when the item has no audio at all.
 */
export async function resolveArchiveItem(item) {
  const response = await fetch(archiveMetadataUrl(item.identifier));
  if (!response.ok) throw new Error(`archive.org answered ${response.status}`);
  const data = await response.json();
  const file = pickArchiveFile(data?.files);
  if (!file) return null;
  return {
    url: archiveStreamUrl(item.identifier, file.name),
    coverUrl: archiveThumb(item.identifier) || item.coverUrl,
  };
}
