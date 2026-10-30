# Embedding Snakie's parts tools (snakie#1277)

`npm run build:embed` builds `dist-embed/`:

| File | What |
| --- | --- |
| `snakie-parts.js` | One IIFE that sets `window.SnakieParts`. React is bundled. Blockly, Monaco and MicroPython are not. About 1.4 MB, or 420 KB gzipped. |
| `snakie-parts.css` | Every stylesheet the components use, scoped under `.snakie-embed`. About 210 KB, or 34 KB gzipped. |
| `assets/dc-solver.worker-*.js` | The circuit solver's worker. Serve it beside the script. |

kevsrobots.com is the first host (kevinmcaleer/kevsrobots.com#254). Copy the whole folder to one place on the host's site.

```html
<link rel="stylesheet" href="/snakie/snakie-parts.css">
<!-- The Soft Shell fonts are not bundled (a lib build would inline them as
     500 KB of base64). Without them the tokens fall back to system fonts. -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap">
<script src="/snakie/snakie-parts.js"></script>
```

## Libraries

Every mount takes `libraries: PartLibraryWithParts[]`: `{ id, name, parts: PartDefinition[] }`, the same shape `window.api.parts.listLibraries()` returns in the app. Build each part from its `parts.yml` with `SnakieParts.partFromYaml(text)`. A part's photo is drawn from `part.imageData`, so set that to the image's URL. The URL needs to be same-origin, or the image server must allow CORS, for the SVG export to inline it. Part images are never bundled.

## `mountCatalog(el, opts)`

This opens the full-screen catalog: a shelf per category, facet filters, multi-select and "Add to project".

- `libraries`: the libraries to show.
- `onAddMany(items)`: receives `[{ libraryId, part }]` for the parts picked.
- `onClose()`: called after the closing animation. The catalog has unmounted itself by then.
- `origin`: optional `{ x, y }` viewport point for the grow-from-the-button animation.
- `theme`: optional, `'skeuomorph'` (the default) or `'dark'`.

It returns `{ unmount() }`.

## `mountPartEditor(el, opts)`

This opens the Part Editor: breadboard and schematic views, pins over a photo, shapes and the pin inspector.

- `part`: the `PartDefinition` to edit. Leave it out for a new part.
- `libraryId` / `libraryName`: what the "Saved to" picker shows.
- `libraries`: other libraries, such as the standard one, for footprints and the boards a carrier imprints its pins from.
- `onSave(part, image)`: receives the cleaned part. `image` is a `Blob` when the user picked a new photo in the editor, and `null` when the photo is unchanged. Resolve to `{ ok: false, error }` to show the error in the editor's status line.
- `onClose()`: the editor's Done button.

Linking a 3-D model happens in the host, not here: `importMesh` copies a file into a part folder, so the editor says it needs the desktop app.

## `mountWiring(el, opts)`

This opens the wiring canvas, in life-like breadboard or schematic view.

- `robot`: a `RobotDefinition` (robot.yml's shape: `board`, `parts`, `connections`). A board endpoint is `board.<pin>#<pad index>` and a part endpoint is `<instance>.<pin>#<index>`.
- `libraries`: where the placed parts and the board resolve from. The board is the microcontroller part whose board id matches `robot.board`.
- `onChange(robot)`: fires on every edit.
- `view`: `'lifelike'` (the default) or `'schematic'`.

It returns a handle:

| Method | |
| --- | --- |
| `robot()` / `setRobot(robot)` | Read or replace the wiring. |
| `addParts([{ libraryId, part }])` | Place parts with fresh instance ids. This also fires `onChange`. |
| `setView(view)` | Switch between life-like and schematic. |
| `exportSvg()` | A `Promise<string>` of a standalone SVG. Computed colours are written in, and `<image>`s are read into `data:` URLs, so it renders through `<img>`. |
| `bomMarkdown()` / `pinoutMarkdown()` | The Bill of Materials and pinout tables, as Markdown (`shared/robot-docs.ts`). |
| `unmount()` | |

## `mountPartView(el, opts)`

This shows a part read-only, on the catalog preview's tabs: the board with its pins over the photo, and its schematic symbol.

- `part`: the `PartDefinition` to show. Its `imageData` is the photo URL.
- `pinout`: name each pin under the board as the pointer moves over it. It defaults to `true`.

There is no 3-D tab, because a mesh only resolves from a desktop parts folder. It returns `{ unmount() }`.

## Formats

`partFromYaml`, `partToYaml`, `robotFromYaml` and `robotToYaml` are the app's own parsers and writers.

## How it's wired

- The three components reach the libraries through `window.api.parts`. The entry, `src/renderer/src/embed/snakie-parts.tsx`, installs the preload fallback and then points `window.api.parts` at the host (`embed/parts-backend.ts`, `PartsBackend`). The components are the app's own, unchanged.
- `vite-plugin-embed-scope.ts` rewrites every selector to sit under `.snakie-embed`. `:root`, `html` and `body` become `.snakie-embed`, so the tokens and `data-theme` skins land on the embed root. A host can re-theme the components by setting the same custom properties (`--panel`, `--shell`, `--card`, `--editor`, `--text`, `--kw`, `--font-ui`, `--font-mono` and the rest of `index.css`'s Soft Shell set) on its own `.snakie-embed` rule. Host CSS doesn't reach in either, unless it styles bare elements such as `button` or `input` globally.
