# Changelog

All notable changes to Snakie are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Status-bar messages for file syncing (#178).** The status bar now narrates
  what file syncing is doing: when you tag/untag a file, when you turn the sync
  toggle on or off, and for every automatic push on save (`Syncing main.py…` →
  `main.py synced to the board`, or a clear error). Messages are transient and
  auto-clear, complementing the small toolbar glyph.

### Fixed
- **Simulated device: file operations no longer fail with "NULL object".** The
  offline device's filesystem helpers (list/read/write/stat) now run their Python
  via the interpreter's **synchronous** exec instead of the Asyncify path, whose
  reentrancy could make a nested call return a NULL object — which surfaced as
  "NULL object" in the device-files panel and when installing the instruments
  library. `writeFile` now also **creates missing parent directories** (the
  in-memory VFS starts empty, so `/lib` is made on demand).
- **Simulated device: clearer message for `mip` installs.** Installing a `mip`
  package (e.g. the SAM speech library) on the offline device now reports that
  package install needs a network connection and a real board, instead of a
  cryptic "mip failed" (the WASM port has no `mip`/network).
- **No more `MaxListenersExceededWarning` for device status.** `useDeviceStatus`
  (used by ~18 components) now shares a single `device:status` subscription that
  fans out to all callers, and the preload raises the IPC listener ceiling for
  the legitimately multi-subscriber broadcast channels (`device:data`/`status`).

## [0.18.1] - 2026-06-30

### Fixed
- **Raspberry Pi: disable GPU rendering to stop VSync errors.** On the Linux
  arm64 (Pi) build, hardware acceleration is now disabled — the Pi's GL stack
  can't report VSync timing to Chromium, which spammed the console with harmless
  `GetVSyncParametersIfAvailable() failed` errors and could make GPU compositing
  unreliable. Software rendering is steadier for this UI on a Pi 4/5. Set
  `SNAKIE_ENABLE_GPU=1` to keep hardware acceleration.

## [0.18.0] - 2026-06-30

### Added
- **Raspberry Pi build (Linux arm64).** Releases now include an arm64 AppImage,
  `Snakie-<version>-arm64.AppImage`, for **Raspberry Pi 4 / 5 on 64-bit Pi OS**.
  It's built on a native `ubuntu-24.04-arm` runner (so the `serialport` native
  module is the correct arm64 build) and ships as an AppImage only (the arm64
  `.deb` is skipped because electron-builder's bundled `fpm` is x86-only).
- **Add Snakie to the Raspberry Pi / Linux menu.** A helper script
  (`scripts/install-linux-menu.sh`) installs a desktop entry + icon for the
  AppImage so Snakie appears in the menu under **Programming** (`Categories=
  Development`). Re-run it after updating, or `--uninstall` to remove it.

## [0.17.0] - 2026-06-30

### Added
- **Keep local files in sync with the device (#178).** Tick the **checkbox** next
  to a file in the Local files tree to keep it in sync with the connected board
  (untick to stop). A tagged file shows a green **⇄** sync glyph at rest; hovering
  the row swaps the checkbox back in so you can untick it. A single **sync toggle**
  on the device-files toolbar turns syncing
  on — pushing the tagged files immediately **and** keeping them in sync on every
  save — and off again. Its icon spins while syncing and becomes a **green tick**
  for a moment when a sync completes (the device tree refreshes so the pushed
  files appear). Each tagged file maps to `/<filename>` on the device; the tagged
  set and the toggle persist across reloads. Device-file editor tabs are now shown
  in **brackets** (e.g. `[main.py]`) to tell them apart from local files.
- **Offline mode — a simulated MicroPython device (#135).** Snakie now ships a
  built-in **Simulated device (offline)** that appears in the shell's port
  dropdown, so you can explore, learn and demo with **no hardware connected**:
  - It runs a **real MicroPython interpreter** (compiled to WebAssembly), so the
    **REPL and the Run button work for real** — `print("Hello, World!")`, loops,
    maths and the rest run and stream their output to the console. Hardware
    modules (`machine`, etc.) aren't available, so importing them raises
    `ImportError`, just like a board without that peripheral.
  - On top of the interpreter it emits a live, animated stream of `SNK …`
    telemetry, so the **instruments** (oscilloscope, multimeter, plotter, IMU,
    distance, encoder, button…) animate immediately, and it answers the **Board
    Viewer Live View**'s pin probe with plausible values that drift over time.
  - A distinct **"Simulated device · offline"** status-bar badge (amber LED) and
    a matching **SIMULATION** badge on the mini board viewer, so the board's pins
    are never mistaken for real hardware. Switching between the simulator and a real
    board is seamless (connecting to one disconnects the other).
  - Typing in the simulated REPL now handles spaces correctly (the console
    telemetry filter no longer absorbs a lone echoed space into the next `SNK …`
    line).
  - The simulated device has a **real in-memory filesystem** (the interpreter's
    VFS): uploaded files persist, list, read back and are **importable** — e.g.
    you can upload `instruments.py` to `/lib` and `import instruments` from the
    REPL (`/lib` is on `sys.path`). It's RAM-backed (not a fixed flash size) and
    resets on disconnect.
- **Accessibility quick wins (#188).** First pass over the renderer's
  accessibility audit:
  - The device REPL is now readable by screen readers — the xterm terminal runs
    in `screenReaderMode` and its container is a labelled `group` ("Device REPL
    console").
  - A single global `:focus-visible` ring now covers every interactive element
    that lacked a themed focus indicator, so keyboard focus is always visible.
  - A global `prefers-reduced-motion` block (plus gating the terminal cursor
    blink on the same preference) stops infinite pulses and transitions for users
    who ask for reduced motion.
  - A contrast pass raised the muted-text tokens (dark + light skins) and the
    dark editor's inactive line numbers / comment syntax to meet WCAG AA.
  - Glyph-only controls now expose real accessible names (Find's Match-case /
    Whole-word toggles, the plugin reload knob, the status-bar git branch count),
    with the decorative glyphs hidden from assistive tech.
  - Live regions announce async status that was previously silent: the Find
    match count, the top install banners, and the firmware flash progress /
    outcome.
  - Modal dialogs (Prompt, Settings, Firmware flasher) now trap Tab focus, move
    focus in on open and restore it to the trigger on close via a shared
    `useFocusTrap` hook; the Firmware flasher and Prompt modals also close on
    Escape from any control.

## [0.16.1] - 2026-06-30

### Added
- **Pimoroni Tiny 2350 in the Standard library.** Authored with the
  build-part-from-image skill (#198) — **16 castellated pads (8 per edge)** whose
  pinout is verified against Pimoroni's official Pins-and-Dims diagram: left edge
  (USB at top) **5V, GND, 3V3, A3 (GP29), A2 (GP28), A1 (GP27), A0 (GP26), GND**;
  right edge **GP0–GP7**. RP2350A, USB-C, RGB LED, BOOT/RST buttons and the Qw/ST
  connector. Ships a **life-like background photo with the background removed**
  (transparent) so the castellated edge renders cleanly. Its id matches the
  built-in board, so the Board View renders the Tiny 2350 life-like.

### Changed
- **build-part-from-image skill hardened for correctness + realism.** Pin
  assignments must now be verified against a real **pinout diagram** (not the
  product photo), with a **pad-count reconciliation** and a power/ground safety
  check, then confirmed with the user before finalising — this caught a dangerous
  5V/GND swap and a dropped GND pad on the Tiny 2350. The skill also **removes
  image backgrounds** (macOS Vision foreground mask, via the bundled `rmbg.swift`)
  and **assesses** the cutout, telling the user to use a smarter tool when it fails.

## [0.16.0] - 2026-06-29

### Added
- **Standard library updates (epic #191).** The Parts Library now keeps a
  versioned **Standard library** in step with GitHub:
  - **Categories with section headers** — parts are grouped under their category
    (Microcontroller, Computer, Sensor, Input, Output, Motor, Display,
    Communication, Power, IC, …) instead of a flat list (#193).
  - **Any component type** — the Standard library holds any part, not just
    microcontrollers (renamed *Standard Boards → Standard Parts*) (#192).
  - **Update check on startup** — Snakie checks GitHub for newer library versions
    at launch and caches the result (#194).
  - **Refresh** reloads parts from disk **and** re-checks GitHub (#195).
  - **"Updates available" indicator** with one-click **Update all** — each install
    is a fresh clone, so the new version is used immediately (#196).
  - **Publish (developer mode)** — a dev-only button bumps the Standard library
    version and pushes its git checkout to GitHub (#197).
- **Part-builder skill (#198).** A Claude skill (`.claude/skills/build-part-from-image`)
  that turns a product-page / part image + pinout into a Snakie part — extracting
  pins and drawing the defining components with the shapes & text tools
  (important features only; no copper traces).
- **Common robotic parts list (#199).** `docs/common-parts.md` — a curated
  wishlist of common parts to drive the part-builder skill.

## [0.15.1] - 2026-06-29

### Fixed
- **Firmware-update check no longer offers a cross-family build on connect.** The
  device's boot banner arrives over serial in chunks, so `MicroPython v1.28.0 …`
  could be read before the trailing `… with RP2040`. The check latched onto that
  partial line, couldn't identify the board family, and fell back to the
  catalog-wide newest — briefly offering a Raspberry Pi Pico the **micro:bit's
  2.1.2** (a separate 2.x version line). The check now finalises only once it can
  identify **both** the version and the board family from the banner (re-checking
  as the rest of the banner arrives), and never falls back to the catalog-wide
  maximum, so an rp2/esp device is only ever offered its own family's firmware.

## [0.15.0] - 2026-06-28

### Added
- **Undo / redo for every Part Editor operation (#187).** **Ctrl/Cmd+Z** undoes and
  **Ctrl/Cmd+Shift+Z** (or **Ctrl+Y**) redoes any change — pins, shapes, holes, text,
  image, dimensions, properties, drag/resize, alignment, paste-style and deletes —
  with **Undo / Redo toolbar buttons** too. A drag collapses into a single undo step,
  and the history resets when you start a new part.
- **Copy style / Paste style across the Part Editor.** Every element's mini-toolbar
  (shapes, text labels, pins and mounting holes) now has **Copy style** and **Paste
  style** buttons. Copy captures just the element's styling — a shape's fill /
  outline / corner radius + all caption styling, a label's font size / colour /
  bold-italic-underline / alignment, a pin's pad shape + type + capabilities, a
  hole's diameter — and Paste applies it to another element **of the same type**
  (Paste is disabled for a different type or an empty clipboard).
- **Mounting-hole mini-toolbar.** Selecting a mounting hole now shows a floating
  toolbar (like shapes/labels) with **Duplicate**, a **Size** control (a diameter
  slider + mm value) and **Delete**. Pins gained a small toolbar too (Duplicate +
  Copy/Paste style).
- **Install a part's MicroPython drivers from the Board View (#184).** A part can
  declare the driver file(s) it needs on the board (`drivers:` in `parts.yml` — a
  `source` + a `target` path, plus an optional label). When such a part is placed
  on the breadboard, the Board View shows a consent-first banner listing the parts
  that need a driver with an **Install drivers** action (nothing is copied without
  your click). Files are copied into place — creating folders as needed — via the
  device file-write API, and `github:`/`pypi:` specs install with `mip`; the banner
  shows per-driver progress + errors and waits for a connected board. The bundled
  `vl53l0x` example part ships a driver to demonstrate it.
- **Edit shape text inline + on multiple lines.** A shape's caption is now a
  multi-line **Text** field (Enter = new line), and you can **double-click a shape**
  to edit its text right on the canvas. Alignment buttons use proper left/centre/
  right icons (kept together on one row).
- **Mounting-hole tool in the Part Editor toolbar.** A dedicated toolbar button
  arms the add-mounting-hole tool (previously only reachable from the Layers panel).
- **Used-colour swatches on every Part Editor colour well.** The quick-pick grid of
  colours already used in the part (fills, strokes, label/text colours, PCB colour)
  now appears on **all** colour wells — the mini-toolbar fill/border/text dropdowns
  and the Properties panel's fill, outline, label, free-label and background pickers
  — so you can reuse a colour in one click anywhere.
- **Native window chrome + Window-menu listing for secondary windows (#185).** The
  **Board View** and **Find & Replace** windows now use the standard OS title bar
  (close / minimize / maximize) instead of being frameless, so the OS **Window menu
  auto-lists** every open window and they're more accessible. The in-app close
  button was removed in favour of the native one; a **View → Board View** item
  (⌘/Ctrl+Shift+B) still opens or focuses the Board View.
- **Styled text on Part Editor labels & shapes.** Free text labels and a shape's
  caption can now be **bold / italic / underlined**, sized, **coloured**, and
  **aligned** (left / centre / right); shape captions can also **wrap to the shape**
  (multi-line). Edit it from the Properties panel or from an **"A" text dropdown on
  the selected-component mini-toolbar** (size, colour, B/I/U, align, wrap). Rendered
  as pure SVG (manual word-wrapping) so it still exports to PNG/SVG/PDF; round-trips
  in `parts.yml`.
- **Adjustable rectangle corner radius in the Part Editor.** Rectangle shapes were
  always drawn with rounded corners; you can now set the **corner radius** (down to
  0 for sharp corners) from a slider + value box in the **Properties** panel and in
  the selected-shape mini-toolbar's **Border** dropdown. Round-trips in `parts.yml`.
- **Generate project docs from the Board View — BOM & pinouts (#127/#142/#143).**
  The Export menu now also produces two portable **Markdown** documents from the
  project's `robot.yml`: a **Bill of Materials** (microcontroller first, then parts
  grouped by type with quantities + the metadata from each `parts.yml`) and a
  **pinouts table** (MCU-pin-first rows for board wires, with part↔part wires
  listed separately). Both save as `<project>-bom.md` / `<project>-pinouts.md`.
- **Flash MicroPython to the BBC micro:bit (v1 & v2).** The firmware flasher now
  **detects a connected micro:bit** (the `MICROBIT` DAPLink drive, reading
  `DETAILS.TXT` to tell v1 from v2) and flashes the **latest MicroPython** by
  copying the right `.hex` onto the drive. Firmware versions come from Thonny's
  curated `daplink` catalog (the same source Thonny uses), so the list stays
  current; the dialog pre-selects the matching v1/v2 build. If the micro:bit is in
  **maintenance mode** (the `MAINTENANCE` drive) the flasher detects it but blocks
  the flash with guidance to reconnect normally — flashing MicroPython there can
  soft-brick the board.
- **Selected-component toolbar in the Part Editor.** Selecting a shape or text label
  now floats a dark mini-toolbar above it to **duplicate**, **rotate** (90° steps) or
  **delete** it; shapes also get a quick **fill** picker with a **grid of colours
  already used in the part** for one-click reuse, and a **border** dropdown (width
  slider + value and a border colour well).
- **Multi-select + align components in the Part Editor.** Shift/Ctrl-click shapes and
  labels — or drag a marquee around them — to select several at once, then use the
  **alignment toolbar** (left/centre/right, top/middle/bottom, distribute) to line
  them up. Pins and components can be aligned together in one selection. Dragging a
  single shape/label now also shows the **smart-alignment guides** (it snaps its
  centre to other items), matching pins.
- **Floating project browser on the Board Viewer.** The project name + description
  and the component hierarchy (the microcontroller + placed parts) now live in a
  **floating, collapsible browser** pinned top-left of the canvas (Fusion-360
  style), instead of the bottom dock. Collapse it to a small tab to reclaim space.
- **Export the board as an image.** The board view's zoom toolbar has an **Export**
  button offering **PNG**, **SVG** or **PDF** — it saves the whole drawing framed
  at 1:1 (independent of the current pan/zoom), named after the project.
- **Duplicate a part on the breadboard.** The selected-part toolbar gains a
  **Duplicate** button that drops a copy (fresh id, offset a little) and selects it.
- **SAM text-to-speech instrument (#167).** A new **SAM** (Software Automated Mouth)
  instrument in the dock: type into the speech bubble, pick the buzzer/speaker pin
  from a **dropdown of the selected board's GPIO pins**, and **Speak** — the IDE makes sure the [`sam`](https://github.com/kevinmcaleer/sam)
  library (with its `sam_render.mpy` accelerator) is on the board, installing it if
  needed, then synthesises the text out of that single pin. **Open demo** drops a
  runnable `sam_demo.py` into the editor.
- **Newer-firmware check (#173).** When a device is connected, Snakie reads its
  running MicroPython version from the REPL boot banner and compares it against the
  newest stable build in the firmware catalog. If a newer version exists, a prompt
  appears above the **Flash firmware** button (with a one-click **Flash**). A new
  Settings → *Firmware updates* toggle disables the check.

### Changed
- **The node-graph Board View shows the authored life-like board.** Instead of a
  stylised edge-laid pinout, the node-graph now draws the board's **real authored
  body** (image + component shapes + pins at their true positions) — identical to the
  Breadboard view and the Part Editor — and routes the connection wires to the real
  pad positions. The full Board View also opens on the **Breadboard** tab by default
  (remembered), so it matches the main window's mini board preview.
- **Centred Board View zoom.** The node-graph zoom (−/+ buttons and the mouse wheel)
  now keeps the board **centred with its top in view** (the wheel zooms toward the
  cursor) instead of growing out of the top-left corner.
- **Boxed pin annotations everywhere.** In the **mini board view**, the
  **breadboard (life-like)** microcontroller, **and the Part Editor**, each pin now
  shows a **grey board pin-number box** (the physical pin number, not the GPIO) next
  to the pad, then the **pin label**, then (for pins used in the code) the **code
  variable** — laid out outward from the pin and mirrored for each facing
  (left/right/top/bottom), so the editor preview matches the board views.
- **Mini board view renders the authored part.** For a board backed by a Parts
  Library microcontroller, the mini board now draws the part's **real body** (board
  image + component shapes + pins at their authored positions) via the same
  `PartBody` renderer as the Part Editor / full Board Viewer — with the boxed pin
  numbers + the code variable on used pins — instead of a stylised PCB. Built-in
  boards (no source part) keep the stylised fallback. The view is framed to its live
  content, with **hover zoom controls** (in / out / fit) and a scrollable viewport.
- **Collapsible connections table.** The Board Viewer's bottom connections table
  can now be **collapsed to its header** (and restored) to free up canvas space.
- **Cleaner part on the breadboard.** Removed the small ✕ remove badge from each
  placed part (it could clash with the part's title) — the selected-part toolbar's
  **trash** button is the single, tidier way to delete.
- **The parts list shows the board.** The component browser pins the currently
  selected **microcontroller** at the top (tagged "MCU"), listed alongside the
  parts wired to it.
- **Part versions auto-bump on edit (#172).** Saving an edited part now
  automatically increments its **PATCH** version when its content actually
  changed, so updates are easy to detect (a manual version change you make is
  respected instead). Combined with the existing library update checks, both
  parts and libraries are now version-tracked.
- **Smoother breadboard wiring (#182).** Breadboard wires are now **Node-RED-style
  Bézier noodles** that leave each pad with clearance in the direction the pin is
  **oriented** (a right-facing pin's wire leaves to the right, a top/bottom pin's
  upward/downward) and curve cleanly to a pin on the far side of a board (replacing
  the orthogonal routing). Wires now also draw **on top of the parts** instead of
  disappearing under a body, and they reflow live as you drag a part. (Schematic view keeps its
  right-angle routing.)

### Fixed
- **Firmware-update check no longer crosses board families.** With the micro:bit's
  separate **2.x** firmware line now in the catalog, a Pico (rp2, on 1.28.0) was
  wrongly told the micro:bit's **2.1.2** was a newer build — and the reported device
  version could come from a previously-connected board still in the console buffer.
  The check now reads the **most-recent** boot banner and compares only within the
  **connected board's own family**.
- **Part Editor pin labels on the top/bottom edges read vertically again.** After
  the boxed pin-number annotation landed, top/bottom pins drew their labels
  horizontally (so a dense column collided); they now rotate ±90° to run outward
  along the pin, matching the left/right edges and the previous behaviour.
- **Shape size shown in millimetres in the Part Editor.** A rectangle's width/height
  (and a circle's radius) are now edited in **mm** (a fraction of the board's real
  dimensions) instead of an opaque 0–1 fraction — so entering equal w/h gives a true
  square. Falls back to the raw fraction when the part has no board dimensions.
- **Opening the full Board Viewer from the mini board panel.** Its open button left
  the full viewer blank ("Open a Python file…") because the active file was never
  relayed to it — the main window now starts streaming the file whenever the board
  window opens via **any** path (toolbar or mini board), not just the toolbar.
- **Breadboard layout fixes for rotated parts (#180).** A rotated part's silk/pin
  text is no longer ever upside down (text is counter-rotated to stay readable),
  its title now sits centred above the rotated body, and **pin labels are a
  consistent size across parts** (they're no longer scaled by each part's
  real-world size).
- **The mini board view is always dark (#181).** Its node labels were invisible in
  light themes; the mini board now uses a fixed dark palette regardless of the app
  theme.

### Added
- **Name & describe your project on the board (#179).** The Board Viewer now has an
  inline-editable **project/robot name + description** above the parts list, saved
  into `robot.yml`. Empty fields show ghost placeholder text; pressing **Enter** (or
  clicking away) saves and flashes a "Saved to robot.yml" confirmation, and **Esc**
  reverts.
- **Resize shapes with drag handles in the Part Editor (#175).** Select a rectangle
  or circle component and drag its handles to resize — rectangles have 8 handles
  (corners + edge midpoints) for width/height, circles have 4 for the diameter. The
  dynamic alignment guides snap the resized edges to nearby pins, holes and other
  shapes (hold **Ctrl/Cmd** to resize freely). Polygons keep their vertex handles.
- **Rotate, rename & delete parts on the breadboard (#176).** Click a placed part
  in the Breadboard view to select it; a small toolbar appears above it to **rotate
  it 90° at a time** (its wires follow the rotated pins), **rename** it (a display-only
  alias — the part's properties are untouched), or **delete** it from the breadboard.
  The rotation is saved in `robot.yml`.

### Fixed
- **Breadboard parts are drawn to real-world scale.** Placed parts on the
  Breadboard view are now sized from their **real dimensions** (mm) relative to the
  board — instead of every part being fitted to one fixed footprint — so e.g. an
  HC-SR04 reads larger than a small sensor. Each part body is also rendered at a
  native size then uniformly scaled, so its **silk text, pads and strokes shrink
  with the body** (a part's added text no longer looks oversized on the breadboard).

### Added
- **Holes are drilled right through the board (#171).** Mounting holes, pin holes
  and castellation half-holes now cut through the PCB **and** the board image **and**
  the copper pad, so the real background shows through them — a much more realistic
  board. Only the holes are cut, never the copper around them. Applies in both the
  Part Editor and the read-only board/preview renderer.
- **Reopens your last folder on launch (#177).** Snakie remembers the working
  folder you last opened and restores it on the next start (if it still exists),
  so you don't have to re-open your project every session.
- **Zoom controls on the board viewer's Breadboard & Schematic views (#174).** The
  life-like Breadboard and Schematic views now have the same floating **− / % / +
  / fit** zoom cluster as the node-graph view and the Part Editor (previously they
  had only mouse-wheel zoom and a single "Fit" button), so all three board views
  share one consistent zoom UI.
- **Duplicate a part in the Parts Library.** The part-detail card has a
  **Duplicate** action that copies the selected part (with a fresh, unique id +
  "… copy" name) into the same library and opens the copy in the Part Editor — the
  quick way to spin up a near-identical board (e.g. the Pico family) without
  redrawing it.
- **Icon part actions + a Reload button.** The part-detail **Edit / Duplicate /
  Promote / Delete** actions are now compact icon buttons (with tooltips +
  accessible labels) instead of text. A new **Reload** button in the Parts toolbar
  re-reads the libraries from disk so on-disk edits show **without restarting the
  app** (it also refreshes the board graph in the same window).
- **Mini board view follows the Board Viewer.** Picking a different board in the
  full Board Viewer now switches the **mini board view** in the main window to the
  same board (relayed across windows), so the two never disagree.
- **Multi-select alignment in the Part Editor (#170).** Drag a marquee to select
  several pins, or **Shift / Ctrl / Cmd-click** to add or remove individual pins
  from the selection (the browser's blue text-highlight no longer appears while
  drag-selecting). A small **alignment toolbar floats just above the last-selected
  pin** and acts on the whole group: align **left / horizontal-centre / right** and
  **top / vertical-centre / bottom**, plus **distribute** horizontally/vertically
  (≥3 pins). The toolbar icons now picture the operation — a reference line with
  three differently-sized bars snapped to it — instead of bare arrows.
- **Smart alignment guides in the Part Editor (#169).** While dragging a pin (or a
  mounting hole), a **green centre-line** appears when it lines up horizontally or
  vertically with another pin/hole, and it **snaps** to that line; hold **Ctrl/Cmd**
  to drag freely without snapping. Holes align with holes, pins with pins.
- **Promote a board to the Standard Boards library (developer).** In a dev build, a
  microcontroller board part shows a **Promote to Standard / Update Standard** button
  in the Parts Library: it copies the board into the bundled `snakie-standard` library
  (runtime copy + the repo copy so it commits and ships). Re-promoting updates it.
- **Author boards in the Part Editor.** A board is just a part with the
  **Microcontroller** family — the Part Editor has a "this part is a microcontroller
  board" toggle (and a family picker) that makes it appear in the Board Viewer's
  board selector. The **Board Creator has been removed** in favour of the
  fuller-featured Part Editor; the board window's "+ board" button now opens the
  Part Editor on a starter Microcontroller part.
- **Boards render as the parts they are.** When a board comes from a Parts Library
  microcontroller part, the Board Viewer's **Breadboard** view now draws it with the
  part's **real appearance** (background image + your exact pin positions +
  castellations) via the part renderer — instead of the generic edge-laid pinout —
  so an authored board looks exactly as drawn. Wiring identity is unchanged (the
  board pad index still matches the part's flattened header order). Legacy built-in
  boards keep the edge-laid rendering.
- **Boards come from the Parts Library now.** The board selector (Board Viewer, the
  mini board view, I²C-detect) is sourced from **microcontroller parts** (`family:
  Microcontroller`) in your installed parts libraries — converted to boards with
  their full pinout — instead of a hardcoded list. A new bundled **Standard Boards**
  library (`examples/parts/snakie-standard`) ships accurate **Raspberry Pi Pico**,
  **Pico 2 W** and **ESP32 DevKit** parts; the old built-in definitions remain only
  as a fresh-install fallback. Same-id boards dedupe to the most complete pinout.
- **Mini board view in the instruments panel (#168).** A compact node-graph board
  sits at the top of the instruments dock, showing the **microcontroller + only the
  pins the current code uses** (auto-zoomed to fit just those pins — no pin table or
  toolbar). A small **expand** button opens the full Board Viewer, and the board
  **auto-swaps to match the REPL boot banner** when it names a known board.
- **Part Editor — stack, reshape, and hide components (#130).** Components (shapes
  + text labels) can be **restacked**: each row in the Components list has ▲/▼
  buttons, and the item at the **top of the list draws on top** (newly-added
  components land on top). The **polygon tool** now lets you **click an edge to add
  a point** (and click a vertex to remove it) — for component polygons *and* the
  board outline. **Pin rotation** is available for **every** pin (not just
  castellated), with a live degree readout — it turns the pin's silk label (and the
  half-hole on castellated pads). And **layer visibility is saved with the part**:
  hide the traced **PCB image** (or any layer) and it stays hidden in the Parts
  Library preview and the Board View while its bytes are kept for later refinement.
- **Robot definition + wiring, merged into the Board View (#128 / #139 / #140).**
  The Board Viewer gains **Breadboard** and **Schematic** view tabs alongside the
  node graph (top-left toggle). The **Breadboard** view draws the chosen
  microcontroller as its **real PCB** (the same accurate pinout the node graph
  uses) and each placed part with its **real Part-Editor appearance** — background
  image + accurate pin positions — wired with **node-RED-style noodles**. The
  **Schematic** view draws each part as its **real schematic symbol** and the MCU
  as a generic **IC block** following standard conventions — **power rails on top,
  a single combined GND at the bottom**, signals on the sides, and **plain pin
  stubs** (no negation-bubble circles). Pads on the same rail collapse to one
  terminal (every `GND`, every `3V3`, …) in Schematic but stay individual in
  Breadboard. Wires are **orthogonal,
  auto-routed** to step around components and keep a margin between parallel runs
  (a Hanan-grid A\* router); Breadboard wires use the same obstacle-avoiding route
  rounded into a noodle, so they **route around parts rather than behind them**.
  Both views **overlay the pins your code uses** (combining the node-graph data
  onto the same canvas) and **auto-zoom-to-fit**. Parts are added from a **slim
  right-side library dock** (collapsible) instead of a separate screen; power wires
  are red, ground white, and signal wires take a palette colour (or one you pick
  per wire). Every wire is mirrored in a **connections table** beneath the canvas.
  The whole project — chosen board, placed parts + placements, and the pin-to-pin
  connections — is saved as a human-readable **`robot.yml`** in the project folder
  (round-trips). Switching views never breaks a wire (index-based pin identity).
  See `docs/robot-definition.md`.
- **Part Editor — fast, accurate pin placement (#130).** Select a pin to get a
  faint **ghost array** (a 2.54 mm cross, four each way): drag a nearby pin and it
  **snaps to that grid**, or drag *from* the selected pin to **lay down a whole row
  of evenly-spaced pins** in one gesture. **Multi-select** pins (rubber-band drag
  or shift-click) to get an **alignment toolbar** — align left / right / top /
  bottom and distribute horizontally / vertically. Castellated pads are redrawn
  **Raspberry-Pi-style** — a **gold** pad with the **main hole centred on the pin**
  and a plated **half-hole** at the board edge (ground pads square, others
  rounded); the half-hole defaults to the nearer left/right edge and a pin's
  **rotate / flip** icons aim it any of the four ways. A **Background** colour well
  sets the PCB colour. Hovering a pin (in the Part Editor **and** the Board
  Viewer's Breadboard) shows **capability badges** (GPIO / PWM / ADC / I²C / SPI /
  UART) in pastel colours. Each layer now has a **padlock** beside its eye — lock a
  layer (e.g. the **PCB / background image**) and its items can't be selected,
  moved, resized, or created, so you can't nudge it out of place while wiring.
- **I²C-detect: pick the bus + pins (#165).** The instrument now has **Bus / SDA /
  SCL** dropdowns of the connected board's valid I²C pins (the RP2040/RP2350
  mapping — invalid combinations can't be chosen), and SCAN runs a one-shot probe
  on those exact pins (no running program needed).
- **Link a MicroPython library to a part (#166).** A part can carry a **Code
  library** — its import **module** name, a **library URL** (mip/git) and a
  **docs/README URL** (authored in the Part Editor). The Parts Library shows the
  module + a docs link, and adding the part to a project offers to **install the
  library onto the connected board** (via `mip`). And when you **connect a board or
  open a `.py` file**, a banner flags any linked library the file doesn't `import`
  and/or the board doesn't have — with a one-click **install** of the missing
  on-board libraries.
- **Parts Library — portable, community-authored & version-controlled (#129).**
  A new **Parts** view (in the Board Viewer — see below) browses your installed
  parts libraries and the parts inside them. Parts are **no longer hard-coded** into Snakie:
  each part lives in its own folder as a human-readable `parts.yml` (+ image
  asset), grouped into libraries (modelled on Fusion 360's electronics
  libraries) under `<userData>/parts/<library>/<part>/`. Search across every part
  by name / tag / family, drill into a part's **footprint + pinout table +
  metadata**, and manage **community libraries from a master registry**
  (browse → install via `git clone` → one-click **update** when a newer version
  is published). Versioning is SemVer; Snakie flags installed libraries that have
  a newer registry version. See `docs/parts-library.md`.
- **Part Editor — author parts (schematic, breadboard, parts.yml) (#130).** A
  full-screen visual editor (launched from the Parts view's **+ New part** or a
  part's **Edit**) authors the exact `parts.yml` the library stores. Flip between
  a **Schematic** view (a line-drawing symbol with the pads ↔ pins table) and an
  interactive **Breadboard** canvas managed from a **Layers panel** (top →
  bottom): **Components** (rectangles + text) → **Pins** → **Mounting holes** →
  **PCB**. The board **image sits on the PCB layer, clipped to the outline**;
  **mounting holes cut through** the PCB *and* the image, and you **can't drop a
  pin inside a hole**. The board outline is a **rectangle** (corner radius) or a
  **polygon**; every pin/hole/component is **free-placed** by dragging. Each layer
  has a visibility toggle (hide the PCB image → footprint view) and a
  **collapsible list of its items**. The properties live in a slim **right-hand
  panel** so the canvas dominates; an **icon toolbar** (Select · Pan · Fit · a
  **Shapes** dropdown · Text) plus an in-canvas **zoom control** drive it.
  Components are coloured **shapes** — **rectangle / circle / polygon** — with
  **fill / outline colour + outline width** wells; pins choose a **pad shape**
  (**square · round · castellated · header hole**); pin **silk labels** read like
  the node-graph board — light-grey text on a transparent background, pushed
  **outward** from the edge each pin sits on (turned 90° on the top/bottom edges so
  dense rows don't overlap). A contextual inspector edits
  the selected object (pin number / GPIO name / type pwr·gnd·io / IO capabilities
  digital·pwm·adc·spi·i2c), **board dimensions** are fields (and **reshape the
  PCB** live), with **Details at the top** of the panel. The view control
  (bottom-right of the canvas) carries zoom + the **grid / snap** toggles (the
  grid draws at the pin spacing); the image layer has a **Lock aspect ratio**
  toggle so the photo isn't stretched; and **clicking a polygon vertex deletes
  it** (drag still moves it; ≥ 3 points kept). The YAML round-trips, so a saved
  part re-opens unchanged. The Parts Library + Part Editor live in the **Board
  Viewer** window (open the board view, then the **chip** button in its title
  bar) — the only place that uses them; parts you create go to your own **My
  Parts** library (listed first, badged
  *Your library*, and shown as the editor's "Saved to" target). See
  `docs/part-editor.md`. (Image **crop** + magic-wand background removal are the
  next pass.)
- **Board/part images render under the locked-down CSP.** Added `img-src 'self'
  data:` to the renderer Content-Security-Policy so `data:`-URL images (the Part
  Editor's board photo and the Board View's uploaded board image) actually paint —
  previously they were silently blocked by the `default-src 'self'` fallback.

### Changed
- **Part Editor: PCB and image toggle independently; board layers moved down.** The
  **PCB body** (outline + fill) now has its **own show/hide toggle, separate from the
  board photo** — so a board-less part (e.g. a motor) can hide the PCB while keeping
  an image, or vice versa (persisted with the part). The **Mounting holes / PCB /
  Image** sections now sit **below the selected-item details** in the right panel, so
  pin editing stays near the top.
- **The Board View is a normal window** now (no longer always-on-top), so it can
  sit behind the editor like any other window.
- **Schematic symbols are balanced & roomier.** Signal pins now split **evenly
  across the left and right sides** of the IC block (instead of piling into one tall
  column), and pin rows use a generous per-pin pitch (the built-in Pico is the
  guide) so labels on the top/bottom rows no longer overlap.
- **Pin labels match the node-graph board everywhere.** In the Breadboard view and
  the Part Editor, pin labels are now light-grey silk text on a transparent
  background, pushed **outward** from the board edge a pin sits on; labels on
  top/bottom-edge pins are turned 90° (never upside-down) so the board title stays
  legible above them.

### Fixed
- **Pin labels always render outside the part.** A pin set in from the board edge
  used to print its silk label over the artwork; labels are now pushed out to the
  board-box edge the pin's **rotation** points to (right/left/top/bottom), keeping
  the perpendicular coordinate at the pin so it still lines up with its row/column.
  Applies in both the Part Editor canvas and the read-only board/preview renderer.
- **"+ board" no longer silently overwrites an existing board.** The new-board
  starter is now treated as a genuinely new part, so the Part Editor's duplicate-id
  guard warns before overwriting (it had been disabled by the pre-seeded id).
- **Schematic view: one terminal per rail, no stray pin circles.** A placed part's
  (or the MCU's) multiple grounds and same-label power pads now collapse to a single
  schematic terminal (they stay individual in Breadboard), and pins draw as plain
  stubs — a circle on a pin means logic inversion, not a connection — so connections
  are just where a wire meets the stub.
- **Board View close button no longer clips when the window is narrowed.** The
  title bar's right-docked controls (ending in the close ✕) are pinned and the
  middle items now shrink/truncate, and the Board View window has a sensible
  minimum size — so the close button is always reachable.

## [0.14.0] - 2026-06-24

### Added
- **Buy me a coffee (#126).** A subtle `☕` link in the status bar opens the
  project's Buy Me a Coffee page; on your first launch a small, dismissible nudge
  appears beside it after a couple of seconds (shown once, never nags again).
- **I²C display (SSD1306) actually drives the panel.** The I²C display instrument
  gained **SDA + SCL pin dropdowns** and an address picker (you couldn't pick the
  pins before), with a **warning when the pins aren't a valid RP2040 I²C pair**
  (I2C0 = GP0/1, 4/5, …; I2C1 = GP2/3, 6/7, …). The board now has a real SSD1306
  driver (`inst.display`, bundled or the `ssd1306` module) so pushing text from
  the panel shows on the screen; plus the buzzer-style live retarget, code-sync
  ("Update code"), and a "Run display demo". (Library 0.5.0.)
- **Ultrasonic rangefinder (HC-SR04) for the Range instrument.** A real on-device
  driver (`inst.ranger`) triggers the sensor and times the echo into a distance,
  and the Range panel gains **TRIG + ECHO pin dropdowns** that retarget the board
  live (`SNKCMD range pins …`), a **code-mismatch warning with one-click "Update
  code"** (matching the buzzer), and a "Run range demo" fallback — the radar/gauge
  then fills from the live readings. The Board View also surfaces a sensor's
  `*_trig`/`*_echo` pins. (Library 0.4.3.)
- **Online ESP32 firmware in the flasher (#125).** The firmware flasher's
  "Download from MicroPython.org" source now covers **ESP32** boards too (it was
  RP2040/UF2-only). Pick the family / model / variant / version from Thonny's
  curated esptool catalog and Snakie downloads the `.bin` and flashes it via
  esptool at the right per-chip offset (`0x1000` for the classic ESP32, `0x0` for
  the S/C/P series and ESP8266) — the same cascade the Pico UF2 source uses.
- **Buzzer "Paste to code" + pin-mismatch warning.** The Buzzer instrument can now
  **paste the melody you built into your program** — as a `melody = [(freq, ms), …]`
  array with a runnable plain-MicroPython player and a commented Snakie-library
  one-liner (so it works with or without the library). And when the panel's pin
  differs from a `buzzer_pin = …` declared in your open code, a small warning
  offers a one-click **update code to match** (the dial already retargets the
  running board live).
- **Board View shows instrument-library pins.** A pin handed to the instrument
  library — e.g. `inst.start(buzzer_pin=15)` — is now surfaced in the Board View
  (an amber "instrument" pin), so you can see at a glance that a pin is in use by
  an instrument, not just by a direct `Pin(...)`.
- **Resizable file-panel split (#124).** The boundary between the **Local files**
  and **Device files** trees is now a draggable splitter — drag it to give the
  device files more room (they used to be capped at a fixed fraction of the
  height). The split position is remembered across sessions.
- **One-click library updates.** The instrument library now carries a
  `__version__`, and the install banner detects when the copy on your board is
  **older than the one Snakie bundles** — offering **Update library** (previously
  it only noticed a *missing* library, so a board with an out-of-date copy silently
  ran old code). This is how you pick up new device features like the buzzer
  receiver and scanners.
- **Background service on the second core + smarter scanning.** The `snakie`
  library gained `inst.start()`, which runs the control channel and the built-in
  scan triggers (`scan:wifi` / `scan:bt` / `scan:i2c`) **on the board's second
  core** (`_thread`), so a robot's main loop stays responsive while the IDE drives
  a scan, and announces itself to the IDE with a `SNK READY` heartbeat. The
  **Wi-Fi scan** panel now uses that: when a Snakie program is running it drives
  the scan directly; when none is, SCAN offers to **open + run a Wi-Fi demo** in a
  new tab (stopping any running program first) instead of doing nothing.
- **Buzzer plays on the real board + an editable melody and a staff.** The Buzzer
  instrument now actually drives a connected speaker: a device-side `buzzer`
  receiver (`tone` / `seq` / `stop` / `pin`), wired by `inst.start(buzzer_pin=…)`
  and played on the second core, with a one-click **buzzer demo** when no program
  is running. The melody row is now editable — **drag notes to reorder, click to
  remove, and insert rests** — and a new **musical-staff row** shows the melody
  and highlights the playing note when you press Play.
- **Dock-to-side on every instrument.** All the new dock instruments (Wi-Fi scan,
  Button, IMU, buzzer, …) now have an **undock key** in their title bar and float
  freely over the window, like the oscilloscope and multimeter already did.
- **Robotics instrument dock (#119).** The instrument dock grew from 3 to a full
  set of instruments, organised so it stays usable: icon-only toggles grouped into
  **Inputs** and **Outputs**, an **in-use vs available** distinction (instruments
  your code declares are surfaced prominently), and an **“＋ Add instrument”
  palette** so every instrument is reachable in a couple of clicks without
  crowding the header. A single registry drives the dock, the toggles and the
  palette.
- **Bidirectional control channel + library toolkit (#115, #116).** Alongside the
  read-only `SNK …` telemetry (#107), the IDE can now **write** to a running
  program over a compact `SNKCMD …` control line (`device.sendControl`). The
  `micropython/instruments.py` library gained matching emitters (IMU, distance,
  button, encoder, screen) and scanners (I²C / Wi-Fi / Bluetooth) plus receivers
  (`teleop`, `buzzer`, `led`, `screen`) and a non-blocking `control` poll helper —
  the foundation the panels below build on.
- **Teleop / gamepad panel (#110).** Drive a robot live from a USB/Bluetooth
  **gamepad** (or on-screen sticks/sliders), with a mapping editor
  (scale / deadzone / invert / trim per output) and safety: a **deadman**
  (hold-to-drive), a big **E-STOP**, and connection-loss → stop.
- **IMU 3D orientation viewer (#111).** A live 3-D model rotates from roll/pitch/yaw
  or a quaternion, with body axes, a horizon/level indicator and numeric RPY
  (lightweight CSS-3D — no new dependencies).
- **Distance-sensor radar (#112).** A range gauge + rolling history for a fixed
  sensor, and a polar **radar sweep** (distance vs angle, fading trails) for a
  servo-swept one — with units, max-range and a proximity-alert threshold.
- **Buzzer / music player (#113).** A piano keyboard, a melody sequencer and
  **RTTTL** ringtone playback for a PWM buzzer, with tempo/volume, a Stop, and
  export to runnable MicroPython.
- **Button & LED panels (#114).** Watch input pins (pressed/released + edge
  counters) and drive outputs from the UI — digital, **PWM brightness**, an **RGB**
  colour picker, and a **NeoPixel/WS2812** strip.
- **Rotary encoder panel (#117).** A knurled dial turns live to the encoder count,
  with direction (CW/CCW), optional RPM and the push-switch state.
- **I²C display mirror & output (#118).** A skeuomorphic OLED/LCD module that
  **mirrors** the device’s framebuffer/text live, or lets you **push** text to the
  real display — SSD1306 / SH1106 and HD44780 character LCDs.
- **Scanner instruments (#121).** On-demand **I²C detect** (the classic 8×16
  address grid), **Wi-Fi scan** (signal-bar network list) and **Bluetooth scan**
  (BLE device list), each triggered by a SCAN button over the control channel.
- **Modular per-component module installs (#120).** A **Modules** manager (in the
  Packages view) installs only the device drivers a robot actually uses
  (ssd1306/sh1106, hcsr04/vl53l0x, mpu6050/bno055/lsm6ds, neopixel, …), mapped to
  the instrument each one powers, with installed-vs-available state.
- **File-panel buttons (#104, #105).** Refresh buttons on both the local and device
  file trees, a **new-folder** button on the device tree, and the upload/download
  transfer controls reduced to clear icon-only buttons.

### Changed
- **More accurate board representations (#109).** The built-in board pinouts were
  redrawn to match the real boards: the **Pimoroni Tiny 2040 / 2350** now have their
  pins running **vertically** (left/right edges), the USB connector / MCU / Wi-Fi /
  onboard-LED features sit at their real positions, the **noodle wires are shorter**
  so the pin labels sit close to the board, and pad labels are placed on the correct
  side (left-edge pads labelled left, right-edge labelled right). Pinouts are
  best-effort from documented sources — verify against the datasheets if precision
  matters.

### Fixed
- **The Bluetooth scanner actually scans.** `bt_scan()` was a stub that returned
  nothing, so the panel's SCAN did nothing. It now runs a real active BLE
  `gap_scan` (IRQ-collected, names decoded from the advertising data) and emits
  each device, so the Bluetooth instrument lists nearby devices like the Wi-Fi
  one does. (Library 0.4.2.)
- **Buzzer tempo / octave / volume are now live, and reach the speaker.** The
  VOLUME slider now sets the board's PWM **duty** (a `vol` control command) — not
  just the IDE preview — and OCTAVE (transpose) + TEMPO (time-scale) are applied
  at **playback** so they change an already-built melody on both the IDE preview
  and the device. ▶ Play also re-targets the selected pin + volume before sending
  the notes. (Library 0.4.1.)
- **Board View shows a pin the instrument library uses even via a constant.** It
  now detects `BUZZER_PIN = 0` (and any `*_PIN = <int>`) that a program passes to
  `inst.start(...)` by name — the demo pattern — not only literal kwargs.
- **The buzzer plays reliably and the board no longer wedges.** The control
  channel now runs on the **main loop** (`inst.control.poll()`), not a second-core
  thread — the old `_thread` polled `stdin` with a blocking 64-byte read that could
  hang core 1 and wedge the Pico on Stop/soft-reset (needing a replug). `poll()`
  reads one byte at a time (never blocks) and emits the `SNK READY` heartbeat, and
  `start()` defaults to main-loop polling (the second-core mode is now an
  experimental opt-in). The Buzzer panel's ▶ Play always sounds the **local
  preview** even when no board program is running, "Run buzzer demo" uses the
  pin you've selected, and the demos poll + stop cleanly. Library bumped to 0.4.0.
- **Instrument panels no longer spam the REPL or leave a thread running.** The
  panels now only write `SNKCMD` control lines when a Snakie program is actually
  running and servicing the channel — previously the buzzer keyboard / STOP / pin
  controls and the presence probe could write to a bare REPL, which echoed back as
  a stream of `SyntaxError`s. The bundled demos now stop the **second-core service
  cleanly** when you press Stop (`inst.stop()` on `KeyboardInterrupt`), and
  `inst.stop()` silences the buzzer and aborts an in-progress melody.

## [0.13.0] - 2026-06-23

### Added
- **One-click install of the instruments library (#108).** When you open the
  instruments and a connected board doesn't already have `instruments.py`, a manila
  banner appears at the top offering **Download & install** — it writes the library
  to `/lib/instruments.py` on the device. The banner is closable but reappears if
  you close and reopen the instrument panel, and never shows once the library is
  installed (the check is cached per connection).

## [0.12.0] - 2026-06-23

### Added
- **MicroPython instruments library + live telemetry (#107).** A new
  `micropython/instruments.py` lets a running program emit readings with simple
  commands — `scope(value)`, `meter(value)`, `plot(temp=21.4, …)`, plus
  `read_adc(adc)` / `read_pwm(pwm)` convenience. The IDE parses these printed
  readings **passively from the serial stream**, so the Oscilloscope (live sampled
  waveform), Multimeter (value + min/max/avg) and Plotter update **inside a running
  loop with no REPL interruption** — the telemetry lines are hidden from the console.
  See `docs/instruments-library.md`. (The REPL-poll LIVE toggle remains the fallback
  for programs that don't print telemetry.)

## [0.11.0] - 2026-06-21

### Changed
- **Instruments now live in the main window.** The Oscilloscope, Multimeter and
  Plotter moved out of the Board View window into the main editor window. They open
  as **draggable windows that float above the whole window**, or dock into an
  **INSTRUMENT DOCK** rail to the right of the chat panel — toggled by an
  **Instruments** button in the toolbar (grouped with the panel toggles, in panel
  order). The dock header's **SCOPE / METER / PLOT** buttons summon and show/hide
  each instrument; opening a scope/meter from a Board-View PWM/ADC node also docks
  it there, and closing one hides it back into the dock. The Plotter moved from the
  shell into the dock (the shell is now Console / Problems). The dock is independent
  of the chat panel.
- **Stop button doubles as Reset.** Pressing Stop interrupts a running program
  (Ctrl-C), or — when nothing is running — soft-resets the board (Ctrl-D); the
  button shows **Stop** or **Reset** accordingly.

### Added
- **Instrument LIVE toggle.** The Oscilloscope and Multimeter have a **LIVE** toggle
  (default **off**) that gates device polling, so opening an instrument no longer
  interrupts a running program by surprise — they show static/parsed readings until
  you turn LIVE on, at which point the **status bar warns** that polling is
  interrupting the board and offers a one-click **Stop**.

### Fixed
- **Console no longer shows internal probe traffic.** Live-value polling runs over
  the raw REPL; that machine traffic (`<<SNKV>>…` probes, raw-REPL banners and
  interrupts) is no longer broadcast to the terminal — your typing and Run output
  still stream through.

## [0.10.0] - 2026-06-20

### Added
- **Plotter alongside the console (#103).** The serial Plotter is now a toggle in
  the Shell header that splits the dock to show the live chart **next to** the
  console (instead of replacing it), reskinned as a skeuomorphic blue-phosphor
  strip-chart — scrolling traces with a live-edge cursor, a series legend, a
  `samples · Hz` readout and a single CLEAR key.
- **Oscilloscope instrument (#101).** PWM nodes in the Board View gain a scope
  launcher that opens a skeuomorphic CRT oscilloscope rendering the pin's square
  wave from its frequency + duty (FREQ / DUTY / PERIOD readouts, live duty when
  connected). Opens docked beside the board on wide windows, overlaid on narrow.
- **Multimeter instrument (#102).** ADC pins (`ADC(Pin(26))` …, a new parsed type)
  gain a meter launcher that opens a skeuomorphic handheld DMM showing the live
  voltage on a 7-segment display, with raw count, a 0–3.3 V bargraph and MIN/MAX/AVG.
- **Board View live pin values (#97).** A **LIVE** toggle in the board view header
  (off by default) reads the connected board over the REPL and shows each node's
  real value — `1`/`0` for digital (green when asserted), PWM duty, and an activity
  indicator for I²C/SPI/PIO — falling back to idle when disconnected. It is opt-in
  because reading values interrupts a running program.
- **Board View viewport controls (#99).** A floating control cluster on the board
  canvas: **zoom in / out**, **zoom to fit**, a **100%** button that toggles between
  fit and 1:1, and **export** of the current view as **SVG, PNG or PDF**.
- **Board View rotate (#96).** A rotate button cycles the board view 90° clockwise;
  pad/label text always stays legible (rendered at 0° or 90° CW, never upside down),
  so a header that becomes horizontal reads correctly.

### Fixed
- **Board View draws the full physical pinout.** The board view now renders the
  selected board's complete pinout (every pad from its definition, at its real
  edge position) and redraws when you switch board type — previously it only drew
  the pins in use and barely changed on a board switch. Connections wire to their
  actual pads. (Shared board-layout extracted to one tested module.)
- **Find & Replace draggable by the whole title bar (#98).** The dialog can be
  dragged from anywhere along its top row, not just the textured grip.

### Changed
- **Board View node-graph.** The live Board View is redesigned as a **node graph**:
  one node per declared connection — a colour-coded type tag (`IN`/`OUT`/`I²C`/
  `PWM`/`SPI`/`PIO`) inline beside the variable, with a value readout — each wired
  by a drooping cable to its GPIO pad on the board's left edge, aligned row-for-row.
  The `PINS IN USE` table moves below it. (Node values are placeholders for now;
  live device values are tracked in #97.) The Board Creator's preview is unchanged.

## [0.9.0] - 2026-06-20

### Fixed
- **Board View now shows on open.** A freshly-opened Board View window could stay
  blank when a program with `Pin` assignments was already loaded — the active-file
  snapshot was relayed before the window had subscribed to it, so nothing drew.
  The window now pulls the latest snapshot on mount (and still updates live as you
  edit).
- **Editor sticky scroll disabled.** The pinned scope/function header that stuck to
  the top of the editor overlapped and clashed with the code beneath it, so it is
  now turned off.
- **Find & Replace dialog (#95).** Replace is now reachable from find-only mode
  via a chevron that reveals/hides the Replace row (previously it only appeared
  when opened with Cmd/Ctrl-H), removed the duplicate prev/next controls (the
  Up/Down direction radio + extra Find button that duplicated the ↑/↓ arrows), and
  kept a clear ✕ close button in the title bar.

### Changed
- **Toolbar layout.** The Settings, Board View and light/dark-mode knobs now sit
  beside the Run/Stop buttons; the Files/Shell/Chat panel-collapse knobs stay
  aligned to the right.
- **Board View v2.** The Board View is now its own **floating window** (a real
  always-on-top window fed the active file live over IPC) instead of a modal
  dialog, and it labels each wired pin by **connection type** — `output`, `input`,
  `pwm`, `i2c`, `spi` or `pio` — instead of guessing a peripheral. `Pin` direction
  is read from `Pin.OUT`/`Pin.IN` (and inferred from `.on()`/`.value()` usage when
  undirected). It is now **multi-board**: a selector switches between built-in
  definitions for the Raspberry Pi Pico 2 W, ESP32 DevKit, Pimoroni Pico Plus 2,
  Tiny 2040 and Tiny 2350, drawn from a generic, data-driven renderer.

### Added
- **Board Creator (#94).** A visual editor for custom boards, entered from a brass
  knob button in the Board View: set the board name, chip type, PCB colour and
  aspect; lay out pin headers along any edge (or single pins), each pad assigned a
  GPIO, name and type (`gpio`/`gnd`/`vcc`/`other`, with power pads drawn
  distinctly); pick an onboard LED; and represent the board with either an uploaded
  image or drawn rectangle features — saved as a round-trippable `BoardDefinition`
  JSON (with a one-way "Export SVG" convenience). Boards are saved to / loaded from
  / deleted in `<userData>/boards/` and become selectable in the Board View.
- **Custom board definitions.** Drop a `BoardDefinition` JSON file into
  `<userData>/boards/` to add your own board to the Board View (a user board
  overrides a built-in with the same `id`); an in-view button opens that folder.
  See `docs/board.md` for the schema and a worked example.

## [0.8.0] - 2026-06-20

### Added
- **Board View popup.** A new editor pop-up that parses the active Python file for
  pin usage (`Pin`, `PWM`, `I2C`, `SPI`, `StateMachine`) and draws a Raspberry Pi
  Pico 2 W / RP2350 board with colour-coded wires from each used GPIO to a
  representative peripheral (LED, SG90 servo, BME280, WS2812, ST7789), plus a
  "pins in use" table listing the bus, pins, variable and constructor. Opens from a
  **Board** button in the toolbar and re-wires live as you edit.

### Changed
- **Packages panel — manila-tag skin (Skeuomorph).** The package manager is
  reskinned as kraft manila tags on green felt (kraft spine, eyelet, version
  rubber-stamp, INSTALL gold key / INSTALLED green stamp), with a live **flash
  usage** readout + meter sourced from the device's `os.statvfs('/')` when
  connected. Search/install behaviour is unchanged.
- **Plugins panel — module-rack skin (Skeuomorph).** The Plugins view is reskinned
  as a eurorack module rack — brushed faceplates with mounting rails, hex screws,
  per-module accent stripe, knob/LED/patch-jack — where **mounted** modules are
  plugins that loaded OK (click to patch in and run their commands) and
  **available** modules are ones that failed to load (gold **GET** retries the
  load). All plugin actions are preserved.
- **Find & Replace polish (Skeuomorph).** The Find & Replace panel (#92) becomes a
  draggable brushed-aluminium floating dialog with **whole-word** and **regex**
  toggles (invalid patterns are guarded, not thrown) and an **N of M matches**
  counter. All existing find/replace behaviour and shortcuts are unchanged.

## [0.7.0] - 2026-06-20

### Added
- **Find & Replace (#92).** A panel for the editor with a **Find** and a
  **Replace with** box, a **case-sensitive** toggle, an **Up/Down** search
  direction (Down by default), and **Find / Replace / Replace+Find / Replace all**
  buttons (Replace-all is a single undo step). Opens with ⌘/Ctrl-F (find) or
  ⌘/Ctrl-H (replace), plus a toolbar button; Esc closes.
- **YAML / JSON validation (#93).** `.json`, `.yml` and `.yaml` files are
  validated as you edit — invalid formats get squiggles and Problems-panel entries
  with the line/column and reason, plus an **autofix** (format/prettify, and
  best-effort JSON comment + trailing-comma repair) offered as a lightbulb
  quick-fix and a Fix/Format button.

### Changed
- **Dark mode is now a dark Skeuomorph (#91).** Toggling to dark gives a cohesive
  dark version of the default skin — dark brushed-metal chrome, brass knobs,
  glossy dark Run/Stop pills, dark green-felt Source Control, a deep-slate
  ruled-paper editor, the recessed green-phosphor console, and a dark metal status
  bar — instead of the old flat NES dark theme. The ruled-paper settings and the
  light⇄dark toggle are unchanged.

## [0.6.3] - 2026-06-19

### Fixed
- **First signed + notarized macOS release.** Getting macOS signing to actually
  run took fixing three release-workflow problems: `CSC_IDENTITY_AUTO_DISCOVERY=false`
  was a kill-switch that *disabled* signing (so signed builds shipped unsigned);
  the signing env leaked into the Windows job (signing the `.exe` with the macOS
  cert, then failing when scoped to an empty string); and notarization needs the
  Apple Team ID, now set in `electron-builder.yml`. The macOS build is now signed
  (Developer ID Application) **and** notarized, so the in-app updater can install
  on macOS (Squirrel.Mac validates the signature) and Gatekeeper no longer flags
  the app as "damaged". No functional changes since 0.6.0. (0.6.1 and 0.6.2 were
  superseded build attempts.)

## [0.6.0] - 2026-06-19

### Added
- **MicroPython firmware catalog in the flash dialog (#64).** The firmware
  flasher can now pull the UF2 firmware catalog (Thonny's curated MicroPython
  list) in the main process and present a **Family → Model → Variant → Version**
  cascade. **Download & Flash** streams the chosen `.uf2` to a temp file and
  flashes it with a live **% progress bar** and a **Done** button. The local-file
  Browse and the ESP/esptool paths are unchanged.
- **Check for Updates (#89).** A native **Check for Updates…** menu item (in the
  app menu on macOS, a Help menu on Windows/Linux) plus a clickable **status-bar
  version** both run the same manual GitHub update check — prompting to download
  when a newer release exists, reporting "up to date" otherwise, and noting that
  updates only apply to installed builds when run unpackaged.
- **Docstrings in the outline (#88).** Hovering a function or class in the
  outline / function inspector now shows its docstring as a tooltip.

### Changed
- **Simplified the local Files panel (#87).** New File / New Folder are now
  icon-only; Rename and Delete moved into the right-click menu; and the Open
  Folder button is replaced by a clickable **path breadcrumb** where each
  ancestor segment re-roots the tree.

### Fixed
- **Update errors stay contained (#90).** A long update/install error (e.g. the
  macOS code-signature validation failure) now wraps inside its box with a short,
  friendly summary (full text on hover) instead of overflowing the notifier and
  status bar, and offers a **Download manually** button to the GitHub releases
  page. (The signature failure itself still requires a properly signed +
  notarized release — see `docs/macos-signing.md`.)

## [0.5.0] - 2026-06-19

### Added
- **In-app LLM provider system (#77).** The Claude chat is now provider-agnostic:
  a main-process registry adds **OpenAI, Google Gemini, Grok (xAI) and GitHub
  Copilot** alongside Anthropic Claude, surfaced as provider / model / effort
  dropdowns at the bottom of the chat with secure per-provider API-key storage.
  Only Anthropic is verified locally; the others are wired to spec and untested
  without credentials.
- **Send console output to chat (#78).** A **Send to chat** button above the
  console (shown when the chat panel is open) plus an **Attach console (since
  last Run)** composer toggle hand the device's REPL output to the assistant
  without copy-paste.
- **AI-first editor (#82).** The chat always sees the up-to-date active file;
  assistant code blocks gain an **Apply** button that writes straight into the
  editor (undoable); and an opt-in **inline autocomplete** (ghost text) suggests
  as you type via a fast, per-provider completion model configured separately
  from the main chat model.
- **GitHub Copilot sign-in.** The Copilot provider authenticates with a GitHub
  **OAuth device-flow** sign-in (approve a code at github.com/login/device) on an
  account with an active Copilot subscription — Snakie exchanges the resulting
  GitHub token for the short-lived Copilot token its chat endpoint requires
  (cached until expiry). A plain personal access token can't reach that endpoint,
  so sign-in is used instead. Experimental — verifiable only against a real
  Copilot account.
- **Editor paper settings (#80, #81).** A new **Settings** dialog (toolbar gear)
  toggles the notebook **ruled lines**, a subtle squared **dots** grid, or
  **off**, and adjusts the **line spacing** (shown live) — persisted across
  launches.
- **Syntax highlighting + editor themes (#84).** Richer Monaco highlighting
  (keywords, strings, numbers, comments and types in distinct colours), a whiter
  off-white paper so the colours read clearly, and an **editor theme** selector
  (Paper / Bright / Midnight) in the Settings → Editor tab, backed by an
  extensible theme table.
- **Tabbed Settings dialog + Chat settings (#83).** The Settings dialog now has
  **Editor** and **Chat** tabs; the chat's title bar is gone and its per-provider
  API keys, the GitHub Copilot sign-in, and the autocomplete settings moved into
  the **Chat** tab (the chat's ⚙ opens it directly).
- **macOS code signing + notarization** wired into the release workflow (#47).
  When the Apple secrets are set (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — see
  `docs/macos-signing.md`), releases are signed (Developer ID, hardened runtime
  + entitlements) and notarized — which is what lets the **in-app updater
  install on macOS** and removes the "damaged" Gatekeeper warning. Builds stay
  unsigned-but-working when the secrets are absent.

### Changed
- **Skeuomorph skin is the new default look.** A photoreal brushed-metal /
  green-felt / cream **ruled-paper** theme: a segmented New/Open/Save control,
  glossy Run/Stop pills, round panel-collapse knobs, a recessed green-phosphor
  console, and a notebook editor whose text sits on ruled lines (transparent
  Monaco over a ruled gradient, with a red margin rule). The toolbar knob flips
  to a dark "lights out" theme.
- **Removed the redundant panel title bars** for Editor, Source Control, Files,
  Packages, Plugins and Inspect (#79) — the activity bar already names the active
  view (Shell and Chat keep their headers, which carry controls).
- **Activity-bar buttons toggle the left panel (#86).** Clicking a view button
  switches to / expands it; clicking the already-active one collapses the left
  panel (click again to re-expand), matching the familiar editor behaviour.

### Fixed
- **Toolbars no longer clip at narrow widths (#85).** The shell-panel header
  controls (Console/Plotter/Problems, Clear, port + connect/disconnect) and the
  device/local file-tree action buttons now wrap instead of being hidden under
  the chat panel when space is tight.

## [0.3.3] - 2026-06-02

### Fixed
- **macOS auto-update (cont.):** the v0.3.2 mac `.zip` was built but not uploaded
  to the release (the CI artifact glob matched `*.blockmap` but not `*.zip`), so
  `latest-mac.yml` referenced a missing file. Upload `dist/*.zip` too.

## [0.3.2] - 2026-06-02

### Fixed
- **macOS auto-update** failed with "ZIP file not provided" — electron-updater
  on macOS downloads a `.zip`, but the mac target only built a `.dmg`. Added a
  `zip` mac target so `latest-mac.yml` references an updatable artifact. (Note:
  the *install* step still needs a signed app on macOS — see #47.)

## [0.3.1] - 2026-06-02

### Added
- Publish a **Linux arm64 AppImage** (built natively), so Raspberry Pi / arm64
  installs can receive in-app updates (#74). (Patch release.)

## [0.3.0] - 2026-06-02

### Added
- **Update notifications + status-bar update button (#74).** When a newer
  release is available the status bar shows an **Update to vX** button (in the
  version slot) — click to **download**, watch progress, then **Restart to
  update** (electron-updater, `autoDownload` off so it's user-initiated); a
  dismissible banner also offers Download. Adds `window.api.updates.download()`
  and an hourly re-check.
- **Python plugin system (MVP, #61).** Snakie spawns the user's `python3` running
  a host that discovers and loads Python plugins and talks to the app over
  JSON-RPC. Plugins use a stdlib-only `snakie` SDK (`@plugin.command`, `Context`,
  `message`/`edit` helpers); discovery from `~/.snakie/plugins/` (+ bundled
  examples and entry points). New **Plugins** activity-bar view lists plugins and
  runs their commands against the active file; graceful "Python not found" state.
  Ships an example plugin + `docs/writing-plugins.md` (design: `docs/plugin-system.md`).
- **Reactive plugins + editor decorations (#69).** Plugins can register a
  `@plugin.linter` that runs automatically as you type (debounced) and on open,
  drawing **squiggle underlines** (Monaco markers) and offering **lightbulb
  quick-fixes** (a Monaco code-action provider applies the plugin's edit). Adds a
  `lint` RPC / `window.api.plugins.lint`, diagnostics with optional ranged
  `fixes`, and an example linter (flags trailing whitespace + TODOs).
- **Python linter plugin (#65).** A bundled `python_linter` plugin runs **ruff**
  (with autofix quick-fixes) or falls back to **pyflakes**, linting `.py` files
  live via the reactive engine. New **Problems** tab in the shell panel (count
  badge, click-to-jump) backed by a shared diagnostics store, and a persisted
  **Lint on/off** toggle. Graceful when no linter is installed (`pip install ruff`).
- **Toolbar file actions:** New File, Open Folder and Save icon buttons (left of
  Run). Save also works via Ctrl/Cmd-S, with a native **Save As** dialog for
  untitled buffers. The opened folder is now the app's shared working directory,
  so both the toolbar and the Files panel drive it.

### Fixed
- **Source Control now follows the open working folder.** It was always showing
  "Open a folder to manage it with Git" even after a folder was chosen in Files;
  it now points the Git service at the shared `currentFolder` (auto `openRepo` +
  status) and its "Open Folder" buttons drive the same shared action.
- **File operations did nothing in Electron.** New File / New Folder / Rename
  (in both file trees) and the "Upload to board" path used `window.prompt`,
  which Electron's renderer doesn't implement — replaced with an in-app prompt
  modal so they work.
- **Critical: `window.api` preload bridge never loaded in the real Electron
  app** (only the browser preview "worked"), so Open Folder, package search, the
  serial port list and all device features did nothing. Two causes, both fixed:
  the preload was emitted as `index.js` but `package.json` is `"type": "module"`,
  so Electron's `require()` failed with `ERR_REQUIRE_ESM` — now emitted/loaded as
  `index.cjs`; and `sandbox: true` blocked the CommonJS preload from
  `require()`-ing `@electron-toolkit/preload` — now `sandbox: false`
  (`contextIsolation` + `nodeIntegration: false` kept). The renderer fallback
  also now logs a loud error if the bridge is missing inside Electron rather than
  silently masking it.
- **Editor matched the app theme:** the Monaco editor no longer shows a light
  background in dark mode. It reads the app's `data-theme` (via a MutationObserver,
  so it can't desync) and uses a custom dark theme whose background matches the
  NES palette (`#14141f`).
- Removed the duplicated "Device files" heading in the device panel's
  empty state (the section header already names it).

### Changed
- **Retro 8-bit UI overhaul.** New look & feel: NES-inspired dark theme
  (slate + blue/red/green/yellow accents), a single readable **JetBrains Mono**
  font across the whole UI, square corners and chunky pixel buttons — the 8-bit
  feel comes from the palette/buttons/borders, not the font. Dark is the default.
- **Left activity bar + view switching.** A vertical icon strip on the far
  left switches the left sidebar between **Files**, **Source Control**,
  **Packages**, **Inspect** (Outline + Variables in a vertical split), and
  **Help**. Source Control / Packages / Outline / Variables / Help moved out of
  the right pane. The center editor is unchanged.
- **Right pane is now Chat-only**; the toolbar toggle is relabelled
  "Panel" → "Chat". Toolbar Run/Stop/Flash and the shell Clear button are
  sized consistently with the other toolbar buttons.

## [0.2.0] - 2026-06-01

### Added
- Drafted a placeholder Snakie app logo — a snake coiled into an "S" on a green
  squircle (`build/icon.png`, editable source `build/icon.svg`). (#46)
- Build target added: macOS Intel (x64) dmg, alongside the existing macOS
  arm64, Linux x64 and Windows x64 installers. (#49) (Linux arm64 was attempted
  but deferred — see #53 — due to electron-builder's x86 `fpm`/`-m64` issues.)
- Unit tests (vitest) for the pure parsing logic — code outline, device
  variables, and serial-plotter line parsing (39 tests); `npm test` and a CI
  test step. Plus `docs/hardware-test-plan.md`, a manual on-device checklist.
  (toward #45)

### Changed
- Renderer startup payload cut ~88% (~7.4 MB → ~0.9 MB): Monaco is now
  code-split and lazy-loaded only when a file is opened, and the unused JSON
  language service was dropped (`.json` opens as plain text). (#48)

### Fixed
- Renderer no longer blank-screens when the Electron preload bridge
  (`window.api` / `window.electron`) is unavailable — e.g. a browser preview or
  a failed preload. A no-op fallback bridge is installed before render so the UI
  degrades gracefully to a "disconnected / empty" state (with a console
  warning). No effect inside Electron, where the real bridge is present.

## [0.1.0] - 2026-06-01

First public build — a cross-platform (Windows / macOS / Linux) Electron
MicroPython editor.

### Added
- **Editor:** Monaco editor with Python syntax, MicroPython-aware autocomplete,
  tabbed multi-file editing (with a `+` new-tab button), and Ctrl/Cmd-S save.
- **Files:** local and on-device file browsers with right-click context menus;
  create / rename / delete on both; upload-to-board / download-to-computer
  controls between the panes.
- **Device:** serial connection layer speaking the MicroPython raw-REPL
  protocol; interactive xterm REPL with connect / port-select / status; Run,
  Stop and Clear-shell controls; a serial plotter for numeric console output.
- **Right pane (tabbed):** in-app Help & MicroPython reference, code Outline,
  device Variables inspector, Claude LLM chat, and a `mip`/PyPI package
  installer with discovery.
- **Tools:** in-app MicroPython firmware flashing (esptool for ESP, UF2 copy for
  RP2040); built-in Git source control (status / stage / commit / diff /
  branch / push / pull); update notifications via electron-updater.
- **Shell:** resizable, collapsible panels with a light/dark theme.
- **Packaging:** electron-builder installers (Windows NSIS, macOS dmg, Linux
  AppImage + deb) built and published to GitHub Releases by a tag-triggered CI
  workflow.

### Known limitations
- Device, serial, firmware and on-device package-install paths are
  build/type-verified but not yet validated against real hardware.
- The LLM chat requires an Anthropic API key; the package installer requires
  network access.
- Placeholder app icon; code signing not yet configured.

[Unreleased]: https://github.com/kevinmcaleer/Snakie/compare/v0.18.0...HEAD
[0.18.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/kevinmcaleer/Snakie/compare/v0.6.0...v0.6.3
[0.6.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.3...v0.5.0
[0.3.3]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kevinmcaleer/Snakie/releases/tag/v0.1.0
