---
name: verify
description: Verify Snakie changes end-to-end on this headless Pi — web build in headless Chromium via puppeteer-core; desktop renderer via the browser preview.
---

# Verifying Snakie on the headless dev Pi

No display, no hardware. Two surfaces are drivable:

## Web build (app.snakie.org bundle) — full interaction

```bash
npm run build:web                      # emits dist-web/ (index.html + board.html)
python3 -m http.server 5174 -d dist-web   # serve (0.0.0.0 — user can also preview)
```

Drive with **puppeteer-core + system Chromium** (`/usr/bin/chromium`, no
playwright/puppeteer download needed on ARM64):

```js
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})
```

Install `puppeteer-core` in the session scratchpad, NOT the repo.

Gotchas learned the hard way:
- The editor starts with **no file open** — click the "New file" button
  (`aria-label`/`title` "New file") before looking for `.monaco-editor`.
- The board icon is `button[aria-label="Toggle Board View"]`; it opens
  `board.html` as a popup — grab it via `browser.once('targetcreated', …)`.
- Cross-window relay is `BroadcastChannel('snakie.board.v1')` — you can post
  `{t:'request'}` from any page and observe the `{t:'source', payload}` reply.
- Keys that close a window (Esc in the popup) race the CDP dispatch — wrap
  `keyboard.press` in `.catch()`.
- The sim auto-connects ~400ms after load; give the page ~1.5s before driving.
- Register `page.on('dialog', d => d.accept())` BEFORE clicking anything —
  the app uses `window.confirm`, which blocks the page and times out CDP.
- To simulate iPad Safari storage: `evaluateOnNewDocument` deleting
  `showDirectoryPicker`/`showOpenFilePicker`/`showSaveFilePicker` — the app
  then falls back to the OPFS `Projects/` folder.
- Headless WebGL (Robot View / 3-D) needs `--use-angle=swiftshader
  --enable-unsafe-swiftshader` in the launch args.

## Desktop renderer (no Electron possible here)

`vite.preview.config.mjs` serves the renderer with the no-op `window.api`
fallback on :5174 (`npx vite --config vite.preview.config.mjs`). Good for
layout/UI checks only — device/fs features are inert. Real Electron behavior
(preload, IPC, serial) cannot be verified on this box; say so rather than
faking it.
