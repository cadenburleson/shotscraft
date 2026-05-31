# ShotsCraft

Create beautiful App Store screenshots **and** marketing videos right in your browser — gradient backgrounds, 2D & 3D device mockups, text overlays, multi-language export, and animated reels. Free, open-source, nothing to install.

### ▶︎ [Use it free at shotscraft.com](https://shotscraft.com)

![ShotsCraft](img/screenshot-generator.png)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Features

- **Output & export** — iPhone & iPad App Store sizes, 10 social/video presets, and custom sizes; batch export to ZIP
- **Backgrounds** — multi-stop gradients, solid colors, image backgrounds (blur / overlay / fit), and noise texture
- **Device mockups** — 2D framing plus interactive 3D devices (iPhone, iPhone HD, MacBook, iPad, browser windows) with drag-to-rotate, shadows, and borders
- **Text** — headlines & subheadlines, 1500+ Google Fonts, and full styling / positioning
- **Video** — upload a clip, play and scrub it on the canvas or the 3D phone screen, and export to WebM or MP4
- **Multi-language** — AI translation (Claude / OpenAI / Google, bring your own key — stored locally), per-language screenshot images with filename auto-detection, and export every language at once
- **Projects** — multiple projects, auto-saved to your browser (IndexedDB)
- **Editor** — dark theme, side-preview carousel, drag-to-reorder, and an animation timeline for reels

<details>
<summary>Full feature list</summary>

**Output & Export**
- Multiple output sizes: iPhone 6.9", 6.7", 6.5", 5.5" and iPad 12.9", 11", plus 10 social/video presets (Instagram, X, LinkedIn, Facebook, OG, YouTube, TikTok…) and custom sizes
- Batch export of all screenshots as a ZIP
- Per-screenshot settings: each screenshot keeps its own background, device, and text

**Backgrounds**
- Multi-stop gradients with draggable color stops and angle control, plus quick presets
- Solid colors and uploaded image backgrounds (blur, overlay, fit options)
- Optional noise-texture overlay

**Device mockups**
- 2D: position, scale, rotate, and corner-radius controls
- 3D: interactive iPhone / iPhone (HD) / MacBook / iPad / browser-window mockups with drag-to-rotate, full 360° rotation on all axes, and HDR glass reflections
- Position presets (centered, bleed, tilt, perspective…), customizable shadows, and borders

**Text overlays**
- Headlines & subheadlines with enable/disable toggles
- 1500+ Google Fonts with search and preview
- Weight, italic, underline, strikethrough; top/center/bottom placement with offset and line-height control

**Video**
- Upload and play back video on the 2D canvas and the 3D phone screen (persists across reloads)
- Timeline with play/pause, scrub, mute, and volume
- Export to WebM (instant) or MP4 (lazy-loaded ffmpeg.wasm)

**Multi-language**
- Add any language with a flag switcher and per-screenshot text
- AI-powered auto-translation via Claude, OpenAI, or Google
- Localized screenshot images with language auto-detection from filenames, smart duplicate handling, and export of the current language or all languages

**Projects & UI**
- Multiple projects with auto-save (IndexedDB) and screenshot counts
- Dark theme, side-preview carousel, drag-to-reorder, collapsible panels, and tab persistence

</details>

## Run it

- **Just use it:** [shotscraft.com](https://shotscraft.com) — no install needed.
- **Locally** (a web server is required for IndexedDB persistence — opening `index.html` directly won't work):
  ```bash
  python3 -m http.server 8000   # or: npx serve .
  ```
  Then open http://localhost:8000.
- **Docker:** `docker compose up -d`, then open http://localhost:8080.
- **With Claude Desktop:** open the folder and say *“start the app”* — it starts the server for you (see `CLAUDE.md`).

## Tech stack

Vanilla JS · HTML5 Canvas · Three.js (3D) · IndexedDB · JSZip · ffmpeg.wasm (MP4) · Google Fonts · Claude / OpenAI / Google translation APIs · Docker + nginx

## What's new in ShotsCraft

Forked from `appscreen` and extended with:
- Video upload, playback, and a timeline (play / scrub / mute / volume) on both the 2D canvas and the 3D phone screen — persisted across reloads
- Video export to WebM (instant) or MP4 (lazy-loaded ffmpeg.wasm)
- 10 social/video output presets (Instagram, X, LinkedIn, Facebook, OG, YouTube, TikTok…)
- More devices: MacBook, iPad, macOS/Chrome browser frames, and a higher-detail "iPhone (HD)" model
- HDR environment system with 7 presets for glass reflections, plus full 360° rotation on all axes

## Apps built with ShotsCraft

Built something with it? Open a PR to add your app.

| App | Description | Link |
|-----|-------------|------|
| Cable | Manage your 12V systems like Boats and RVs | [cable.yuzuhub.com](https://cable.yuzuhub.com) |
| Eno | Wine pairings and food pairings made easy | [eno.yuzuhub.com](https://eno.yuzuhub.com) |
| TravelRates Currency Converter | Exchange Rates for Travelers | [apple.com](https://apps.apple.com/sg/app/travelrates-currency-converter/id6756080378) |
| Trakz Sales Tracker | Manage sales for restaurants and small businesses | [apple.com](https://apps.apple.com/us/app/trakz-sales-tracker/id6748954468) |
| AI Soccer Insights Football IQ | AI-powered football predictions and insights | [apple.com](https://apps.apple.com/us/app/ai-soccer-insights-football-iq/id6592649804) |
| Navegatime | Time tracking for workers and business functions | [play.google.com](https://play.google.com/store/apps/details?id=com.companyname.NavegaTime) |
| Sommo | Scan labels, learn wine, and build your tasting journal | [sommo.app](https://sommo.app) |
| Dandelion: Write and Let Go | An ephemeral journal for writing to let go, not save | [apple.com](https://apps.apple.com/us/app/dandelion-write-and-let-go/id6757363901) |
| *Your app here* | *Submit a PR to add your app* | *Your app link* |

## Credits

- **Samsung Galaxy S25 Ultra 3D Model** by [mistJS](https://sketchfab.com/mistjs) — Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **iPhone 15 Pro Max 3D Model** by [MajdyModels](https://sketchfab.com/majdymodels) — Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Apple iPhone 15 Pro Max Black 3D Model** (the "iPhone (HD)" option) by [Polyman Studio](https://sketchfab.com/Polyman_3D) — Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **MacBook Pro 16" M3 3D Model** (the "MacBook" option) by [jackbaeten](https://sketchfab.com/jackbaeten) — Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **HDR environment maps** courtesy of [Poly Haven](https://polyhaven.com/) and the [three.js examples library](https://github.com/mrdoob/three.js/tree/master/examples/textures/equirectangular) — both CC0.

## License

MIT — use, modify, and distribute freely.

## Forked from

ShotsCraft is a fork of [YUZU-Hub/appscreen](https://github.com/YUZU-Hub/appscreen) (MIT licensed). Many thanks to [Stefan](https://github.com/BlackMac) and the team at [YuzuHub](https://yuzuhub.com/en) for the original App Store screenshot generator this project builds on.
