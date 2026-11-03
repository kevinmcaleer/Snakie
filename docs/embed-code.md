# Embedding Snakie's code editor (snakie#1285)

Any page can show a Python program in Snakie's editor, with blocks and a REPL
that runs in the reader's browser. kevsrobots.com is the first host
(kevinmcaleer/kevsrobots.com#454, #455). It replaces trinket.io, which shut down
on 31 August 2026.

The embed is a page of the web build, `https://app.snakie.org/embed.html`, so it
deploys with app.snakie.org and costs nothing to run. It shows only the editor,
the blocks and the REPL: no activity bar, files, device, wiring or build views.

## The one-line helper (#1288)

```html
<div data-snakie-gist="87a7e27a3273c30a413b2195927296fe" data-file="main.py" data-view="split">
  <a href="https://gist.github.com/87a7e27a3273c30a413b2195927296fe">See the code on GitHub</a>
</div>
<div data-snakie-repo="kevinmcaleer/burgerbot" data-path="main.py"></div>
<script src="https://app.snakie.org/snakie-embed.js" defer></script>
```

`snakie-embed.js` (about 5 KB, no dependencies) turns each `data-snakie-gist`,
`data-snakie-repo` or `data-snakie-code` element into the iframe when it nears
the viewport. Every other `data-*` attribute below becomes a URL parameter. The
iframe's height follows the embed's content: the embed posts its height, and the
helper only accepts messages from its own origin and its own frames. Without
JavaScript, the element's own content (a GitHub link) stays on the page.

For content added after the page loads (a live preview, an editor):

```js
const handle = SnakieEmbed.mount(el, { gist: '87a7…', file: 'main.py', view: 'code' })
handle.unmount()
SnakieEmbed.scan(root) // mount any new data-snakie-* elements under root
```

## The URL (#1286)

```
https://app.snakie.org/embed.html?gist=<id>&file=main.py
https://app.snakie.org/embed.html?repo=owner/name&path=src/main.py&ref=main&lines=10-40
https://app.snakie.org/embed.html?code=<text or base64url deflate>&name=main.py
```

| Parameter | |
| --- | --- |
| `gist` | A gist id, `user/id`, or the gist's URL. `file` picks the file (default: the first `.py`). `revision` pins a version. |
| `repo` + `path` | A file in a public repo, read from `raw.githubusercontent.com`. `ref` is a branch, tag or commit. Without it, `main` then `master` are tried. |
| `code` + `name` | The program itself, with no GitHub. Plain (URL-encoded) text, or deflated base64url as `encodeCode()` in `code-embed/share.ts` writes it. |
| `lines` | Show only these lines: `10-40`, `10` or `10-`. |
| `view` | `code`, `blocks` or `split`. Default: `blocks` if the file has Snakie's blocks footer, else `code`. Ordinary Python is turned into blocks too (#1019), with a raw Python block for any line no block matches. |
| `toolbox` | `basic` (the default, the beginner's drawers) or `advanced`. |
| `run` | `1` (default) shows Run and the REPL. `0` makes a read-only viewer. |
| `autorun` | `1` runs the program as soon as it loads. |
| `theme` | `skeuomorph` (default, light) or `dark`. |
| `height` | `auto` (default: sized to the code), `short` (320px), `medium` (460px), `tall` (640px), or a height in px. Longer code scrolls inside the box. |
| `width` | `full` (default), `wide` (860px), `medium` (680px), `narrow` (520px), a width in px, or a percentage like `60%`. A narrower box is centred, and never wider than the page. Handled by `snakie-embed.js` (not an `/embed` URL parameter). |
| `engine` | `micropython` (default) or `pyodide` (see below). |
| `packages` | Pyodide packages to load before running, comma-separated. Imports are detected anyway. |
| `id` | Echoed in the embed's `postMessage`s. The helper sets it. |

The footer always has **View on GitHub** (the gist, or the repo file at its
lines) and **Open in Snakie** (#1287), which opens the same file in the full app
as a new unsaved tab. If the reader edited the code, their version goes along,
compressed into the link's `#code=` hash, and the app says it was "edited from
the original". **Reset** in the embed puts the original back.

## Engines

- **MicroPython** (default): the web app's own WASM interpreter (about 0.23 MB),
  in a worker, with the simulated `machine` module and Snakie's libraries. It
  starts on the first Run, or the first key typed in the REPL.
- **Pyodide** (`engine=pyodide`, #1289): full CPython 3.14 for lessons that need
  numpy, pandas or matplotlib. Pyodide 314.0.7 is loaded from jsDelivr on the
  first Run (about 6 MB, then cached). `plt.show()` draws each figure as a
  picture above the REPL; figures left open at the end are drawn too. Blocks are
  off for this engine. `input()` isn't supported yet and says so. "Open in
  Snakie" still works, but the full app runs MicroPython, so its tooltip warns
  that pandas or matplotlib code won't run there.

Stop restarts the interpreter in both engines. A program with no `await` can't
be interrupted any other way without SharedArrayBuffer, and that needs COOP/COEP
headers the host page would have to send (which would break its YouTube embeds).

## How it's wired

- `src/renderer/embed.html` → `src/renderer/src/embed-main.tsx`, an extra entry
  in `vite.web.config.ts`. The service worker's navigation fallback skips it,
  so the app shell can't answer an embed URL.
- `code-embed/embed-boot.ts` runs first: it parses the URL and swaps in a
  private in-memory `localStorage` (`memory-storage.ts`). The embed shares
  app.snakie.org's origin, so without this it would restore and overwrite the
  learner's open files and layout. It also keeps working in a third-party
  iframe where storage is blocked.
- The editor is the app's own `PythonPane` and `BlocksSplit`, on the app's
  stores. The REPL is `EmbedTerminal` (xterm, the console's palette).
- `code-embed/source.ts` loads the code (Gist API, with a raw-file fallback when
  the 60-an-hour unauthenticated limit is hit) and builds both footer links.
- `code-embed/OpenFromUrl.tsx` is the full app's side of Open in Snakie.
- The embed page's CSP adds `api.github.com`, `gist.githubusercontent.com` and
  `cdn.jsdelivr.net` (`EMBED_CONNECT_ORIGINS` in `web/web-hosts.ts`). The app's
  own CSP is unchanged.

## Not yet

- Turtle drawings and the instruments have nowhere to draw in the embed; the
  program runs, but only its printed output shows.
- `input()` in either engine.
