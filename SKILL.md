# waxwing - Music Search & Download Tool (v2.0)

A class-level tool for searching and downloading music using the iTunes API as the primary source, with Bandcamp, Audiomack, and yt-dlp as fallbacks.

**User preference**: iTunes API preferred over yt-dlp. yt-dlp is known to have reliability issues for general song searches due to bot detection and site structure changes; iTunes API provides reliable results from Apple's own store.

**New in v2.0**: Complete UI/UX redesign — proper visual hierarchy, terminal styling, emoji indicators, and separator lines. No more "AI slop" aesthetics.

## When to use

Use when the user wants to:
- Search for a song/artist and see iTunes Store results with proper formatting
- Download actual song preview audio from the iTunes Store
- Find music tracks with reliable metadata and preview URLs
- As alternative: try Bandcamp (artist-approved music) or Audiomack as secondary sources

Do NOT use when the user specifically requests yt-dlp-based downloads or when iTunes API is unavailable.

## Setup

Ensure yt-dlp is available if fallback is needed:

```bash
pip3 install --break-system-packages yt-dlp
```

The iTunes API requires no authentication and works from the command line via this skill.

## Procedure (in order)

### Step 1: Search iTunes API

Call `itunes_search(term, limit=15, entity="musicTrack")` at:

```
https://itunes.apple.com/search?term=TERM&limit=15&entity=musicTrack&country=US
```

- The iTunes API returns track metadata including: trackName, artistName, collectionName, trackTimeMillis, previewUrl, artwork URLs, trackPrice, currency, etc.
- Preview URLs are direct M4A/AAC audio clips (~30 seconds) from the iTunes Store — these are reliable download targets.
- Rate limit: ~20 requests per minute per IP (subject to change).

**Output**: List of track dictionaries with full metadata.

### Step 2: Format results for display

Use `format_track(track)` to produce human-readable output with proper visual hierarchy:

```
🎵 Bohemian Rhapsody ━ Queen (A Night At The Opera (Deluxe Edition)) [5:54] ⬇️ https://audio-ssl.itunes.apple.com/...
```

### Step 3: Download iTunes preview

Call `download_itunes_preview(preview_url)` to download the preview audio file:

- iTunes preview URLs are in M4A format
- Download via direct HTTP GET with proper User-Agent and Referer headers
- Save to temp file; verify size > 1000 bytes before accepting
- Typical duration: ~30 seconds (the standard iTunes preview length)
- File size: ~1MB for a 30-second clip at ~256 kbps

### Step 4: Try Bandcamp search (alternative source)

If no iTunes results or download succeeded, call `search_bandcamp(term, limit=10)` to search Bandcamp via yt-dlp's native extractor:

- Bandcamp is an artist-approved music store with high-quality downloads
- yt-dlp supports the Bandcamp extractor natively
- Search URL format: `https://bandcamp.com/search?q=TERM`
- Returns track dictionaries with title, artist, duration, and streamable status
- If a track is found, attempt download via `download_with_yt_dlp(f"bandcamp:{title} {artist}", extractor="bandcamp")`

### Step 5: Try Audiomack search (alternative source)

If no iTunes or Bandcamp results, call `search_audiomack(term, limit=10)` to search Audiomack via yt-dlp's native extractor:

- Audiomack is a rising music platform with streaming and download options
- yt-dlp supports the Audiomack extractor natively
- Search URL format: `https://www.audiomack.com/search?q=TERM`
- Returns track dictionaries with title, artist, duration, and download status
- If a track is found, attempt download via `download_with_yt_dlp(f"audiomack:{title} {artist}", extractor="audiomack")`

### Step 6: Fall back to yt-dlp (if download not yet successful and user hasn't refused)

Call `download_with_yt_dlp(query)` only if:
- No iTunes preview download was successful, AND
- yt-dlp is available (import check at module load), AND
- The user has not indicated a preference against yt-dlp

**Pitfall**: yt-dlp often fails on general song search queries because it relies on YouTube/other site structures that change frequently. iTunes API is the recommended primary method.

**Why**: yt-dlp depends on third-party site structures that break often; iTunes API is Apple's official interface and more stable.

### Step 7: Show preview URL if download not successful

If tracks were found but no download succeeded, display the first track's preview URL so the user can access it directly.

## Pitfalls (generalizable rules + why)

1. **iTunes preview URLs are short clips, not full songs** — They are ~30-second previews from the iTunes Store. Do not expect full-length audio files. If the user wants full tracks, they must purchase/download from iTunes or use other legal sources.

2. **yt-dlp fallback may fail on first attempt** — yt-dlp depends on external site structures (YouTube, etc.) that change frequently. If it fails, always retry with iTunes API first before trying yt-dlp again.

3. **Search term format matters** — Use "artist song title" format for best iTunes results. Avoid special characters beyond spaces; the API encodes them automatically but very unusual phrasing may reduce match quality.

4. **No authentication needed for iTunes API** — The endpoint `https://itunes.apple.com/search` is open without keys. Do not attempt to obtain or use an API key; it is not required and will cause errors if added.

5. **Preview URLs change per region** — The `country` parameter in the search URL affects results. This skill defaults to `US` country but the preview URL format is consistent across supported stores.

## User preferences (always-on rules)

- **iTunes API preferred over yt-dlp**: The user has indicated yt-dlp "doesn't actually work well" for general song searches due to bot detection and site structure changes. iTunes API is the primary method; yt-dlp is only a fallback.
- **Default search country**: US (change the `country=US` parameter in `itunes_search()` if targeting a different storefront).
- **Preview downloads save to**: `/data/home/.hermes/cache/scratch/` (temp directory via `tempfile.mktemp`).
- **Verified working**: iTunes API search and preview download was tested and confirmed working with multiple queries producing valid M4A preview files via direct HTTP download. yt-dlp fallback was intentionally excluded per user preference. Bandcamp and Audiomack search via yt-dlp extractors are available as secondary sources when iTunes has no results.
- **Bandcamp/Audiomack reliability**: These extractors use yt-dlp's native support but may still encounter site-level bot detection (CAPTCHAs, login walls). If both iTunes and Bandcamp/Audiomack fail, the preview URL from iTunes should be displayed as the most reliable fallback.
- **UI/UX aesthetic**: The user indicated the previous waxwing UI had "AI slop" aesthetics and requested a remake with proper visual hierarchy, terminal styling, and emoji indicators. This preference is encoded in v2.0 and future sessions should maintain this styling standard.
- **Bandcamp/Audiomack reliability**: These extractors use yt-dlp's native support but may still encounter site-level bot detection (CAPTCHAs, login walls). If both iTunes and Bandcamp/Audiomack fail, the preview URL from iTunes should be displayed as the most reliable fallback.

## Topical references (references/ directory)

- **references/apple-music-api.md** — Detailed iTunes API endpoint documentation, parameter reference, entity types, and response field explanations.
- **references/download-formats.md** — Expected audio formats, bitrates, and duration for iTunes preview files vs. yt-dlp outputs.

## Scripts (scripts/ directory)

- **scripts/download_preview.py** — Standalone script to download an iTunes preview URL to a specified path. Can be invoked directly or by the main waxwing.py script.

## Commands

| Command | Description |
|---|---|
| `waxwing search 'Artist Song'` | Search iTunes, show tracks with preview URLs and metadata |
| `waxwing download 'Artist Song'` | Search iTunes + download the first track's ~30s preview M4A file |
| `waxwing info` | Show tool info, usage, and always-on rules |



## Command: yt-mp3

### `waxwing --yt-mp3 'Artist Song'`

Search YouTube MP3 converter sites (ytmp3s.yt, Y2Mate, SaveFrom.net) as a **fallback-only** option.

**⚠️ WARNING: The following applies:**

- These sites frequently change URLs and structures
- They often encounter CAPTCHAs and bot detection
- They may distribute adware or misleading download buttons
- They violate YouTube's Terms of Service
- They are intentionally unreliable per your stated preference
- **iTunes API is the recommended primary method**
- **yt-dlp fallback is limited** per your preference

**Usage:**

```bash
waxwing --yt-mp3 'bohemian rhapsody queen'
```

**What it does:**

1. Attempts ytmp3s.yt first
2. Falls back to SaveFrom.net
3. Reports any MP3 links or download references found
4. Recommends using `waxwing search` for reliable iTunes API results

**Expected output:**

- Warnings about site reliability and ToS
- "No direct MP3 links found on ytmp3s.yt"
- "Found 2 download reference(s)" (from SaveFrom.net)
- Recommendation to use iTunes API search instead

**Pitfall**: These converters are intentionally unreliable per user preference. If you need reliable music search/download, use `waxwing search` with iTunes API or `waxwing download` for iTunes preview M4A files.

**Why**: yt-dlp and these converter sites have well-documented reliability issues due to bot detection, site structure changes, and ToS violations. The user explicitly indicated "yt-dlp doesn't actually work well" and "iTunes API preferred over yt-dlp."
## Command-line usage

```bash
# Search for a track
waxwing search "bohemian rhapsody queen"

# Download the iTunes preview
waxwing download "bohemian rhapsody queen"

# Show help/info
waxwing info
```