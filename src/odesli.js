/**
 * Odesli — the musicians' link resolver behind song.link, odesli.co.
 *
 * Given any music link (song.link/share form, YouTube, YouTube Music,
 * Spotify link, Apple Music link…) its public API reports the same song on
 * every platform it knows: ids, titles, artists, artwork, and — where the
 * publisher grants one — the official audio preview.
 *
 * It asks nothing and grants nothing it does not own; it is a link map,
 * not a ripper. Rate limiting is per-IP and generous, and the player only
 * calls it when someone pastes a link.
 */

const ODESLI = 'https://api.song.link/v1-alpha.1/links';

export const PLATFORMS = Object.freeze({
  APPLE: 'apple_music',
  YOUTUBE_MUSIC: 'youtube_music',
  YOUTUBE: 'youtube',
  SPOTIFY: 'spotify',
  DEEZER: 'deezer',
  ARCHIVE: null, // odesli does not know archive.org; it is ours to bridge
});

/** The API request for a pasted link. */
export function odesliUrl(link, { country = 'US' } = {}) {
  const params = new URLSearchParams({ url: String(link ?? ''), usercountry: country });
  return `${ODESLI}?${params}`;
}

/**
 * The payload reduced to what the player needs.
 *
 * - youtubeId: for the embed route.
 * - appleId:    for the preview route (an iTunes lookup by id, more exact
 *              than a search).
 * - title/artist/album/cover: so the search routes know what to look for.
 */
export function summarizeOdesli(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const entities = Array.isArray(payload.entities) ? payload.entities : [];
  const byId = new Map(entities.map((entity) => [entity?.id, entity]));

  const unique = payload.entityUniqueId;
  let primary = byId.get(unique);
  if (!primary && typeof unique === 'string' && unique.includes('::')) {
    // entityUniqueId is 'PLATFORM_KIND::id'; entity ids are bare platform ids.
    const bare = unique.split('::').pop();
    primary = byId.get(bare) || entities.find((e) => e?.id === bare);
  }
  const title = primary?.title || entities.find((e) => e?.title)?.title || '';
  const artist =
    primary?.artistName
    || entities.find((e) => e?.artistName)?.artistName
    || '';
  const thumbnail = primary?.thumbnailUrl || entities.find((e) => e?.thumbnailUrl)?.thumbnailUrl || '';

  const youtubeEntity = entities.find(
    (entity) => (entity?.platforms || []).some((p) => p === PLATFORMS.YOUTUBE || p === PLATFORMS.YOUTUBE_MUSIC),
  );
  const appleEntity = entities.find((entity) => (entity?.platforms || []).some((p) => p === PLATFORMS.APPLE));

  return {
    title,
    artist,
    coverUrl: thumbnail,
    youtubeId: youtubeEntity?.id || null,
    appleId: appleEntity ? String(appleEntity.id || '').replace(/^id\./, '') : null,
    applePreview: appleEntity?.audioPreview?.url || null,
  };
}
