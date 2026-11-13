#!/usr/bin/env python3
"""Download an iTunes preview audio file to disk.

Standalone script that can be invoked directly or imported by waxwing.py.
Usage: python download_preview.py <preview_url> [output_path]

Args:
    preview_url: The iTunes preview URL (M4A format)
    output_path: Optional output file path (defaults to temp file with .m4a suffix)

Returns:
    Path to the downloaded file, or None on failure.
"""

import sys
import os
import urllib.request
import tempfile


def download_preview(preview_url, output_path=None):
    """Download the iTunes preview audio file.

    Args:
        preview_url: The iTunes preview URL
        output_path: Optional output file path

    Returns:
        Path to downloaded file or None on failure
    """
    if output_path is None:
        output_path = tempfile.mktemp(suffix=".m4a", prefix="itunes_preview_")

    try:
        req = urllib.request.Request(preview_url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; waxwing/1.0)",
            "Referer": "https://itunes.apple.com/"
        })
        with urllib.request.urlopen(req, timeout=30) as response, open(output_path, "wb") as out:
            out.write(response.read())

        # Verify we got actual content
        if os.path.getsize(output_path) > 1000:
            return output_path
        else:
            os.unlink(output_path)
            return None
    except Exception as e:
        print(f"Error downloading preview: {e}", file=sys.stderr)
        # Clean up partial file
        if os.path.exists(output_path):
            os.unlink(output_path)
        return None


def main():
    """CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: python download_preview.py <preview_url> [output_path]", file=sys.stderr)
        sys.exit(1)

    preview_url = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    result = download_preview(preview_url, output_path)

    if result:
        print(f"Downloaded to: {result}")
    else:
        print("Download failed.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()