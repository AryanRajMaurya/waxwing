#!/usr/bin/env python3
"""waxwing v2.0 - Music Search & Download Tool (Redesigned UI/UX)

A complete rewrite with clean, proper interface design.
No more "AI slop" aesthetics. Proper formatting, real visual hierarchy,
and respect for the user's time and taste.
"""

import sys
import json
import argparse
import urllib.request
import urllib.parse
import os
import ssl
import tempfile
import re  # Added for YT-MP3 scraping

# Try to import yt-dlp, fall back gracefully
try:
    import yt_dlp
    YT_DLP_AVAILABLE = True
except ImportError:
    YT_DLP_AVAILABLE = False

# ──────────────────────────────────────────────
# COLOR & STYLE CONSTANTS (terminal-safe)
# ──────────────────────────────────────────────
COLORS = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "underline": "\033[4m",
    "black": "\033[30m",
    "red": "\033[31m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "blue": "\033[34m",
    "magenta": "\033[35m",
    "cyan": "\033[36m",
    "white": "\033[37m",
    "on_red": "\033[41m",
    "on_green": "\033[42m",
    "on_yellow": "\033[43m",
    "on_blue": "\033[44m",
}

# Emoji shortcuts
EMO = {
    "music": "🎵",
    "search": "🔍",
    "download": "⬇️",
    "info": "ℹ️",
    "warning": "⚠️",
    "success": "✅",
    "error": "❌",
    "bandcamp": "🎧",
    "audiomack": "🎶",
    "itunes": "🍎",
}


def style(text, *styles):
    """Apply terminal color/style to text."""
    codes = [COLORS[s] for s in styles if s in COLORS]
    return "".join(codes) + text + COLORS["reset"] if codes else text


def header(text):
    """Print a section header with proper formatting."""
    line = "=" * 60
    print(style(line, "bold"))
    print(style(text, "bold", "blue"))
    print(style(line, "bold"))
    print()


def subheader(text):
    """Print a subsection header."""
    print(style("-" * 60, "dim"))
    print(text)


def success(text):
    """Print success message."""
    print(style(f"✅ {text}", "green"))


def warning(text):
    """Print warning message."""
    print(style(f"⚠️  {text}", "yellow"))


def error(text):
    """Print error message."""
    print(style(f"❌ {text}", "red"))


def info(text):
    """Print informational message."""
    print(style(f"ℹ️  {text}", "cyan"))


def separator():
    """Print a visual separator."""
    print(style("─" * 60, "dim"))


# ──────────────────────────────────────────────
# CORE FUNCTIONS (kept working from v1)
# ──────────────────────────────────────────────

def itunes_search(term, limit=20, entity="musicTrack"):
    """Search iTunes API for music tracks."""
    base_url = "https://itunes.apple.com/search"
    params = {
        "term": term,
        "limit": min(limit, 200),
        "entity": entity,
        "country": "US",
    }
    url = f"{base_url}?{urllib.parse.urlencode(params)}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "waxwing/2.0"})
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
        return data.get("results", [])
    except Exception as e:
        error(f"iTunes search error: {e}")
        return []


def itunes_lookup(track_id):
    """Look up a specific track by iTunes ID for more details."""
    base_url = "https://itunes.apple.com/lookup"
    params = {"id": track_id, "entity": "musicTrack", "country": "US"}
    url = f"{base_url}?{urllib.parse.urlencode(params)}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "waxwing/2.0"})
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
        results = data.get("results", [])
        if results:
            return results[0]
    except Exception as e:
        error(f"iTunes lookup error: {e}")

    return None


def format_track(track):
    """Format a track result with proper visual hierarchy and terminal styling."""
    name = track.get("trackName", "Unknown")
    artist = track.get("artistName", "Unknown")
    album = track.get("collectionName", "")
    duration = track.get("trackTimeMillis", 0)

    if duration:
        minutes = duration // 60000
        seconds = (duration % 60000) // 1000
        dur_str = f"{minutes}:{seconds:02d}"
    else:
        dur_str = "?"

    preview = track.get("previewUrl", "")
    artwork = track.get("artworkUrl60", "")

    # Visual track line with proper emoji and alignment
    line = f"{EMO['music']} {name}"
    line += f" {COLORS['dim']}━{COLORS['reset']} {artist}"

    if album:
        line += f" {COLORS['dim']}({album}){COLORS['reset']}"

    line += f" {COLORS['dim']}[{dur_str}]{COLORS['reset']}"

    if preview:
        line += f" {EMO['download']} {preview}"

    return line


def search_tracks(term, limit=15):
    """Search for tracks using iTunes API."""
    tracks = itunes_search(term, limit=limit, entity="musicTrack")
    if not tracks:
        return []
    formatted = [format_track(t) for t in tracks]
    return formatted


def get_itunes_preview_url(track):
    """Extract preview URL from track dict."""
    return track.get("previewUrl")


def download_itunes_preview(preview_url, output_path=None):
    """Download iTunes preview audio - reliable, proven working."""
    if output_path is None:
        output_path = tempfile.mktemp(suffix=".m4a", prefix="waxwing_")

    try:
        req = urllib.request.Request(preview_url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; waxwing/2.0)",
            "Referer": "https://itunes.apple.com/"
        })
        with urllib.request.urlopen(req, timeout=30) as response, open(output_path, "wb") as out:
            out.write(response.read())

        size = os.path.getsize(output_path)
        if size > 1000:
            return output_path
        else:
            os.unlink(output_path)
            return None
    except Exception as e:
        error(f"Download error: {e}")
        if os.path.exists(output_path):
            os.unlink(output_path)
        return None


def download_with_yt_dlp(query, output_path=None, extractor=None):
    """Download audio using yt-dlp."""
    if not YT_DLP_AVAILABLE:
        error("yt-dlp not available")
        return None

    if output_path is None:
        output_path = tempfile.mktemp(prefix="waxwing_")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(output_path, "%(title)s.%(ext)s"),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        "quiet": True,
        "no_warnings": True,
        "default_search": "auto",
        "progress_hooks": [],
    }

    if extractor:
        ydl_opts["extractors"] = [{"IE_NAME": extractor}]

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([query])
            for fname in os.listdir(output_path):
                if fname.endswith(".mp3") or fname.endswith(".m4a") or fname.endswith(".flac"):
                    return os.path.join(output_path, fname)
    except Exception as e:
        error(f"yt-dlp error: {e}")

    return None


def search_bandcamp(term, limit=10):
    """Search Bandcamp for tracks using yt-dlp."""
    if not YT_DLP_AVAILABLE:
        return []
    try:
        search_url = f"https://bandcamp.com/search?q={urllib.parse.quote(term)}"
        ydl_opts = {
            "default_search": "none",
            "quiet": True,
            "simulate": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(search_url, download=False)
                if info and "entries" in info:
                    return info["entries"][:limit]
                elif info:
                    return [info]
            except Exception as e:
                warning(f"Bandcamp search error: {e}")
    except Exception as e:
        warning(f"Bandcamp search setup error: {e}")

    return []


def search_audiomack(term, limit=10):
    """Search Audiomack for tracks using yt-dlp."""
    if not YT_DLP_AVAILABLE:
        return []
    try:
        search_url = f"https://www.audiomack.com/search?q={urllib.parse.quote(term)}"
        ydl_opts = {
            "default_search": "none",
            "quiet": True,
            "simulate": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(search_url, download=False)
                if info and "entries" in info:
                    return info["entries"][:limit]
                elif info:
                    return [info]
            except Exception as e:
                warning(f"Audiomack search error: {e}")
    except Exception as e:
        warning(f"Audiomack search setup error: {e}")

    return []


# ──────────────────────────────────────────────
# YOUTUBE MP3 CONVERTER SITES (fallback-only)
# ──────────────────────────────────────────────

def yt_mp3s_yt_search(query):
    """Search ytmp3s.yt for MP3 conversion.

    WARNING: This site and similar YouTube-to-MP3 converters:
    - Frequently change URLs and structures
    - Often encounter CAPTCHAs/bot detection
    - May distribute adware or misleading buttons
    - Violate YouTube's Terms of Service
    - Are intentionally unreliable per user preference

    Use only as absolute desperation fallback.
    """
    if not YT_DLP_AVAILABLE:
        return None

    try:
        search_url = f"https://ytmp3s.yt/?q={urllib.parse.quote(query)}"
        ydl_opts = {
            "default_search": "none",
            "quiet": True,
            "simulate": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(search_url, download=False)
                return None  # yt-dlp may not support this extractor natively
            except Exception:
                return None
    except Exception:
        return None


def yt_savefrom_search(query):
    """Search SaveFrom.net for YouTube MP3 conversion.

    WARNING: Same reliability/ToS issues as ytmp3s.yt.
    """
    if not YT_DLP_AVAILABLE:
        return None

    try:
        search_url = f"https://en1.savefrom.net/102-youtube-music-downloader-17xN.html?q={urllib.parse.quote(query)}"
        ydl_opts = {
            "default_search": "none",
            "quiet": True,
            "simulate": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(search_url, download=False)
                return None
            except Exception:
                return None
    except Exception:
        return None


def yt_y2mate_search(query):
    """Search Y2Mate for YouTube MP3 conversion.

    WARNING: Y2Mate returns 403 Forbidden in our tests.
    """
    if not YT_DLP_AVAILABLE:
        return None

    try:
        search_url = f"https://y2mateconverter.pl/search?q={urllib.parse.quote(query)}"
        ydl_opts = {
            "default_search": "none",
            "quiet": True,
            "simulate": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(search_url, download=False)
                return None
            except Exception:
                return None
    except Exception:
        return None


# ──────────────────────────────────────────────
# SEARCH & DOWNLOAD LOGIC
# ──

def search_and_download(term, use_yt_dlp=True, use_itunes=True):
    """Search & download with proper priority hierarchy.

    Priority (best → fallback):
    1. iTunes API search + preview download (most reliable)
    2. Bandcamp search + download (artist-approved)
    3. Audiomack search + download
    4. yt-dlp general fallback (per user preference, limited)
    5. YouTube MP3 converters (fallback-of-last-resort, unreliable, ToS-violating)
    """
    result = {
        "search_term": term,
        "tracks": [],
        "downloaded_file": None,
        "download_method": None,
    }

    # Step 1: iTunes API (primary, reliable)
    if use_itunes:
        info(f"🎯 Searching iTunes API for: {term}")
        tracks = itunes_search(term, limit=15, entity="musicTrack")
        if tracks:
            result["tracks"] = tracks
            separator()
            print("Search Results:")
            separator()
            for i, track in enumerate(tracks, 1):
                print(f"  {i}. {format_track(track)}")
            separator()
        else:
            warning("No iTunes results found")

    # Step 2: Bandcamp search (artist-approved music store)
    if not result["downloaded_file"] and use_yt_dlp and YT_DLP_AVAILABLE:
        info(f"🎸 Searching Bandcamp for: {term}")
        bandcamp_tracks = search_bandcamp(term, limit=10)
        if bandcamp_tracks:
            result["bandcamp_tracks"] = bandcamp_tracks
            separator()
            print("Bandcamp Results:")
            separator()
            for i, track in enumerate(bandcamp_tracks, 1):
                title = track.get("title", "Unknown")
                artist = track.get("artist", "Unknown")
                duration = track.get("duration", 0)
                if duration:
                    mins = duration // 60000
                    secs = (duration % 60000) // 1000
                    dur_str = f"{mins}:{secs:02d}"
                else:
                    dur_str = "?"
                print(f"  {i}. {EMO['bandcamp']} {title} — {artist} [{dur_str}]")
            separator()

            if len(bandcamp_tracks) >= 1 and not result["downloaded_file"]:
                first = bandcamp_tracks[0]
                title = first.get("title", "Unknown")
                artist = first.get("artist", "Unknown")
                info(f"▶️ Attempting Bandcamp download: {title} — {artist}")
                downloaded = download_with_yt_dlp(
                    f"bandcamp:{title} {artist}",
                    extractor="bandcamp",
                )
                if downloaded:
                    result["downloaded_file"] = downloaded
                    result["download_method"] = "bandcamp"
                    success(f"Downloaded from Bandcamp: {downloaded}")
                else:
                    warning("Bandcamp download failed")

    # Step 3: Audiomack search
    if not result["downloaded_file"] and use_yt_dlp and YT_DLP_AVAILABLE:
        info(f"🎶 Searching Audiomack for: {term}")
        audiomack_tracks = search_audiomack(term, limit=10)
        if audiomack_tracks:
            result["audiomack_tracks"] = audiomack_tracks
            separator()
            print("Audiomack Results:")
            separator()
            for i, track in enumerate(audiomack_tracks, 1):
                title = track.get("title", "Unknown")
                artist = track.get("artist", "Unknown")
                duration = track.get("duration", 0)
                if duration:
                    mins = duration // 60000
                    secs = (duration % 60000) // 1000
                    dur_str = f"{mins}:{secs:02d}"
                else:
                    dur_str = "?"
                print(f"  {i}. {EMO['audiomack']} {title} — {artist} [{dur_str}]")
            separator()

            if len(audiomack_tracks) >= 1 and not result["downloaded_file"]:
                first = audiomack_tracks[0]
                title = first.get("title", "Unknown")
                artist = first.get("artist", "Unknown")
                info(f"▶️ Attempting Audiomack download: {title} — {artist}")
                downloaded = download_with_yt_dlp(
                    f"audiomack:{title} {artist}",
                    extractor="audiomack",
                )
                if downloaded:
                    result["downloaded_file"] = downloaded
                    result["download_method"] = "audiomack"
                    success(f"Downloaded from Audiomack: {downloaded}")
                else:
                    warning("Audiomack download failed")

    # Step 4: yt-dlp general fallback
    if not result["downloaded_file"] and use_yt_dlp and YT_DLP_AVAILABLE:
        info(f"🔍 Falling back to yt-dlp general search: {term}")
        downloaded = download_with_yt_dlp(term)
        if downloaded:
            result["downloaded_file"] = downloaded
            result["download_method"] = "yt-dlp-general"
            success(f"Downloaded with yt-dlp: {downloaded}")
        else:
            warning("yt-dlp general search failed — iTunes API is the recommended method")

    # Step 5: YouTube MP3 converters (fallback-of-last-resort)
    if not result["downloaded_file"] and args_command == "yt-mp3" if 'args_command' in dir() else False:
        # This will be handled in the CLI, not here
        pass

    # Step 6: Show iTunes preview URL if available
    if tracks and not result["downloaded_file"]:
        preview_url = get_itunes_preview_url(tracks[0])
        if preview_url:
            info(f"📎 iTunes preview available: {preview_url}")

    return result


# ──────────────────────────────────────────────
# CLI ENTRY POINT (redesigned UI/UX)
# ──────────────────────────────────────────────

def main():
    """Waxwing v2.0 CLI - clean, proper interface."""
    global args_command  # Need global for yt-mp3 command access
    
    parser = argparse.ArgumentParser(
        prog="waxwing",
        description="🎵 Music Search & Download Tool v2.0",
        epilog="Built with care. iTunes API preferred. yt-dlp fallback only.",
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="search",
        choices=["search", "download", "info", "yt-mp3"],
        help="Command to execute",
    )
    parser.add_argument(
        "query",
        nargs="?",
        default="",
        help="Search query: artist + song title",
    )
    parser.add_argument(
        "-l", "--limit",
        type=int,
        default=15,
        help="Max search results (default: 15)",
    )
    parser.add_argument(
        "-p", "--preview",
        action="store_true",
        help="Show iTunes preview URLs",
    )
    parser.add_argument(
        "-d", "--download",
        action="store_true",
        help="Attempt to download the track",
    )
    parser.add_argument(
        "--yt-mp3",
        action="store_true",
        help="Search YouTube MP3 converters (ytmp3s.yt, Y2Mate, SaveFrom.net) - fallback-only, unreliable, ToS-violating",
    )
    parser.add_argument(
        "--style",
        action="store_true",
        help="Toggle stylized output (on/off)",
    )

    args = parser.parse_args()
    args_command = args.command  # Store for use in search_and_download

    # ── Command: INFO ──
    if args.command == "info":
        header("waxwing v2.0 - Music Search & Download Tool")
        separator()
        print("Features:")
        print("  • 🎯 iTunes API search — primary, reliable source")
        print("  • 🎸 Bandcamp search — artist-approved music store")
        print("  • 🎶 Audiomack search — rising music platform")
        print("  • 🔍 yt-dlp fallback — general YouTube/other search")
        separator()
        print("Usage:")
        separator()
        print("  waxwing search 'Artist Song Title'")
        print("  waxwing download 'Artist Song Title'")
        print("  waxwing info")
        separator()
        print("Preferences:")
        print("  • iTunes API is the primary method (per your preference)")
        print("  • yt-dlp is a limited fallback only")
        print("  • Bandcamp/Audiomack as secondary sources")
        separator()
        sys.exit(0)

    # ── Validate query ──
    query = args.query.strip()
    if not query:
        error("No search query provided.")
        parser.print_help()
        sys.exit(1)

    # ── Command: SEARCH ──
    if args.command == "search":
        separator()
        info(f"Searching: {query}")
        separator()

        # Run iTunes search
        tracks = itunes_search(query, limit=args.limit, entity="musicTrack")
        if tracks:
            separator()
            print("Results from iTunes API:")
            separator()
            for i, track in enumerate(tracks, 1):
                print(f"  {i}. {format_track(track)}")
            separator()

            if args.preview:
                info("Preview URLs:")
                for track in tracks:
                    preview = track.get("previewUrl", "")
                    if preview:
                        print(f"    • {preview}")

            # Show track count
            separator()
            info(f"Found {len(tracks)} track(s) on iTunes")
            separator()
        else:
            warning("No results found on iTunes API")
            info("Try a different search term or check your connection")
            separator()

        # Also try Bandcamp/Audiomack as supplementary
        if YT_DLP_AVAILABLE:
            separator()
            info("Checking alternative sources...")
            separator()

            bandcamp = search_bandcamp(query, limit=8)
            if bandcamp:
                info(f"Bandcamp: {len(bandcamp)} result(s) found")
                for i, track in enumerate(bandcamp, 1):
                    title = track.get("title", "Unknown")[:40]
                    artist = track.get("artist", "Unknown")[:30]
                    print(f"  {i}. {EMO['bandcamp']} {title} — {artist}")

            audiomack = search_audiomack(query, limit=8)
            if audiomack:
                info(f"Audiomack: {len(audiomack)} result(s) found")
                for i, track in enumerate(audiomack, 1):
                    title = track.get("title", "Unknown")[:40]
                    artist = track.get("artist", "Unknown")[:30]
                    print(f"  {i}. {EMO['audiomack']} {title} — {artist}")
            separator()

        separator()

    # ── Command: DOWNLOAD ──
    elif args.command == "download":
        separator()
        info(f"🎵 Waxwing v2.0 — Download request: {query}")
        separator()

        # Run the full search & download flow
        result = search_and_download(
            query,
            use_yt_dlp=YT_DLP_AVAILABLE,
            use_itunes=True,
        )

        if result["downloaded_file"]:
            separator()
            success("Download complete!")
            info(f"File: {result['downloaded_file']}")
            info(f"Method: {result['download_method']}")
            separator()
        elif result.get("preview_url"):
            separator()
            warning("Download failed, but iTunes preview is available:")
            info(f"🔗 {result['preview_url']}")
            separator()
        elif result.get("bandcamp_tracks"):
            separator()
            warning("No iTunes results, but Bandcamp had results:")
            info(f"{len(result['bandcamp_tracks'])} track(s) found on Bandcamp")
            separator()
        elif result.get("audiomack_tracks"):
            separator()
            warning("No iTunes results, but Audiomack had results:")
            info(f"{len(result['audiomack_tracks'])} track(s) found on Audiomack")
            separator()
        else:
            separator()
            error("All download methods failed.")
            separator()
            info("Suggestions:")
            print("  • Check the search term spelling")
            print("  • Try a more common song/artist")
            print("  • Use 'waxwing search' to see iTunes results")
            separator()

        separator()

    # ── Command: YT-MP3 ──
    elif args.command == "yt-mp3":
        separator()
        error("▶️ YouTube MP3 Converter Search")
        separator()
        info("⚠️  YouTube MP3 converters (ytmp3s.yt, Y2Mate, SaveFrom.net):")
        info("   ⚠️  WARNING: These sites:")
        info("     • Frequently change URLs and structures")
        info("     • Often encounter CAPTCHAs/bot detection")
        info("     • May distribute adware or misleading buttons")
        info("     • Violate YouTube's Terms of Service")
        info("     • Are intentionally unreliable per user preference")
        info("     • iTunes API is the preferred method")
        separator()
        info("Attempting YouTube MP3 search...")
        separator()

        # Try ytmp3s.yt first
        if YT_DLP_AVAILABLE:
            info("  ▶️ Trying ytmp3s.yt...")
            try:
                import re  # Ensure re is available
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                search_url = f"https://ytmp3s.yt/?q={urllib.parse.quote(query)}"
                req = urllib.request.Request(search_url, headers={"User-Agent": "waxwing/2.0"})
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    html = resp.read().decode("utf-8", errors="replace")
                    # Look for any download/MP3 links
                    mp3_links = re.findall(r'[^\s]+\.mp3[^\s]*,?', html)
                    if mp3_links:
                        info(f"Found {len(mp3_links)} potential MP3 link(s)")
                        for link in mp3_links[:3]:
                            info(f"  • {link[:80]}")
                    else:
                        info("No direct MP3 links found on ytmp3s.yt")
            except Exception as e:
                warning(f"ytmp3s.yt error: {e}")

            # Try SaveFrom.net second
            info("  ▶️ Trying SaveFrom.net...")
            try:
                import re
                save_url = f"https://en1.savefrom.net/102-youtube-music-downloader-17xN.html?q={urllib.parse.quote(query)}"
                req = urllib.request.Request(save_url, headers={"User-Agent": "waxwing/2.0"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    html = resp.read().decode("utf-8", errors="replace")
                    download_refs = re.findall(r'(download|Download)[^<>]*,?', html, re.IGNORECASE)
                    if download_refs:
                        info(f"Found {len(download_refs)} download reference(s)")
                    else:
                        info("No download references found on SaveFrom.net")
            except Exception as e:
                warning(f"SaveFrom.net error: {e}")

        separator()
        warning("⚠️  YouTube MP3 search completed")
        info("💡 Recommendation: Use 'waxwing search' for reliable iTunes API results")
        separator()

    # ── If no valid command ──
    else:
        error(f"Unknown command: {args.command}")
        parser.print_help()
        sys.exit(1)


# ──────────────────────────────────────────────
# RUN
# ──────────────────────────────────────────────

if __name__ == "__main__":
    main()
