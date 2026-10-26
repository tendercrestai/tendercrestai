# Thirty-second product overview

Original silent motion graphics and existing public fictional workspace captures, added to the homepage and demo page. Five six-second chapters: RFP, evidence, editing, review blockers, export/sample-demo CTA. This is an explanatory sequence, not a recording of an entire proposal being generated in 30 seconds. Captures show unresolved checks; the downloadable example package is an earlier reviewed revision. No customer data, real certifications, win rates or measured customer result is represented.

## User experience

Self-hosted 1280×720 H.264, 30.000 seconds, 1,166,093 bytes (about 1.17 MB); no audio track. WebP poster about 43 KB. No iframe, external media service, extra cookie/pixel or hosting dependency. `preload=none` and no autoplay/loop keep video requests behind interaction. A real play button and native controls support keyboard playback, pause, seeking and replay. English VTT captions and an expandable equivalent transcript are included. Native controls/transcript work without JavaScript; source failures or an eight-second playback-start timeout explain the fallback. Reduced-motion users get no decorative animation or automatic playback.

Homepage adds the overview CTA and a responsive evidence → draft → review → export card. Existing workspace, interactive demo, pricing, trials and billing links remain. Demo page keeps its interactive examples and full-size captures. Public build copies only reviewed media and playback assets; renderer source is not public.

## Files and regeneration

- Public: `assets/product-film.css`, `assets/product-film.mjs`, `assets/product-film/overview.mp4`, `poster.webp`, `overview.vtt`.
- Page integration: `index.html`, `demo.html`, explicit build allowlist and VTT content-type header.
- Offline developer source: `scripts/product-film.html`, `scripts/render-product-film.py`. Requires existing Python Playwright, Chromium at `/usr/bin/chromium`, ffmpeg/ffprobe with libx264/libwebp. It copies only three existing fictional captures into a temporary loopback server and records a 30-second canvas; no external requests, AI calls or private workspace recording. Full-range source is converted to limited-range 8-bit yuv420p for playback compatibility; MP4 has fast-start metadata. The renderer may produce slightly different byte sizes across runs.

Regenerate: `python scripts/render-product-film.py`; build: `node scripts/build-site.mjs`.

## Verification

- 329 existing Node tests passed.
- 45 real-media Chromium checks passed across homepage/demo and widths 390, 768 and 1280, including reduced motion, no initial MP4 request, keyboard play, five loaded caption cues, pause, seeking/end/replay, no browser errors, responsive layout, failed-source fallback, no-JavaScript transcript/controls and private-source exclusion.
- 28 existing interactive-demo/customer-workspace browser regressions passed.
- Pixel/codec metadata inspected and opening, evidence and export scenes visually reviewed. These are Chromium viewport checks, not physical iPhone/Safari testing. No narration is included.

Preview on a dedicated branch first. Verify actual deployed MP4 byte ranges, captions content type and hosted playback. No production migration, credential change, payment, customer mail or paid AI/media service is needed. Roll back by reverting this static-page/media change. Production publication remains subject to the owner's review of the concrete preview.
