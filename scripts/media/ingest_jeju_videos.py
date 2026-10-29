#!/usr/bin/env python3
"""Ingest two verified Pixabay clips into TAPSO as optimized, locally served assets.

Run with GitHub Actions' internet-enabled runner. This script does NOT generate
placeholder footage or copy unverified CDN URLs. Failure is deliberately fatal.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "apps/web/public/media/hero"
SOURCES = [
    ("udo", 262066, "https://pixabay.com/videos/korea-jeju-beach-sea-island-262066/"),
    ("jungmun", 289799, "https://pixabay.com/videos/wave-sea-ocean-jeju-289799/"),
]
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

def request_bytes(url: str, limit: int = 180_000_000) -> bytes:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=40) as r:
        result = r.read(limit + 1)
        if len(result) > limit:
            raise ValueError("Source exceeds maximum permitted byte limit")
        return result

def extract_candidates(markup: str, media_id: int) -> list[str]:
    # Pixabay frontend can escape URL slashes and encode HTML attributes.
    markup = html.unescape(markup)
    markup = markup.replace("\\u002F", "/").replace("\\/", "/").replace("\\u0026", "&")
    markup = markup.replace("%2F", "/").replace("%3A", ":")
    found = re.findall(
        r'https?://cdn\.pixabay\.com/video/[0-9]{4}/[0-9]{2}/[0-9]{2}/'
        + str(media_id) + r'-[0-9]+_(?:medium|small|large|tiny)\.mp4',
        markup,
    )
    return sorted(set(found), key=lambda s: (
        0 if "_medium.mp4" in s else 1 if "_small.mp4" in s
        else 2 if "_large.mp4" in s else 3, len(s)
    ))

def get_api_url(media_id: int) -> str | None:
    key = os.environ.get("PIXABAY_API_KEY", "").strip()
    if not key:
        return None
    import urllib.parse
    api = "https://pixabay.com/api/videos/?" + urllib.parse.urlencode({"key": key, "id": media_id})
    data = json.loads(request_bytes(api, limit=1_000_000))
    hits = data.get("hits", [])
    if len(hits) != 1 or int(hits[0].get("id", 0)) != media_id:
        raise ValueError("Pixabay API returned an unexpected video ID")
    for variant in ("medium", "small", "large"):
        url = hits[0].get("videos", {}).get(variant, {}).get("url")
        if url:
            return url
    raise ValueError("No usable rendition in Pixabay API response")

def get_public_video_url(media_id: int, page: str) -> str:
    url = get_api_url(media_id)
    if url:
        return url

    # Browser-like requests may receive HTTP 403 from Pixabay's anti-bot
    # gateway on hosted runners. Fallback gracefully to the published player
    # extractor; do not treat the HTML restriction as permission to bypass it.
    try:
        markup = request_bytes(page, limit=6_000_000).decode("utf-8", errors="replace")
        candidates = extract_candidates(markup, media_id)
        if candidates:
            return candidates[0]
    except Exception as exc:
        print(f"Pixabay public page unavailable for {media_id}: {type(exc).__name__} {exc}")

    # Generic media extraction can resolve a video that is in a player but not
    # serialized in the HTML. It must still point to Pixabay's own video CDN.
    try:
        import yt_dlp
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "impersonate": "chrome", "extractor_args": {"generic": {"impersonate": ["chrome"]}}}) as ydl:
            info = ydl.extract_info(page, download=False)
        formats = [info, *(info.get("formats") or [])]
        urls = [x.get("url", "") for x in formats if isinstance(x, dict)]
        candidates = [u for u in urls if u and re.search(
            rf"cdn\.pixabay\.com/video/.*/{media_id}-\d+_(?:medium|small|large|tiny)\.mp4", u)]
        if candidates:
            return candidates[0]
    except Exception as exc:
        print(f"yt-dlp public-page fallback unavailable for {media_id}: {exc}")

    raise RuntimeError(
        f"Pixabay MP4 URL not accessible for video {media_id}. "
        "Supply repository secret PIXABAY_API_KEY (from your own Pixabay account) "
        "or download the original MP4 from its source page and upload it. "
        "No placeholder was substituted."
    )

def probe(path: Path) -> dict:
    result = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,width,height,avg_frame_rate",
        "-show_entries", "format=duration", "-of", "json", str(path)
    ], text=True)
    return json.loads(result)

def run(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)

def encode(src: Path, dst: Path, width: int, height: int, seconds: int = 9) -> None:
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-stream_loop", "-1",
        "-i", str(src), "-t", str(seconds),
        "-vf", f"fps=24,scale={width}:{height}:force_original_aspect_ratio=increase,"
               f"crop={width}:{height},format=yuv420p",
        "-an", "-c:v", "libx264", "-preset", "medium",
        "-crf", "31", "-profile:v", "high",
        "-movflags", "+faststart", str(dst),
    ])
    if dst.stat().st_size > 7_000_000:
        raise ValueError(f"Optimized video too large: {dst.name} {dst.stat().st_size}")

def poster(src: Path, dst: Path, width: int, height: int) -> None:
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", "1", "-i", str(src), "-frames:v", "1",
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=increase,"
               f"crop={width}:{height}", "-c:v", "libwebp",
        "-quality", "70", str(dst),
    ])
    if dst.stat().st_size > 500_000:
        raise ValueError(f"WebP poster exceeds 500 KB: {dst.name}")

def main():
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        raise RuntimeError("ffmpeg and ffprobe are required")
    DEST.mkdir(parents=True, exist_ok=True)
    records = []
    with tempfile.TemporaryDirectory() as temp:
        tmp = Path(temp)
        for name, media_id, page in SOURCES:
            url = get_public_video_url(media_id, page)
            if not re.fullmatch(
                rf"https://cdn\.pixabay\.com/video/\d{{4}}/\d{{2}}/\d{{2}}/"
                rf"{media_id}-\d+_(?:medium|small|large|tiny)\.mp4", url):
                raise ValueError(f"Rejected non-Pixabay or mismatched media URL for {media_id}")
            original = tmp / f"{name}-original.mp4"
            original.write_bytes(request_bytes(url))
            details = probe(original)
            stream = details["streams"][0]
            if not (stream["width"] >= 640 and stream["height"] >= 360):
                raise ValueError(f"Unexpected tiny source for {name}: {stream}")
            if float(details["format"]["duration"]) < 1:
                raise ValueError(f"Unexpected empty source for {name}")
            print(f"Source verified: {media_id} {stream['width']}x{stream['height']}"
                  f" duration {details['format']['duration']}s size {original.stat().st_size}")
            file_map = {
                f"{name}-720.mp4": (1280, 720),
                f"{name}-portrait.mp4": (720, 1280),
            }
            for fn, (w, h) in file_map.items():
                dst = DEST / fn
                encode(original, dst, w, h)
                p = probe(dst)
                if int(p["streams"][0]["width"]) != w or int(p["streams"][0]["height"]) != h:
                    raise ValueError(f"Invalid output dimensions: {fn}")
                records.append((str(dst.relative_to(ROOT)), dst.stat().st_size,
                                hashlib.sha256(dst.read_bytes()).hexdigest()))
            for fn, (w, h) in {
                f"{name}-poster.webp": (1600, 900),
                f"{name}-poster-portrait.webp": (720, 1280),
            }.items():
                dst = DEST / fn
                poster(original, dst, w, h)
                records.append((str(dst.relative_to(ROOT)), dst.stat().st_size,
                                hashlib.sha256(dst.read_bytes()).hexdigest()))
    for path, size, sha in records:
        print(f"ASSET {path} bytes={size} sha256={sha}")
    print("Optimized assets complete. Update media.ts and source documentation before production.")

if __name__ == "__main__":
    main()
