# iPod (tannerv.com/ipod) → Vincent Velasco portfolio

Source: https://tannerv.com/ipod, the iPod.js open-source project
(https://github.com/tvillarete/ipod-classic-js, MIT, © 2019 Tanner Villarete).
Customized per request into a portfolio for Vincent Velasco (@mcvindle).

## Route map

| Source | Local | Owner files |
| --- | --- | --- |
| `https://tannerv.com/ipod` | `/` | `src/app/page.tsx`, `src/components/sites/ipod/**` |

Assets: `public/sites/ipod/` (copied from the repo's `public/`; SVG glyphs, gloss bars, dice, card suits, favicons).
Source screenshots: `docs/design-references/ipod/source-*.png`.

## Layout (from source styles + measured)

- Body: `100dvh` grid, min-height 550px, system font stack, black background in dark mode.
- Shell: 370px wide, max-height 37em, radius 30px, inset shadow `0 0 2.4em #555`, `-webkit-box-reflect` reflection, 1.5s "descend" scale-in. ≤576px: full-bleed, no radius/reflection.
- Screen: 260px tall, 24px margins (16px + safe-area on mobile), 4px black border, 8px radius.
- Split view: left menu 50% with `0 0 24px black` shadow; preview 50%. Header 20px, gradient `#feffff → #b1b6b9`, 13px bold title, battery indicator.
- List rows: 14px bold, 4px padding (27px rows), active row gradient `rgb(60,184,255) → rgb(52,122,181)` + arrow.
- Wheel: 220px, center 90px; Silver/Black colors from source (U2 removed).
- Theme follows the OS via matchMedia after mount: dark → Black shell on black page, light → Silver on white.

## Interactions

- Drag around wheel: tick every 15° (23° touch); velocity smoothing → skip 1/3/5/8 rows.
- Press labels: Menu (back; hold 500ms = home), ⏮/⏭ (track skip), ⏯ (play/pause); center = select (hold = long click).
- Keyboard: arrows scroll, Enter select, Escape menu, Space play/pause.
- Views slide in from the right (0.3s tween); preview updates 750ms after scrolling stops; music preview Ken Burns cross-fades every 5s.
- Now Playing: wheel = volume (bar shows 3s), center toggles scrubber.

## Customizations (requested)

- Root menu (header "Vincent Velasco"): Music, Instagram (https://ig.mcvindle.com), TikTok (https://tt.mcvindle.com), Games; "Now Playing" is appended while a song plays. No Links/About/Settings sub-menus (MIT notice kept in `THIRD_PARTY_NOTICES.md`).
- Music: opens straight into Cover Flow of the 10 songs in `src/data/favorite-songs.ts` (no sign-in). Source geometry adapted: 112px covers, `perspective: 500px`, active flat at `translateZ(0)`, flanks `rotateY(±60deg) translateZ(-80px)` (source used ±70deg/-65px), `transform 0.35s ease-out`. Floor reflection is a flipped duplicate image with a gradient mask (works without `-webkit-box-reflect`). Title/artist centered below. Landing on an album plays its 30s `previewUrl` after a 400ms settle and cross-fades a blurred, darkened cover backdrop (0.6s). Center = Now Playing; Menu = back.
- Games: Brick and Solitaire engines ported unchanged except asset paths.

## Omitted from source

Cover Flow album flip/track list, Search, Playlists/Albums/Artists (streaming-library views), Settings/About views, U2 + Mnelia themes, PWA service worker.
