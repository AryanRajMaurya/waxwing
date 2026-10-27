/**
 * A small ID3v2 reader.
 *
 * A browser can decode an MP3 but it cannot read its tags, and the tags are
 * where the title, the artist and the cover art live. This parses the frames
 * the player actually uses -- TIT2, TPE1, TALB, TRCK, TDRC, TCON and APIC --
 * out of ID3v2.2, v2.3 and v2.4, then falls back to the filename.
 *
 * It is deliberately not a complete ID3 implementation: no compressed or
 * encrypted frames, no ID3v1 tail, no frame rewriting. It reads, it does not
 * write, which is all a player needs.
 */

const TEXT_FRAMES = {
  TIT2: 'title',
  TT2: 'title',
  TPE1: 'artist',
  TP1: 'artist',
  TALB: 'album',
  TAL: 'album',
  TRCK: 'track',
  TRK: 'track',
  TDRC: 'year',
  TYER: 'year',
  TYE: 'year',
  TCON: 'genre',
  TCO: 'genre',
};

const MIME_BY_FORMAT = {
  JPG: 'image/jpeg',
  PNG: 'image/png',
};

/** ID3 sizes are 28-bit "syncsafe" integers: seven bits per byte. */
export function syncSafe(bytes, offset) {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function uint32(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** ID3v2.3 unsynchronisation inserts 0x00 after every 0xFF. Undo it. */
function deunsynchronise(bytes) {
  const out = new Uint8Array(bytes.length);
  let w = 0;
  for (let r = 0; r < bytes.length; r += 1) {
    out[w] = bytes[r];
    w += 1;
    if (bytes[r] === 0xff && bytes[r + 1] === 0x00) r += 1;
  }
  return out.subarray(0, w);
}

/**
 * Decode a text frame body into a string.
 *
 * The first byte of every text frame is the encoding, and each value means a
 * different decoder -- including two flavours of UTF-16 distinguished only by
 * their byte order mark.
 */
export function decodeText(bytes) {
  if (!bytes.length) return '';
  const encoding = bytes[0];
  const body = bytes.subarray(1);

  if (encoding === 0) {
    // ISO-8859-1. TextDecoder('latin1') maps to windows-1252, close enough
    // for the punctuation that actually appears in tags.
    return trimNul(new TextDecoder('latin1').decode(body));
  }
  if (encoding === 3) {
    return trimNul(new TextDecoder('utf-8').decode(body));
  }
  if (encoding === 1 || encoding === 2) {
    if (body[0] === 0xff && body[1] === 0xfe) {
      return trimNul(new TextDecoder('utf-16le').decode(body.subarray(2)));
    }
    if (body[0] === 0xfe && body[1] === 0xff) {
      return trimNul(new TextDecoder('utf-16be').decode(body.subarray(2)));
    }
    return trimNul(new TextDecoder('utf-16le').decode(body));
  }
  return trimNul(new TextDecoder('utf-8').decode(body));
}

function trimNul(text) {
  return text.replace(/\u0000+$/, '').trim();
}

/** Read a NUL-terminated string, where one "character" is 1 or 2 bytes. */
function readTerminated(bytes, offset, wide) {
  let end = offset;
  if (wide) {
    while (end + 1 < bytes.length && !(bytes[end] === 0 && bytes[end + 1] === 0)) end += 2;
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(offset, end)), offset: end + 2 };
  }
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return { text: new TextDecoder('latin1').decode(bytes.subarray(offset, end)), offset: end + 1 };
}

/** APIC (v2.3/v2.4) and PIC (v2.2) carry attached picture data. */
function parsePicture(id, body) {
  const encoding = body[0];
  const wide = encoding === 1 || encoding === 2;
  let offset = 1;
  let mime;

  if (id === 'PIC') {
    const format = new TextDecoder('latin1').decode(body.subarray(1, 4));
    mime = MIME_BY_FORMAT[format.toUpperCase()] || `image/${format.toLowerCase()}`;
    offset = 4;
  } else {
    const read = readTerminated(body, 1, false);
    mime = read.text || 'image/jpeg';
    offset = read.offset;
  }

  offset += 1; // picture type
  const description = readTerminated(body, offset, wide);
  const data = body.subarray(description.offset);

  return { mime, data: data.slice() };
}

/**
 * Parse an ID3v2 tag.
 *
 * Returns `null` when the bytes do not start with "ID3", so callers can treat
 * a missing tag and an unparseable one the same way.
 */
export function readId3v2(bytes) {
  if (!bytes || bytes.length < 10) return null;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null; // "ID3"

  const major = bytes[3];
  if (major < 2 || major > 4) return null;

  const flags = bytes[5];
  const tagSize = syncSafe(bytes, 6);
  let body = bytes.subarray(10, Math.min(bytes.length, 10 + tagSize));

  if (flags & 0x80) body = deunsynchronise(body);

  const headerSize = major === 2 ? 6 : 10;
  const idLength = major === 2 ? 3 : 4;
  const tags = {};
  let offset = 0;

  // An extended header sits between the tag header and the first frame.
  if (major >= 3 && flags & 0x40) {
    const extSize = major === 4 ? syncSafe(body, 0) : uint32(body, 0) + 4;
    offset += extSize;
  }

  while (offset + headerSize <= body.length) {
    const id = new TextDecoder('latin1').decode(body.subarray(offset, offset + idLength));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding, or the end of the tag

    let frameSize;
    if (major === 2) {
      frameSize = (body[offset + 3] << 16) | (body[offset + 4] << 8) | body[offset + 5];
    } else if (major === 4) {
      frameSize = syncSafe(body, offset + 4);
    } else {
      frameSize = uint32(body, offset + 4);
    }

    const frameStart = offset + headerSize;
    const frameEnd = Math.min(frameStart + frameSize, body.length);
    if (frameEnd <= frameStart) break;

    const frame = body.subarray(frameStart, frameEnd);

    if (id === 'APIC' || id === 'PIC') {
      if (!tags.picture) tags.picture = parsePicture(id, frame);
    } else if (TEXT_FRAMES[id]) {
      const value = decodeText(frame);
      if (value && !tags[TEXT_FRAMES[id]]) tags[TEXT_FRAMES[id]] = value;
    }

    offset = frameEnd;
  }

  return tags;
}

const TRACK_PREFIX = /^\s*\d{1,3}[\s._-]+/;

/** Split "Artist - Title" into its parts, the way most files are named. */
export function tagsFromFilename(filename) {
  const base = decodeURIComponent(filename)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/_/g, ' ')
    .replace(TRACK_PREFIX, '')
    .trim();

  const dash = base.indexOf(' - ');
  if (dash > 0) {
    return {
      artist: base.slice(0, dash).trim(),
      title: base.slice(dash + 3).trim(),
    };
  }
  return { title: base, artist: '' };
}

/**
 * Tags for a dropped file: the embedded ones when present, the filename for
 * whatever the tag does not cover.
 */
export function readTags(bytes, filename) {
  const fromName = tagsFromFilename(filename);
  const embedded = readId3v2(bytes) || {};

  return {
    title: embedded.title || fromName.title,
    artist: embedded.artist || fromName.artist,
    album: embedded.album || '',
    year: embedded.year || '',
    track: embedded.track || '',
    genre: embedded.genre || '',
    picture: embedded.picture || null,
    tagged: Boolean(embedded.title || embedded.artist),
  };
}
