# Light / dark parity audit

Pass 1 of the design-system epic. The question: **are the light (Skeuomorph) and
dark skins equally usable?** The short answer is **no — dark is the more usable
skin**, and the reasons are structural rather than a handful of bad colours.

Everything here is measured, and every number can be regenerated:

| What | Command | Output |
|---|---|---|
| Rendered contrast, both skins, 15 screens | `npm run design:rendered` (needs `npm run dev:web`) | `audit/rendered-contrast.json`, `audit/screens/*.jpg` |
| Token pairings, both skins | `npm run design:contrast` | stdout |
| Tokens, hardcoded values, theme scoping | `npm run design:audit` | `token-audit-data.json` |

Screenshots in `audit/screens/` show each screen with **light on the left, dark
on the right**.

## 1. Headline

Rendered audit: the web build in headless Chromium, 1440×900, every screen in
both skins. Each visible text element is scored against the pixels actually
painted behind it (a second screenshot with all text made transparent), so
gradients, textures and overlays are measured rather than guessed.

| | Light | Dark |
|---|---|---|
| Text elements measured | 467 | 464 |
| Failing WCAG AA (4.5:1, or 3:1 for large text) | **115** | **43** |
| Severe (below 3:1) | **31** | **13** |
| Median contrast ratio | 6.23 | 7.76 |

Of the 459 elements present in both skins, **294 are harder to read in light**.
Failures by skin, grouped by component (full lists in §5):

- **40 components fail in light only** — they pass in dark.
- **26 components fail in both.**
- **3 components fail in dark only.**

Token pairings tell the same story: of 35 text-on-surface pairings checked from
`index.css`, **17 fail in light and 7 in dark** (§3).

## 2. Why — five root causes

### 2.1 Colour is mostly hardcoded, so most components don't theme at all

Only **11 of 114** CSS files contain a single theme-scoped rule. The rest theme
only as far as they use tokens, and they often don't:

- **2,482** raw colour literals in renderer CSS (**873** distinct values).
- **1,616** of them sit in *unscoped* `color` / `background` / `border` / `fill`
  rules — one value for both skins. Top files: `PluginsPanel.css` (96),
  `WiringCanvas.css` (93), `HelpPanel.css` (85), `InstrumentWindow.css` (79),
  `BuzzerInstrument.css` (77), `DisplayInstrument.css` (58),
  `FirmwareFlasher.css` (58).
- **685** `var(--token, <literal>)` fallbacks. The parity test already guarantees
  the tokens exist, so the literals never paint today — but they are 685 places
  where a second, single-skin opinion of the colour is written down.
- **700** colour literals in TS/TSX across 59 files; **39** of those files have no
  theme awareness at all. Biggest: `BoardGraph.tsx` (69), `PartCanvas.tsx` (51),
  `instruments-registry.ts` (48), `store/editorThemes.ts` (42),
  `help-content.ts` (24), `robot-bone-mode.ts` (17).

A literal only suits the skin it was picked in. The rendered results show most
were picked against dark surfaces.

### 2.2 Dark is the base; light is an overlay

`:root` (no attribute) carries the **dark** values, and `[data-theme='skeuomorph']`
overrides them — even though Skeuomorph is the default skin. In `index.css`,
light gets 137 scoped rules (bevels, gradients, textures) and dark 128; in
component CSS, all but two scoped rules are light overrides (FindReplace 24,
PartEditor 11, ShellPanel 10, RobotView 9, WiringCanvas 8 …); only ShellPanel
has any dark-scoped rule (2).
Component CSS is therefore written for dark first, and light is patched where
someone noticed.

### 2.3 Two token vocabularies are live at once

148 custom properties are defined; 67 vary by skin. Two systems overlap:

| Role | Legacy chrome tokens | Soft Shell tokens (#573) |
|---|---|---|
| Surfaces | `--bg`, `--bg-elevated`, `--bg-sunken` | `--desk`, `--shell`, `--panel`, `--panel2`, `--card`, `--rail` |
| Text | `--text`, `--text-muted` | `--head`, `--txt2` … `--txt5` |
| Accent | `--accent`, `--accent-ink`, `--accent-2` | `--gold`, `--goldink`, `--green`, `--greentext` |
| Border | `--border` | `--shellbd`, `--line`, `--stitch` |

The same role resolves to different values depending on which family a
component reached for, so the same "muted label" is 4.5:1 in one panel and
2.6:1 in the next.

### 2.4 The light text ramp is too pale, and `--accent` is used as text

From `npm run design:contrast`:

| Pairing | Light | Dark | Where it shows |
|---|---|---|---|
| `--txt3` on `--panel2` | **3.58** | 5.26 | inactive workspace tabs, Board/3D, Breadboard/Schematic, "Instruments" rail |
| `--txt3` on `--panel` | **3.99** | 4.65 | Library headings, part categories, counts |
| `--txt4` on `--panel` | **2.63** | **3.36** | RP2350 chip, LIVE, badges, chevrons |
| `--txt5` on `--gutter` | **2.04** | **3.87** | line numbers |
| `--accent` as text on `--bg-elevated` | **2.63** | 6.06 | Settings tab, part-editor "Pin", "⇧ Publish" |
| `--accent-contrast` on `--accent` | **3.56** | 7.83 | every active segment in Settings |
| `--text-muted` on `--bg-sunken` | **4.06** | 6.06 | Learn checklist, part-editor tabs, Packages tab |
| `--danger` on `--bg-sunken` | **3.62** | 4.65 | "MicroPython worker is not running" |
| `--warn` on `--bg` | **3.61** | 7.39 | warnings |
| `--str` on `--editor` | **3.46** | 9.10 | string literals in code |
| `--com` on `--editor` | **2.48** | **3.81** | comments |

`--accent-ink` exists precisely to be the readable brass for text, but 133
`var(--accent, …)` references use the fill colour instead.

### 2.5 Theme-invariant islands

Surfaces that render identically in both skins. Some are deliberate and
documented; the rest read as a bright patch in dark mode or a dark slab in light.

| Surface | Behaviour | Verdict |
|---|---|---|
| Board View mat, pin labels, blueprint chrome | Blue mat in both | Deliberate (#181) — keep, document as a "fixed surface" |
| Console / xterm | Near-black phosphor in both | Deliberate (handoff) — keep |
| Block palette | One set of fills in both | Deliberate (#1098/#1099) — keep |
| Gold active state (`--grad-gold` + `--ongold`) | Same in both | Deliberate (#956) — keep |
| **Help panel** | Parchment in dark mode | **Not themed** — bright island in dark |
| **Flash firmware dialog** | Dark slate in light mode | **Not themed** |
| **Notice banners** (library not on board) | Same yellow in both | **Not themed** |
| **Instrument dock + instrument windows** | Dark in both | **Decide** — reads as intentional "instrument glass", but the "No PWM signal yet" empty state inside fails at 1.3–1.6:1 in both |
| **Plotter bezel** | Light grey frame in both | **Not themed** |

## 3. Borders and boundaries

`--border` on `--bg` is 2.23 (light) / 1.57 (dark); `--shellbd` on `--panel` is
1.25 / 1.24. WCAG 1.4.11 only requires 3:1 where the border is what identifies a
control, so decorative panel edges are fine. Inputs, selects and search fields
that rely on these borders to be found are not. This needs a separate
`--border-control` token rather than darkening every panel edge.

## 4. Other measurable drift (input to passes 2 and 3)

| | Count | Notes |
|---|---|---|
| Distinct font sizes | 71 | mixed `px` and `rem`; top: `0.72rem`, `11px`, `13px`, `12px`, `0.7rem` |
| Font-family stacks declared outside tokens | 10 | `'JetBrains Mono'` still declared 22×, Georgia, Space Grotesk, Helvetica |
| Distinct spacing values | 102 | 22 px values off a 4px grid |
| Distinct radii | 34 | `4px`, `6px`, `5px`, `8px`, `999px`, `3px`, `7px` … |
| Distinct box-shadows | 200 | |
| Distinct z-index values | 24 | |
| Class names | 3,204 | 170 button-ish |

Component sprawl by pattern (distinct implementations, each a BEM block in its
own file) — see [`ui-inventory.md`](ui-inventory.md):

| Pattern | Implementations | Files |
|---|---|---|
| Button | 49 | 52 |
| Panel / section header | 49 | 52 |
| Empty state | 44 | 40 |
| Tooltip / popover / hint | 41 | 40 |
| Input / field | 29 | 29 |
| Badge / chip / pill / tag | 25 | 27 |
| Dialog / modal | 24 | 20 |
| Segmented control / toggle | 23 | 23 |
| Close button | 22 | 22 |
| Slider / knob | 19 | 19 |

## 5. Every failing component

`ratio` is the worst instance, pixel-measured; `other` is the same element in
the other skin. `n` is how many instances failed.

### Fails in light only (40)

| Component | Screen | Light | Dark | Colours (light) | n | Example |
|---|---|---|---|---|---|---|
| `wc__tree-caret` | electronics | **1.03** | 7.10 | #d8e4e8 on #ece5d6 | 1 | ▸ (Connections) — invisible |
| `erc__badge-count` | electronics | **1.38** | 10.16 | #46e06a on #ece5d6 | 1 | ✓ (ERC) |
| `robottimeline__time` | build | **2.00** | 6.92 | #d9a441 on #f6f1e6 | 1 | 0.00s |
| `settings-tab` | settings | **2.63** | 6.06 | #b07d1e on #d8dce2 | 1 | Appearance |
| `pe__pin-col`, `pe__flattype` | part editor | **2.63** | 6.06 | #b07d1e on #d8dce2 | 2 | Pin, io |
| `settings-check` | settings | **2.63** | 12.78 | #34373d on #74767b | 1 | Show advanced blocks |
| `editor-tabs__new` | code | **2.67** | 4.70 | #7a776a on #d0c7ae | 1 | + |
| `pl__badge` | electronics | 3.22 | 6.74 | #b07d1e on #f6f1e6 | 1 | ⇧ Publish |
| `statusbar__item`, `statusbar__tip-text` | all | 3.23–3.31 | 5.83 | #5c616a on #b7bbc3 | 15 | v0.91.0, tips |
| `settings-segment__btn` | settings | 3.56 | 7.83 | #fffdf6 on #b07d1e | 7 | Light, Scratch |
| `ws-switcher__btn`, `boardgraph__viewtab`, `miniviewer__seg-btn`, `shell__dock-rail-label`, `wc__table-head` | code, electronics, blocks | 3.58 | 5.26 | #7a776a on #ece5d6 | 9 | Build, Schematic, 3D |
| `vars__error` | inspect | 3.62 | 4.65 | #c4301f on #cdd1d8 | 1 | MicroPython worker is not running |
| `shell-toggle__btn` | code | 3.71 | 7.81 | #dff2e6 on #4b8567 | 1 | Problems |
| `btn--danger` (Reset, ⟳) | code | 3.76–3.83 | 4.55–4.61 | #ffffff on #e3503e | 3 | Reset |
| `activitybar__item-label` | all | 3.82 | 4.66 | #9498a1 on #393c44 | 3 | Files |
| `cpanel__title`, `pl__cat-name`, `boardgraph__dock-*`, `wc__table-count` | electronics | 3.99 | 4.65 | #7a776a on #f6f1e6 | 6 | Standard Parts |
| `bugpanel__hint` | report | 4.00 | 4.71 | #73777d on #f6f1e6 | 1 | Captures the Snakie windows |
| `blocks-start__button-hint` | blocks | 4.03 | 4.71 | #d2e3cf on #1c7a34 | 1 | Four blocks, a loop… |
| `bcl__tick`, `bcl__where`, `pkgs-tab`, `pe__tab`, `pe__caret`, `pe__hint`, `pe__libsel` | learn, packages, part editor | 4.06–4.27 | 5.69–6.06 | #5c616a on #cdd1d8 | 14 | Robot View · Build |
| `pkgs__group-head`, `pkgs__hint`, `pkgs__advanced-summary`, `pkgs__flash-readout` | packages | 4.34 | 6.73 | #aecbb8 on #2f5d44 | 5 | REGISTRY |

### Fails in both (26)

| Component | Screen | Light | Dark | Example |
|---|---|---|---|---|
| `instr-req__line`, `instr-req__title` | instruments | **1.33 / 1.56** | **1.33 / 1.56** | "No PWM signal yet" empty state |
| `pe__rowflag` | part editor | **1.80** | **2.21** | ● |
| `help__search-mag` | help | **2.30** | **2.30** | ⌕ |
| `pkgs__src` | packages | **2.37** | **2.38** | curated |
| `help__legend-item` | help | **2.56** | **2.56** | library / collection / open |
| `cpanel__chevron`, `cpanel__badge`, `boardgraph__live`, `boardgraph__chip` | electronics | **2.63** | 3.36 | RP2350, LIVE, 61 |
| `instr__key` | instruments | **2.81** | **2.81** | LIVE |
| `btn--primary` glyph | code | **2.83** | 3.42 | ▸ Open Folder |
| `pe__pin-col`, `pe__flatnum`, `pe__flattype`, `pe__hint` | part editor | 2.89–3.45 | 3.32–4.29 | #, 1, pwr |
| `boardgraph__picker-caret` | electronics | **2.97** | 3.15 | ▾ |
| `bugpanel__label`, `pl__cat-count` | report, electronics | **2.99** | 3.64 | (optional), 10 |
| `toolbar__wordmark` | all | 3.52 | **2.85** | Snakie |
| `instr-dock__add` | code | 3.64 | 3.64 | Add |
| `help__plate-caption`, `help-dialect__caption` | help | 3.66 / 4.21 | same | Contents |
| `notice__toggle`, `notice__close` | all | 4.35 | 4.35 | ▸ ✕ |
| `pkgs__desc` | packages | 4.47 | 4.27 | package descriptions |

### Fails in dark only (3)

| Component | Screen | Dark | Light | Example |
|---|---|---|---|---|
| `help-tree__label` (nested) | help | **1.74** | 7.07 | Bench PSU — dark ink left on a dark row |
| `help__version` | help | **2.16** | 5.10 | Snakie v0.91.0 |
| `pe__btn` (Save) | part editor | **2.31** | 6.18 | white on brass |

## 6. What is NOT covered yet

- Screens not reached by the script: Source control, Plugins, Chat, Data View,
  Sprite editor, Robot properties, Git publish, Board Finder, device queue,
  transfer progress, shortcut sheet, the separate console / instrument / find
  windows, and all instruments beyond Plotter, Multimeter, Servo and
  Oscilloscope. Add them to `SCREENS` in `scripts/design/rendered-contrast.py`.
- Hover, focus, pressed and disabled states (disabled text is excluded, as WCAG allows).
- Canvas-drawn content (Board View wiring, three.js scenes, Blockly blocks) —
  scored only where it is DOM or SVG text.
- Focus-ring visibility and non-text contrast of controls beyond borders.
- The Electron build: this ran against `npm run dev:web`. Chrome is the same
  engine; native window chrome is not covered.

## 7. Quick wins (token-only, no component changes)

These move the most failures for the least code, and are safe to land ahead of
pass 2 because they change token values, not structure:

1. Darken the light `--txt3` to clear 4.5 on `--panel2` (fixes ~20 elements:
   workspace tabs, segments, library headings).
2. Darken the light `--txt4`/`--txt5` and the dark `--txt4`/`--txt5` to clear 4.5 on `--panel` / `--gutter`.
3. Change `--accent-contrast` on light to the dark brass ink (`--ongold`), or
   darken the light `--accent` fill — active Settings segments go from 3.56 to ≥4.5.
4. Point every text use of `--accent` at `--accent-ink`.
5. Darken light `--danger`, `--warn`, `--success`, `--str`, `--com`.
6. Re-skin Help, Flash firmware, notice banners and the Plotter bezel onto
   Soft Shell surface tokens.

Each is verifiable by re-running `npm run design:contrast` and `npm run design:rendered`.
