# Website media sources

Every moving picture on the marketing site, with its licence. `apps/web/src/content/media.ts` is what the page uses; `apps/web/test/media.test.ts` fails if this record and that file disagree.

## Hero film: Joham Coastal Road, Jeju

| | |
|---|---|
| What it is | Real aerial drone footage of a car on Joham Coastal Road (조천–함덕 해안도로), Jeju, at golden hour. Uploader's description: "Aerial drone tracking shot of a car driving on Joham Coastal Road at sunset, Jeju Island, South Korea." |
| What it is not | Not a TAPSO ride, not a Jeju bus, not the view from a bus seat. The page says so under the film. |
| Author | YounStudios (https://pixabay.com/users/younstudios-54710821/) |
| Source | https://pixabay.com/videos/jeju-island-south-korea-339975/ (published 2026-03-14) |
| Licence | Pixabay Content License, https://pixabay.com/service/license-summary/ (full terms: https://pixabay.com/service/terms/). Free use, attribution not required (we credit anyway), modification allowed; not to be redistributed on a standalone basis. |
| Downloaded | 2026-10-28, `339975_large.mp4`, 3840×2160, 29.97 fps, 52.8 s, 220,119,166 bytes, SHA-256 `2a4dd3fed6596f7f043c46b3c4bc1e101695fa57752c36f607788a6cdda33c83`. The original is not committed. |
| Edit | 18.0–34.0 s of the original, cut to a 15 s loop whose last second dissolves into the first (no visible jump), audio removed, H.264, `+faststart`. |

Files served:

| Path | Size | Use |
|---|---|---|
| `/media/hero/joham-coast-1080.mp4` | 1920×1080, CRF 31 | wide screens with more than 1500 device pixels across, not on a 3G connection |
| `/media/hero/joham-coast-720.mp4` | 1280×720, CRF 30 | other landscape screens, and any 3G connection |
| `/media/hero/joham-coast-portrait.mp4` | 720×1280 crop, CRF 30 | screens taller than 4:5 (phones) |
| `/media/hero/joham-coast-poster.webp` | 1600×900 | still before the film loads, on reduced motion, data saver, 2G, or a failed load |
| `/media/hero/joham-coast-poster-portrait.webp` | 720×1280 | same, on tall screens |

Reproduce from the original:

```bash
# A = 19–34 s, B = 18–19 s; A dissolves into B so the loop restarts on A's first frame.
ffmpeg -ss 18 -t 16.2 -i 339975_large.mp4 -filter_complex "[0:v]scale=1920:1080:flags=lanczos,split[x][y];[x]trim=1:16,setpts=PTS-STARTPTS,fps=30,settb=1/30[a];[y]trim=0:1,setpts=PTS-STARTPTS,fps=30,settb=1/30[b];[a][b]xfade=transition=fade:duration=1:offset=14,format=yuv420p[v]" -map "[v]" -an -c:v libx264 -preset slower -crf 31 -profile:v high -movflags +faststart joham-coast-1080.mp4
# 720p: scale=1280:720, CRF 30. Portrait: crop=1216:2160:1296:0,scale=720:1280, CRF 30.
# Stills: the frame at 19 s, scaled as above, WebP quality 70.
```

## V4 additional film selections: Jeju Udo and Jungmun

The user's original Pixabay clips were supplied on 2026-10-29 and
independently identified by their corresponding source video IDs. The real
scenes are sea/waves, **not** a bus ride, in-app recording or view from a bus.

| | Udo | Jungmun |
|---|---|---|
| Location | 제주 우도 해변 | 제주 중문 해안 |
| Author | somedaywish | Life_Vitamin |
| Source | https://pixabay.com/videos/korea-jeju-beach-sea-island-262066/ | https://pixabay.com/videos/wave-sea-ocean-jeju-289799/ |
| Licence | Pixabay Content License | Pixabay Content License |
| Licence URL | https://pixabay.com/service/license-summary/ | https://pixabay.com/service/license-summary/ |
| User-supplied original | `262066.mp4` · 1920×1080, HEVC, 14.04s, 17,982,817 bytes | `289799.mp4` · 1920×1080, HEVC, 28.85s, 14,429,846 bytes |
| Edit | Start at 1s, clip 9s, H.264 24fps, audio removed | Start at 3s, clip 9s, H.264 24fps, audio removed |

Optimized local files (output files live in `apps/web/public/media/hero/`):

| Path | Approx. size | Dimensions | SHA-256 |
|---|---:|---|---|
| `/media/hero/udo-720.mp4` | 1.86MB | 1280×720, H.264 24fps | `a5abcac1867c8777dbd9dcc65b060d2e2aa199c9f38171f2da6869836a015298` |
| `/media/hero/udo-portrait.mp4` | 1.58MB | 720×1280, H.264 24fps | `32eab74a65a1bcae91bcd4b9944d41fe66a60a095eb68afadeb2a78b315468b4` |
| `/media/hero/udo-poster.webp` | 102KB | 1600×900 | `1998b3e3dec13299220aa91db83860805cd8cdc268dac2c09e3474a9f8cfedf2` |
| `/media/hero/udo-poster-portrait.webp` | 61KB | 720×1280 | `813e3edeab1ede900ba4960654d378e8ad30c98edf0fb56032927050dcc0394e` |
| `/media/hero/jungmun-720.mp4` | 1.93MB | 1280×720, H.264 24fps | `8778fda655a2ddbba1dae757b464f947d6cbbeb7a9d356e8fedf891d65b0e20f` |
| `/media/hero/jungmun-portrait.mp4` | 1.58MB | 720×1280, H.264 24fps | `03bb5cebb83fb7cea0396c4500d5bdafa43a2373ce962cfd36bdaa9a1d08468f` |
| `/media/hero/jungmun-poster.webp` | 172KB | 1600×900 | `d7c33c67c299a637d73bd9164086cae438848d581c6e0e87287bc3fe43dc2d78` |
| `/media/hero/jungmun-poster-portrait.webp` | 77KB | 720×1280 | `b1a971e4f30c823cbc0a53314b4e8cb7cfedc93bf97d0093dbca6ea2352bb0b0` |

The original licensed clips are not committed. The three films now form an
**automatic, endlessly repeating sequence**: Joham Coastal Road → Udo beach →
Jungmun coast → Joham Coastal Road. Two permanent video elements are used:
the next film is preloaded while the current one plays, and a 1.2-second
crossfade starts roughly 1.65 seconds before the current clip ends. The old
clip stays opaque beneath the incoming film until the incoming video is
playing and the fade is finished. If loading is slow or autoplay is blocked,
the current video loops rather than cutting to black or flashing its poster. The hero has no on-page motion button. The browser's OS reduced-motion
preference remains supported without requiring users to find a setting.
Background playback pauses offscreen / in background tabs to conserve power,
and reduced-data connections stay on a still poster. No manual scene-selection
or film pause/play buttons are shown.

The Udo and Jungmun clips are included **only when the optimized files exist**
in the deployed public folder and report the expected MP4/WebP MIME types.
When the extra assets are missing, the original Joham video loops on its own.
Source manifest: `apps/web/src/content/media.ts`. Tests: `apps/web/test/media.test.ts`.

## The Lock Screen (separate manual preview)

In V4, the video stays in the hero and never morphs into a phone. The hero no longer has a manually selected iPhone preview; the separate, synthetic iPhone Live Activity walkthrough remains in the Journey section below. Scrolling does not move the film into an app UI. That layer is the web re-drawing of `LiveActivitySurfaces.swift` used everywhere else on the page (`NativeSurfaces.tsx`), on the page's synthetic ride (route 365, 제주시청(아라방면)), and is labelled "앱 화면은 미리보기 · 합성 데이터". It is not a screen recording of the app.

## Removed

The earlier hero clip (`jeju-journey.mp4`) was an AI-generated still with movement added, and `jeju-coast.webp` / `jeju-sunset.webp` were generated stills. They were removed with the refractive "liquid lens" effect on 2026-10-28.

## Still missing: footage of an actual ride

No usable footage exists of riding a Jeju bus along the coast. Searched on 2026-10-28: the repository, the owner's local video files, Pexels ("jeju bus", "jeju road", "jeju drive", "bus window ocean" and others) and Pixabay ("jeju", "jeju bus", "jeju road", "korea bus window"). Pexels and Pixabay have real Jeju coast footage and real car-window coast footage from other countries, but no view from a Jeju bus. Figma Weave (generation) is not linked to the Figma account, and no other generation tool is connected; generated footage would in any case have to be labelled as such.

To replace the hero film with the intended scene, shoot (or license) these, and drop them into `HERO_FILM` in `apps/web/src/content/media.ts` with a new entry in this file:

1. **Window seat, coast on the left.** A seated passenger's eye line through a side window of a Jeju bus on a coastal road (for example route 201 along the east coast or 202 along the west coast), sea and basalt walls passing, 20–30 s steady, landscape 4K, no faces or readable plates.
2. **The same ride, vertical.** 9:16 for phones, the same framing, so the portrait cut is not a crop.
3. **Phone in hand on the bus.** The rider's iPhone on the Lock Screen showing TAPSO's Live Activity, recorded on a real device from a real build. Until such a recording exists (physical-device validation is `UNVERIFIED`), the page keeps drawing the Live Activity and labelling it a preview.
4. **Getting off.** The stop approaching through the front window, 5–10 s, for the arrival moment.

Consent and permission: no recognisable passengers or drivers without written consent; check with the operator before filming inside a bus.
