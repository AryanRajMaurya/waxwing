/**
 * Play order, as a state machine with no DOM in it.
 *
 * The two things people notice when they are wrong are shuffle and repeat, and
 * both are pure bookkeeping: which index comes next, and what happens at the
 * end. Keeping that here means it can be tested without a browser.
 */

/** Fisher-Yates, driven by an injectable RNG so tests are deterministic. */
function shuffled(values, rng) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * @param {string[]} ids track ids, in library order
 */
export function createQueue(ids = [], { shuffle = false, repeat = 'off', rng = Math.random } = {}) {
  return {
    ids: [...ids],
    order: ids.map((_, index) => index),
    cursor: ids.length ? 0 : -1,
    shuffle,
    repeat,
    rng,
  };
}

/** The id to play now, or null for an empty queue. */
export function current(state) {
  if (state.cursor < 0) return null;
  const index = state.order[state.cursor];
  return index === undefined ? null : state.ids[index];
}

export function currentIndex(state) {
  return state.cursor < 0 ? -1 : state.order[state.cursor];
}

/**
 * Advance. `automatic` distinguishes a track ending from a person pressing
 * next, because repeat-one only applies to the former.
 *
 * Returns the id to play, or null when the queue has finished.
 */
export function next(state, { automatic = false } = {}) {
  if (!state.ids.length) return null;

  if (automatic && state.repeat === 'one') {
    return current(state);
  }

  if (state.cursor + 1 < state.order.length) {
    state.cursor += 1;
    return current(state);
  }

  if (state.repeat === 'all') {
    // Reshuffle on the wrap, and do not open the new cycle with the track
    // that just finished.
    if (state.shuffle) {
      const last = state.order[state.cursor];
      state.order = shuffled(state.order, state.rng);
      if (state.order.length > 1 && state.order[0] === last) {
        const j = 1 + Math.floor(state.rng() * (state.order.length - 1));
        [state.order[0], state.order[j]] = [state.order[j], state.order[0]];
      }
    }
    state.cursor = 0;
    return current(state);
  }

  return null;
}

export function previous(state) {
  if (!state.ids.length) return null;
  if (state.cursor > 0) {
    state.cursor -= 1;
    return current(state);
  }
  if (state.repeat === 'all') {
    state.cursor = state.order.length - 1;
    return current(state);
  }
  return current(state);
}

export function jumpTo(state, id) {
  const index = state.ids.indexOf(id);
  if (index < 0) return null;
  const at = state.order.indexOf(index);
  if (at < 0) return null;
  state.cursor = at;
  return id;
}

/** Turn shuffle on or off, keeping the current track in place. */
export function setShuffle(state, on) {
  if (state.shuffle === on) return state;
  state.shuffle = on;
  if (!state.ids.length) return state;

  if (on) {
    const rest = state.order.filter((_, position) => position !== state.cursor);
    state.order = withCurrentFirst(shuffled(rest, state.rng), state.order[state.cursor]);
    state.cursor = 0;
  } else {
    // Back to library order, with the cursor on whatever is playing.
    const playing = currentIndex(state);
    state.order = state.ids.map((_, index) => index);
    state.cursor = Math.max(0, playing);
  }
  return state;
}

export function setRepeat(state, mode) {
  if (!['off', 'all', 'one'].includes(mode)) throw new Error(`unknown repeat mode: ${mode}`);
  state.repeat = mode;
  return state;
}

/** Add tracks to the queue after the ones already there. */
export function append(state, ids) {
  for (const id of ids) {
    if (state.ids.includes(id)) continue;
    state.ids.push(id);
    if (state.shuffle) state.order.splice(state.cursor + 1, 0, state.ids.length - 1);
    else state.order.push(state.ids.length - 1);
  }
  if (state.cursor < 0 && state.order.length) state.cursor = 0;
  return state;
}

/**
 * Put the playing track at position 0 and shuffle the rest, so turning shuffle
 * on does not interrupt playback with a jump to some other song.
 */
function withCurrentFirst(order, playing) {
  if (playing === undefined || playing === null) return order;
  return [playing, ...order.filter((value) => value !== playing)];
}
