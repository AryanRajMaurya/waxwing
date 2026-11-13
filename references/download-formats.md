# Download Formats Reference

## iTunes Preview Files (primary method)

- **Format**: M4A (MPEG-4 Audio)
- **Codec**: AAC (Advanced Audio Coding)
- **Typical duration**: ~30 seconds (standard iTunes preview length)
- **Typical bitrate**: 256 kbps constant
- **File size**: ~1 MB per 30-second clip
- **Sample rate**: ~44.1 kHz or 48 kHz
- **Channel mode**: Stereo
- **How to download**: Direct HTTP GET with User-Agent and Referer headers
  - Example: `urllib.request.urlopen(Request(url, headers={"User-Agent": "waxwing/1.0", "Referer": "https://itunes.apple.com/"}))`
- **Verification**: File size must be > 1000 bytes to accept as valid
- **ffprobe confirmation**: `format_name "mov,mp4,m4a,3gp,3g2,mj2"`, `duration ~30.0s`

## yt-dlp Downloaded Files (fallback method)

- **Format**: MP3 (default) or M4A (if no FFmpeg postprocessor)
- **Codec**: MP3 or AAC depending on selection
- **Variable duration**: Full song length, not limited to 30 seconds
- **Variable bitrate**: User-selected quality (default: 192 kbps MP3)
- **File size**: Full song length at selected bitrate (e.g., 3-min song at 192 kbps ≈ 6.8 MB)
- **How to download**: `yt-dlp` with `format: "bestaudio/best"` + `FFmpegExtractAudio` postprocessor
- **Output template**: `%(title)s.%(ext)s` in the output directory
- **Postprocessor**: `FFmpegExtractAudio` with `preferredcodec: "mp3"` and `preferredquality: "192"`

## Comparison Summary

| Aspect | iTunes Preview | yt-dlp Download | Bandcamp/Audiomack |
|---|---|---|---|
| **Duration** | ~30 seconds | Full track length | Full track length (varies) |
| **Format** | M4A (AAC) | MP3 (default) or best available | MP3 or best available |
| **Reliability** | High (Apple's own API) | Lower (depends on external sites) | Medium (site-level bot detection possible) |
| **Setup required** | None | yt-dlp + optional FFmpeg | yt-dlp only |
| **Typical use case** | Quick preview, metadata lookup | Full track when iTunes unavailable | Artist-approved full tracks |

## When to use which

- **Use iTunes preview first**: Always try the iTunes API preview download before falling back to yt-dlp. It's faster, requires no extra packages, and is more reliable.
- **Use yt-dlp as fallback only**: When iTunes preview download fails OR the user specifically requests a full track download. Documented user preference: "yt-dlp doesn't actually work well so find something that works well" — iTunes API is the intended primary method.
- **Use Bandcamp/Audiomack as secondary**: When iTunes has no results for the search term. These provide artist-approved full tracks from their respective stores. Bandcamp is particularly recommended for independent/emerging artists.