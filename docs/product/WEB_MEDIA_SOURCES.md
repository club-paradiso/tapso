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

## The Lock Screen on the film

When the visitor scrolls, the same film is cut down to an iPhone screen and TAPSO's Lock Screen Live Activity is drawn over it. That layer is the web re-drawing of `LiveActivitySurfaces.swift` used everywhere else on the page (`NativeSurfaces.tsx`), on the page's synthetic ride (route 365, 제주시청(아라방면)), and is labelled "앱 화면은 미리보기 · 합성 데이터". It is not a screen recording of the app.

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
