#!/usr/bin/env python3
"""Build a static snapshot of the NCS (NoCopyrightSounds) music library.

ncs.io has no public API: `https://ncs.io/api/...` is a 404 and the audio lives
on an S3 bucket that answers `AccessDenied` to listing. What the site *does*
serve is a server-rendered music library whose play buttons carry the stream
URL, artist, title, cover and duration as data attributes:

    <a class="btn white player-play"
       data-url="https://ncsmusic.s3.eu-west-1.amazonaws.com/tracks/...mp3"
       data-artistraw="2frers" data-track="EYES ON US"
       data-cover="https://ncsmusic.s3.eu-west-1.amazonaws.com/tracks/.../100x100/....png"
       data-preview="84" ...>

So the catalogue is scraped here, once, into catalog/ncs.json, and the player
loads that file as a plain static asset -- no proxy, no key, no runtime
scraping, and it keeps working offline.

Usage:  python3 tools/scrape-ncs.py [--pages N] [--out catalog/ncs.json]
"""

from __future__ import annotations

import argparse
import html as htmllib
import json
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://ncs.io/"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

# Attribute values here contain nested markup (`data-artist` holds an <a> tag),
# so the tag body must be matched with quote awareness -- a plain `[^>]*` stops
# at the first `>` inside that nested tag and loses every attribute after it.
ANCHOR = re.compile(r"<a\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>", re.IGNORECASE)
ATTR = re.compile(r"([\w-]+)\s*=\s*\"([^\"]*)\"")


def fetch(url: str, timeout: int = 30) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "replace")


def parse_page(page: int) -> list[dict]:
    query = urllib.parse.urlencode({"display": "", "page": page})
    body = fetch(f"{BASE}?{query}")

    tracks: list[dict] = []
    for anchor in ANCHOR.findall(body):
        if 'player-play' not in anchor:
            continue
        attrs = {key: htmllib.unescape(value) for key, value in ATTR.findall(anchor)}
        url = attrs.get("data-url", "")
        if not url.endswith(".mp3"):
            continue
        tracks.append(
            {
                "id": attrs.get("data-tid") or url,
                "title": (attrs.get("data-track") or "").strip(),
                "artist": (attrs.get("data-artistraw") or "").strip(),
                "cover": attrs.get("data-cover") or "",
                "url": url,
                "duration": int(attrs["data-preview"]) if attrs.get("data-preview", "").isdigit() else 0,
            }
        )
    return tracks


def scrape(pages: int, delay: float = 0.6) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    empty_streak = 0

    for page in range(1, pages + 1):
        try:
            batch = parse_page(page)
        except Exception as err:  # noqa: BLE001 - a bad page should not kill the run
            print(f"  page {page}: {err}", file=sys.stderr)
            batch = []

        fresh = [t for t in batch if t["url"] not in seen]
        for track in fresh:
            seen.add(track["url"])
            out.append(track)

        empty_streak = empty_streak + 1 if not fresh else 0
        print(f"  page {page}: {len(batch)} found, {len(fresh)} new (total {len(out)})")

        if empty_streak >= 2:
            print(f"  stopping at page {page}: two empty pages in a row")
            break
        if page < pages:
            time.sleep(delay)

    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=40)
    parser.add_argument("--out", default="catalog/ncs.json")
    args = parser.parse_args()

    print(f"Scraping NCS music library (up to {args.pages} pages)…")
    tracks = scrape(args.pages)
    if not tracks:
        print("No tracks found; nothing written.", file=sys.stderr)
        return 1

    tracks.sort(key=lambda t: t["title"].lower())
    payload = {
        "source": "https://ncs.io",
        "generated": time.strftime("%Y-%m-%d", time.gmtime()),
        "count": len(tracks),
        "tracks": tracks,
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(tracks)} tracks to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
