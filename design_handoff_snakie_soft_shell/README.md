# Handoff: Snakie — "Soft Shell" IDE redesign

## Overview
Snakie is a robotics-first MicroPython IDE. This redesign gives its existing layout a **modern skeuomorphic** treatment — "Soft Shell": warm parchment surfaces, soft real depth (gentle shadows, rounded shells), a green primary accent and an amber/gold secondary accent, with tactile "instrument" controls (knobs, keyframe timeline, plotter). The goal was to make the app feel cohesive, characterful and fun without getting in the way of the work.

The app is organised into **three workspaces** selected from a segmented control in the top toolbar:
- **Code** — write MicroPython; pins are defined here.
- **Electronics** — the "Board View": wire components/sensors/motors to board pins; drivers auto-detected.
- **Build** — the 3D assembly space: URDF joints, IK chains, poses (previously the "Robot"/simulate view; renamed **Build** so it won't collide with the upcoming electronics *simulator*).

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behaviour, **not production code to copy directly**. They are authored as "Design Components" (a lightweight in-house HTML component format) and rely on a runtime (`support.js`) that is **not** part of your app.

Your task is to **recreate these designs in Snakie's existing front-end environment**, using its established framework, component library, state management and styling conventions. Treat the HTML/inline-styles as a spec for appearance and behaviour, not as source to port. `support.js` is included only so the prototypes open and run locally for reference; do not ship it.

## Fidelity
**High-fidelity.** Colours, typography, spacing, radii, shadows and interactions are intended as the target. Recreate pixel-closely using your codebase's primitives. Exact tokens are listed under **Design Tokens**. The one deliberate placeholder: the Raspberry Pi Pico in Electronics is a **stylised drawing** (the real app uses a board photo) and several toolbar/rail icons are Unicode-glyph stand-ins — swap in your real icon set and board asset.

## How to open the references
Open `Snakie Workspaces.dc.html` in a browser to see all three workspaces side-by-side, or `Snakie Soft Shell.dc.html` for a single interactive instance. The single file exposes two props/tweaks: `mode` (`code` | `elec` | `sim`) and `theme` (`light` | `dark`).

---

## Global chrome (persistent across all workspaces)

### Top toolbar (height 58px, `--panel` bg, 1px `--shellbd` bottom border, 16px horizontal padding, 14px gap)
Left → right:
- **Brand**: 30×30 rounded-9px green gradient tile (`#3fc686→#22935e`) with mark, + wordmark "Snakie" 17px/700 in `#2f9e63`.
- **File group**: a `--panel2` pill (radius 10, inset shadow) holding three 34×30 `--card` icon buttons — New, Open, Save.
- **Undo** button (34×34, `--card`, glyph `↶`) — sits immediately after the file group, left of Run.
- Vertical divider (1×28, `--shellbd`).
- **Run** (green gradient pill `#42b877→#2f9e63`, white 14/600, "▶ Run") and **Reset** (red gradient pill `#e06a54→#cf4a37`, "↺ Reset"), 9px gap.
- **Workspace switch** (`margin:0 auto`, centered): `--panel2` track, three segments Code / Electronics / Build. Active segment = **gold** gradient (`#f0dca6→#e7bf62`), text `--goldink` 700; inactive = `--txt3` 600.
- **Theme toggle** (34×34, `--panel2`, sun `☀` / moon `☾`).

> Note: the old standalone gold "electronics" toolbar button and a right-side refresh button were **removed** in the final design. Panel-collapse controls are **not** global (see below).

### Left icon rail (width 72px, always dark `#26281f`, regardless of theme)
Vertical stack, each item = 52px-wide rounded-12 column with a glyph + 9px label.
- Top: **Files** (active — raised `#3a3d30→#2c2f24` tile, gold `#e7bf62` icon), **Packages**, **Inspect**.
- Bottom (margin-top:auto): **Report**, **Learn**, **Help**, **Settings**. Inactive icons `#8f9184`.

### Status bar (height 34px, `--panel` bg, 1px `--shellbd` top border, 12px `--txt3` text)
Left: `● Simulated device · offline` (gold dot). Then muted tagline "Snakie also runs in your browser — installable, works offline, and talks to real boards over Web Serial." Right (margin-left:auto): `27 lines`, `Unsaved`, `v0.33.1`, and a green **⚡ Flash firmware** pill (`--greenpill`).

### Workspace container
Between rail and status bar. 14px padding, holds the active workspace. Only one workspace renders at a time (driven by `mode`).

---

## Screen: Code

**Purpose:** Author MicroPython; view console output; peek at board/3D; access instruments.

**Layout:** CSS grid, 3 columns, 14px gap, full height. Column template is dynamic:
`[files: 272px | 34px-when-collapsed]  [editor: 1fr]  [right column: 300px fixed]`.

### Files panel (left)
`--panel`, radius 16, soft shadow, column flex.
- Header row: "▤ LOCAL FILES" (11px/700 uppercase `--txt3`, letter-spacing .12em) + right-aligned icon cluster (↻, 🖹, 🗀) and a collapse chevron `‹`.
- Body: centered **Open Folder** green gradient pill.
- Divider row: up/down `--card` icon buttons (↑ ↓), centered.
- "▦ DEVICE FILES" header + icons (⇄, ↻).
- `▸ lib` tree row (IBM Plex Mono 13px).
- **Collapsed state:** column shrinks to 34px showing a vertical "Files" label + `›` reopen chevron.

### Editor + console (center) — flex column, 14px gap
**Editor card** (`flex:1`, `--editor` bg, radius 16, overflow hidden):
- **Tab bar** (`--panel` bg, 1px `--line` bottom): active tab "● untitled-1.py ✕" (gold status dot) on `--editor`; a `+` new-tab button; right-aligned "Find".
- **Code area** — *lined-paper* effect: `repeating-linear-gradient` giving a 28px line rhythm (`--editor` 27px then 1px `--line`). Left **gutter** (52px, right-aligned line numbers `--txt5`, `--gutter` bg, 2px `--kw` right border). Monospace 13.5px, line-height 28px. Syntax colours: keywords `--kw` bold, strings `--str`, numbers `--num`, comments `--com` italic, identifiers `--ident`. (Sample content is a quad-robot creep-gait script — 20 lines.)

**Console** (fixed 210px, collapsible):
- Header: Console/Problems segmented toggle (`--panel2` track, active `--card`), "✕ Clear", right-aligned "Simulated device (offline) ▾" dropdown chip, red **Disconnect** pill, and a collapse chevron `⌄`.
- Terminal: `--con` near-black bg, 1px `--conbd`, inset shadow, IBM Plex Mono 12.5px, text `#7fe0a8`. MicroPython banner + blinking `>>>` caret (1s step blink).
- **Collapsed state:** a 34px horizontal bar "⌃ Console  >>>".

### Right column (300px, fixed — flex column, 14px gap)
**Mini viewer** (top, fixed height): `--panel` card.
- Board / 3D segmented toggle (active = `--greenpill`, `#26a269` text).
- **Board** view: 104px mini blueprint (`--blueprint` + grid lines), a small green PCB glyph, dotted pin columns (gold/red/white), and an expand `⤢` (bottom-right) that **switches to the Electronics workspace**.
- **3D** view: 104px light grid surface with a scaled-down robot arm; expand `⤢` **switches to Build**.
- Telemetry strip: `7.9V · 42% · 38°C` (mono 11px).

> **IMPORTANT — mini viewer fidelity:** Only the **chrome/window dressing** of this card is part of the redesign — i.e. the Soft Shell card container, the Board/3D segmented toggle, and the expand-to-workspace behaviour. The **inner content of the mini Board view and mini 3D view should keep the real app's current style and functionality** (the actual board render and the actual 3D scene). The blueprint board glyph and the CSS robot arm shown in this prototype are placeholders standing in for those live renders — do **not** reimplement them from this mock; reuse the app's existing mini-board and mini-3D components inside the restyled card.

**Instrument Dock** (below mini viewer, `flex:1`, collapsible):
- Header "▭ INSTRUMENT DOCK" + collapse chevron `⌄`.
- **INPUTS** row: wrap of 34×34 `--card` icon buttons, `--greentext` glyphs.
- **OUTPUTS** row: 34×34 `--card` buttons, `--gold` glyphs.
- **+ Add** pill (`--greenpill`).
- **Plotter** (an instrument — lives inside the dock): `--card` sub-card; header "PLOTTER" + `serial · live` green tag + ✕; a 150px `--con` scope showing two SVG traces (temp `#e7bf62`, light `#5fc4e0`) with "92 samples · 8.3 Hz"; footer "auto-scroll · live" + "↺ Clear".
- **Collapsed state:** a 36px horizontal bar "⌃ INSTRUMENT DOCK".

---

## Screen: Electronics (Board View)

**Purpose:** Wire components to board pins; browse the parts library; drivers auto-detected.

**Layout:** grid, 14px gap. Columns: `[board canvas: 1fr]  [library: 300px | 34px-collapsed]`.

### Board canvas (left) — radius 16, overflow hidden, column flex
- **Sub-toolbar** (`--panel`): "BOARD VIEW" (IBM Plex Mono 13px, letter-spacing .16em) · segmented **Node graph / Breadboard(active gold) / Schematic** · board dropdown chip "Raspberry Pi Pico 2 W ▾" · muted "RP2350" · gold **Help ①** pill.
- **Blueprint area:** `--blueprint` bg with 26px grid lines.
  - **Browser panel** (floating, top-left, 210px): translucent dark `rgba(12,20,28,.82)`, 1px light border. "BROWSER ‹" label; italic "Untitled project"; "Add a description…"; "▾ Components 1"; "Raspberry Pi Pico 2 W [MCU]". Collapses (via `‹`) to a small "BROWSER ›" pill.
  - **Board graphic** (centered): left label column + green PCB body (USB header, RP chip, radio module) + right label column. **40 pins** total, mono 11px, colour-coded dots — power `#d4553f`, GPIO `#d9a441`, ground `#e8ecef`. (Left GP0/01…GP15/20; right VBUS/40…GP16/21.)
  - **Zoom bar** (bottom-left, translucent dark): "Drag from a pin to another pin to wire them." − 164% + ⛶.
  - **Connections** (bottom-right, translucent dark): "▾ Connections ⓪".

### Library panel (right, 300px, collapsible) — `--panel`, radius 16
- Header: 📌 + "LIBRARY" + collapse chevron `›`.
- **+ New part** (gold gradient) and **Add library** (`--card`) buttons.
- Search field (`--card`, inset, mono placeholder "Search parts (name, tag…)").
- "▾ Standard Parts  [22]".
- Categorised, scrollable list (uppercase category headers with counts):
  - **Microcontroller (15):** Adafruit Feather ESP32-S3, Adafruit Feather nRF52840, Adafruit Feather RP2040, Adafruit ItsyBitsy RP2040, Adafruit QT Py RP2040, ESP32 DevKit, ESP32-12F, Pimoroni Motor 2040, Pimoroni Servo 2040, Pimoroni Tiny 2350, Raspberry Pi Pico, Raspberry Pi Pico 2 W, Raspberry Pi Pico W, Seeed XIAO RP2040, Seeed XIAO RP2350.
  - **Sensor (3):** BME280 Breakout, HR SR04, ICM20948 Breakout.
  - **Input (1):** Potentiometer.
  - **Motor (2):** N20 Motor, SG90 Micro Servo.
  - **Breakout (1):** MX1508.
- **Collapsed state:** 34px vertical rail with 📌 + "Library" + `‹` reopen.

---

## Screen: Build (3D assembly)

**Purpose:** Assemble the robot in 3D — URDF joints, IK chains, and poses.

**Layout:** flex column, 14px gap. A `1fr` viewport row on top, then the Pose Studio dock (collapsible) below.

### 3D viewport (full width) — light grid surface (`#eef1ec→#dfe3dc`), radius 16
- Faux-perspective floor grid.
- **Viewport toolbar** (top): gold **+ New robot**, `--card` **🗀 Open…**, `--card` **⤢ Pop out**, right-aligned `--card` home **⌂**.
- **Robot arm**: soft metallic links (`#dfe3dc→#aeb4a8`), a green end-link, white joint hubs ringed in `#26a269`, glowing green end-effector.
- Info pill (bottom-center, glass): "demo_arm · 3 joints · 4 links".

### Pose Studio dock (bottom, 172px, collapsible) — `--panel`, radius 16
- Left block: "Pose Studio" 15/700 + "stand → step_A"; a green ▶ play tile (13-radius) and a `--card` ↺ tile; collapse chevron `⌄` (top-right).
- **Knobs**: three 64px circular knobs (radial `#fbfaf5→#dfe0d8`, inset highlight + drop shadow) with green pointer needles — **Coxa +40°**, **Femur −25°**, **Tibia +110°** (green value text).
- **Keyframe timeline** (`flex:1`, `--card`, inset shadow): a rail with 4 rounded keyframe blocks (first filled green gradient, rest `--greenpill`) and a **gold playhead** at ~46%. Label "Keyframes" + "lerp · ease-in-out".
- **Collapsed state:** 38px bar "⌃ Pose Studio  stand → step_A".

> Not yet built: a **URDF hierarchy / joint-tree** panel for Build (discussed but out of scope in this mock). If added, give it its own inline collapse control like the other panels.

---

## Interactions & Behaviour
- **Workspace switch** — segmented control sets `mode`; the workspace body swaps. Active segment gold.
- **Theme toggle** — flips `light`/`dark`; persisted to `localStorage['snakie-theme']` and restored on mount. (When embedded with an explicit `theme` prop, persistence is skipped.)
- **Per-panel collapse** — every collapsible panel owns its control (a chevron in its own header), so a control never means different things in different workspaces:
  - Code: Files panel, Console, Instrument Dock.
  - Electronics: Browser, Library.
  - Build: Pose Studio.
  - Collapsing reflows layout: side panels shrink to a labelled reopen rail (34px) or the grid column narrows; top/bottom panels collapse to a slim bar. Collapsed side panels/rails and bars are themselves the reopen affordance.
- **Mini viewer** — Board/3D toggle swaps the preview; each preview's `⤢` expand icon navigates to the corresponding full workspace (Board→Electronics, 3D→Build).
- **Console caret** — blinking cursor, 1s step animation.
- Buttons show `cursor:pointer`; add your codebase's standard hover/active affordances (the prototype leaves hover states to your design system).

## State Management
Local UI state (no data fetching in the prototype):
- `mode`: `'code' | 'elec' | 'sim'` — active workspace.
- `theme`: `'light' | 'dark'` — persisted to `localStorage['snakie-theme']`.
- `preview`: `'board' | '3d'` — Code mini-viewer selection.
- `filesOpen`, `consoleOpen`, `dockOpen`, `browserOpen`, `libraryOpen`, `poseOpen`: booleans for panel collapse.

Real app will additionally need: open files/tabs, editor buffer + dirty flag, device connection status, serial/plotter stream, parts/wiring model, URDF/joint model, pose keyframes.

## Design Tokens
Defined as CSS custom properties; **light** then **[dark]** value.

**Surfaces**
- `--bg` desk `#e6dfcf` / `#121410`
- `--shell` `#efe9dc` / `#1d201a`
- `--panel` `#f6f1e6` / `#21251f`
- `--panel2` `#ece5d6` / `#171a14`
- `--shellbd` border `#e0d9c8` / `#31352b`
- `--card` `#fff` / `#262a21`
- `--rail` `#e3e6df` / `#2a2e24`
- `--editor` `#f4eede` / `#191c15`, `--gutter` `#ece2cd` / `#15180f`, `--line` `#e7dcc4` / `#2a2e22`
- `--con` console `#14160f` / `#0c0e08`, `--conbd` `#2a2d24` / `#242a1c`
- Left rail: constant `#26281f` (both themes); active tile `#3a3d30→#2c2f24`; inactive icon `#8f9184`.

**Text**
- `--head` `#2a2b28` / `#eef1ea`
- `--txt2` `#5f5c50` / `#9a9d8f`
- `--txt3` `#7a776a` / `#8b8e80`
- `--txt4` `#9a9686` / `#73766a`
- `--txt5` `#a5a08e` / `#73766a`

**Accents**
- Green: `--green #26a269`; `--greentext #1c7a4d` / `#8fe6b6`; Run gradient `#42b877→#2f9e63`; `--greenpill` `linear-gradient(145deg,#eafaf1,#dbf3e6)` / `(#203f2d,#183324)`.
- Gold: `--gold #d9a441`; `--goldbg #f0dca6` / `#4a3c1c`; `--goldink #6b4e17` / `#f0dca6`; gold button gradient `#f0dca6→#e7bf62`.
- Red (destructive): `#e06a54→#cf4a37`.
- Blueprint (board surface): `--blueprint #1f4e6b` / `#16324a`; grid line `--bpline rgba(220,235,245,.09/.07)`; text `--bptext #cfe4f0`.
- Pin dots: power `#d4553f`, GPIO `#d9a441`, ground `#e8ecef`.

**Syntax**
- `--kw` `#a23b2e` / `#e08b7d` (bold) · `--str` `#9c7a2e` / `#d8b96e` · `--num` `#2f6f8f` / `#7fc4e0` · `--com` `#a39877` / `#6f7a63` (italic) · `--ident` `#3a362a` / `#cdd4cb`.

**Typography**
- UI: **Plus Jakarta Sans** (400/500/600/700). Mono/code/telemetry: **IBM Plex Mono** (400/500/600).
- Common sizes: wordmark 17/700; body 12–14; section headers 11px/700 uppercase letter-spacing .12em; code 13.5px/28px line-height; micro labels 10px/700 uppercase.

**Radii:** shells/cards 16; toolbar buttons 10–11; pills/segments 9–12; small tags 6–8; knobs/dots 50%.

**Shadows:** panels `0 2px 8px rgba(0,0,0,.06)`; raised cards `0 3–6px …`; buttons colored glow (e.g. green `0 5px 12px rgba(38,162,105,.4)`); inset for consoles/tracks/wells; glass overlays use `backdrop-filter: blur(6px)` over `--glass`.

**Misc tokens:** `--glass rgba(255,255,255,.78)` / `rgba(18,22,15,.74)`; `--pillinset rgba(255,255,255,.6)` / `rgba(255,255,255,.08)`; `--dot` desk texture dot.

**Spacing:** 14px is the dominant gap/padding unit; 16–22px inside larger panels; 6–10px for tight clusters.

## Assets
No binary assets in the bundle. To reach production parity, supply:
- Real **Raspberry Pi Pico 2 W board image** (Electronics currently uses a stylised SVG/CSS drawing).
- Your **icon set** — toolbar (new/open/save/undo/run/reset), left rail (files/packages/inspect/report/learn/help/settings), panel headers, instrument input/output glyphs (currently Unicode stand-ins).
- Actual **3D viewport** (three.js or your engine) — the arm here is a CSS mock.
- Real **serial plotter** rendering (SVG traces here are static samples).

## Files
- `Snakie Soft Shell.dc.html` — the full component (all three workspaces + chrome + light/dark). Props: `mode`, `theme`.
- `Snakie Workspaces.dc.html` — side-by-side canvas of Code / Electronics / Build (imports the component three times).
- `support.js` — prototype runtime only; **do not ship**.
- `screenshots/01-code.png`, `02-electronics.png`, `03-build.png` — reference captures of each workspace (light theme; cropped to preview width).
