/**
 * YouTube playback, as far as it is honestly possible.
 *
 * The player never touches YouTube's bytes: the video runs inside YouTube's
 * own embedded player. That is the only way of playback the publisher has
 * agreed to, and it means the audio never passes through the Web Audio graph —
 * so the equaliser and the spectrum do not apply to a YouTube track. What the
 * player can provide is the queue, the artwork (the video, in the art frame),
 * the timer and the lyrics.
 */

/**
 * Pull a video id out of any YouTube URL shape.
 *
 * Handles watch?v=, youtu.be/, /embed/, /shorts/, /live/ and a bare id, which
 * is what someone pastes after copying it out of a tab title.
 */
export function youTubeId(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  const patterns = [
    /youtube\.com\/(?:watch\?[^#\s]*v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** The thumbnail that always exists for a video. */
export function youTubeThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/**
 * Player state values as YouTube reports them, named.
 *
 * -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
 */
export const YT_STATE = Object.freeze({
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
});
