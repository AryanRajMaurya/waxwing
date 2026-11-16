# Waxwing

**A crate-digger that plays, on paper.** Type a name — hear it: 30-second
previews from Deezer and Apple, full-length recordings from the Internet
Archive and NoCopyrightSounds, and your own files. One queue, one page, no
account, no upload, no build step.

## Run it

```bash
cd waxwing-player
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000
```

A server is required: browsers refuse to load ES modules from `file://`.

## Deploy

Two places it lives, from the same tree:

- **GitHub Pages** — `AryanRajMaurya/waxwing`, at
  https://aryanrajmaurya.github.io/waxwing/. Push through the mirror clone at
  `~/waxwing-publish` (see the waxwing skill's `references/player-project.md`).
- **Antideploy** — the app `hermes`, published at https://waxwing.antideploy.app.
  `.antideploy.json` holds the application id; deploy with
  `tar czf - . | curl -X POST "https://antideploy.com/api/v1/deploy?applicationId=<id>" -H "Authorization: Bearer $TOKEN" -F "archive=@-"`.

`vendor/` is on Antideploy's ignore list, which is why the library is at
`assets/howler.js` rather than beside the source. GitHub Pages serves either.

## What it does

- **Four catalogues, no keys.** Deezer (30″ MP3 previews, cover art), Apple
  (30″ previews), the Internet Archive (full-length, performer-permitted and
  Creative Commons), and NCS (full-length, free to use). Every row is labelled
  with the source and with what that source can honestly do.
- **Live radio, two directories.** SomaFM's 51 curated channels, and Radio
  Browser's community directory of 30,000+ stations — searchable by name, tag or
  genre. Live means live: the transport reads `LIVE`, there is no position and no
  length, and the scrubber steps aside.
- **Your own files.** MP3, FLAC, OGG, Opus, M4A, WAV — picker or drag-and-drop.
  ID3v2 tags and the embedded cover are read from the first megabyte, so a big
  FLAC does not stall the page.
- **Lyrics.** A `.lrc` beside its audio still wins, and when there is none the
  player asks [LRClib](https://lrclib.net) for the track — synced lines when it
  has them, and among candidates the closest duration, because a karaoke mix and
  a single share a title.
- **Ten-band equaliser.** 32 Hz to 16 kHz, flat/warm/vocal/night presets, and a
  preamp that moves opposite to the largest boost so nothing clips.
- **A spectrum that reads like one.** 56 logarithmically spaced bands from 40 Hz
  to 14 kHz, drawn after the EQ.
- **Shuffle that does not repeat itself**, and repeat off/all/one.
- **Remembers your settings** — volume, EQ, shuffle, repeat, and the
  URL-addressable tracks. Local files cannot survive a reload; their blob URLs
  die with the tab, and the UI says so.
- **Keyboard.** `space` play/pause, `←` `→` seek five seconds, `n`/`p` next and
  previous, `m` mute, `e` equaliser.

## How it works

Nothing is bundled except Howler. The modules are plain ES modules:

| File | Job |
|---|---|
| `src/sources.js` | The catalogues and the radio directories, and each one's limits |
| `src/lyrics.js` | LRClib search, and choosing between its candidates |
| `src/player.js` | Howler transport, and the one reroute that hangs an EQ off it |
| `src/eq.js` | The ten filters, presets, preamp |
| `src/viz.js` | Spectrum geometry (log-spaced bands, tiled bin edges) |
| `src/queue.js` | Play order, shuffle bag, repeat |
| `src/tags.js` | ID3v2.2 / v2.3 / v2.4 reader, text frames and `APIC` art |
| `src/lrc.js` | `.lrc` parser |
| `src/color.js` | Dominant colour from a cover, lifted into a readable accent |
| `src/app.js` | The UI and the playback loop |

### The one integration trick

Howler owns transport. It does not expose a place to hang an equaliser — every
sound ends at `Howler.masterGain`, and that node is public. So the player
unplugs it from the speakers and plugs it into its own chain:

```
sound -> Howler.masterGain -> preamp -> 10 bands -> analyser -> speakers
```

The EQ and the visualiser then apply to every Web Audio sound.

### Where each source can go

| Source | Search | Audio | Equaliser |
|---|---|---|---|
| Deezer | JSONP — the endpoint sends no CORS header | CORS `*`, ~320 kbps MP3 | yes |
| Apple | JSONP | CORS `*`, M4A | yes |
| Internet Archive | `fetch`, CORS `*` | CORS `*` | yes |
| NCS | local catalogue, no network | S3, **no CORS header** | no — HTML5 mode |
| SomaFM | `channels.json`, cached | CORS `*`, but live | no — HTML5 mode |
| Radio Browser | two `fetch`es, name and tag, merged | any, and live | no — HTML5 mode |
| Your files | — | blob URL, same-origin | yes |

**Live radio is HTML5, deliberately.** Howler's Web Audio path fetches the whole
sound with XHR before it plays, and a live stream never finishes downloading —
so it buffers forever without ever reporting an error. A plain media element
plays a live stream, which is why every radio source is `mode: 'html5'`. The
equaliser and the spectrum are off for those rows, and the UI says so rather
than showing a spectrum that cannot exist.

NCS is the one compromise. `ncs.io` has no public API and its S3 bucket refuses
listing, so `tools/scrape-ncs.py` freezes the library into `catalog/ncs.json`
(234 tracks, regenerated on demand) and the player loads that static file. The
audio host sends no CORS header, so those tracks play in HTML5 mode: full sound,
no equaliser, and the UI says so rather than quietly pretending otherwise.

## The look

A printed broadsheet, not a dashboard: warm paper, one ink, a spot colour lifted
from the cover, hard rules instead of shadows, and one flourish a print shop
earns — the title overprinted twice, a third of a centimetre out of register.
The grain is an inline SVG turbulence, so there is no image request.

Design references used: getlayers.ai, mobbin.com, cta.gallery,
grainient.supply, reelfolio.io.

## Tests

```bash
npm test                          # 72 unit tests, node --test, no dependencies
node tools/verify-ui.mjs          # 23 browser checks; needs the server running
python3 tools/scrape-ncs.py       # regenerate catalog/ncs.json
```

`tools/verify-ui.mjs` needs Playwright and a Chromium executable; set
`PW_MODULE` and `PW_EXECUTABLE_PATH` if they are not in the usual place.

## Licence

MIT — see [LICENSE](LICENSE). Howler.js is MIT, by James Simpson. Music belongs
to its owners; previews are previews and the full-length sources are the ones
their performers and licensors give away.
