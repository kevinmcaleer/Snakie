# Snakie — UI inventory

The map of the whole app that the component work is sequenced from: every
screen and surface (pass 1), then the UI patterns found across them with how
many separate implementations each has (pass 2's starting tally). The
implementation count is the Storybook build order: the pattern with the most
copies pays off across the most screens once it has one canonical component.

## 1. Screen map

### Global chrome
- Toolbar — brand, file group (New / Save / Export PDF), Run, Reset, workspace switcher, theme toggle
- Activity bar (left rail) — Files, Source, Packages, Plugins, Inspect · Report Bug, Learn, Help, Settings
- Status bar — device state, runtime, tips, line count, version, coffee nudge, Flash firmware
- Notice stack — library-not-on-board banners, driver install, parts import, update notifier
- Simulated-device notice (popover)

### Workspaces
- **Blocks** — Blocks start, starter cards, Blockly canvas, advanced-blocks toggle
- **Blocks + Python** split
- **Code** — file panel, editor tabs, Monaco, find/replace, console (Console / Problems), right column (mini viewer Board/3D, instrument dock)
- **Electronics** — Board View (Breadboard / Schematic), board picker, ERC, LIVE, Help, component browser, hierarchy, connections table, parts library, part details, part help drawer, part facets, Data View
- **Build** — Robot View (3D), build panel, build checklist, robot toolbar, controls, dock, motion dock, timeline, sequencer, view cube

### Left panels
- Files (local tree, device tree, sync control, upload controls)
- Source control (Git panel)
- Packages / Modules (detected modules, registry)
- Plugins
- Inspect (variables, outline)
- Report bug
- Learn (tutorials, build checklist)
- Help (help library)
- Chat (settings, pane)

### Dialogs and modals
Settings · Flash firmware · Board Finder · Git publish · Device queue ·
Simulated memory · Prompt modal · Robot properties · Function settings ·
Transfer progress · Export progress · Shortcut sheet · Context menu

### Editors
- Part editor (Breadboard / Schematic / 3-D, layers, inspector, board)
- Sprite editor
- Font editor (instrument)

### Instruments (25)
Plotter · Oscilloscope · Multimeter · Data logger · Range · Potentiometer · IMU ·
Barometer/Env · Button · Encoder · Display · Wi-Fi scan · Bluetooth · I²C detect ·
Gamepad · LED · Bench PSU · Servo · Motor · Poses · Buzzer · SAM · Font ·
Turtle · Placeholder — each in three hosts: docked, floating overlay, separate window

### Separate windows
Console window · Instrument window · Find window · Board capture

## 2. Patterns and their implementations

Counted from renderer CSS: distinct BEM blocks implementing each pattern
(`npm run design:audit` → `token-audit-data.json`, `patterns`).

| Pattern | Implementations | Files | Canonical today |
|---|---|---|---|
| Button | 49 | 52 | `.btn` + `--primary` `--danger` `--ghost` `--icon` `--knob` `--sm` `--lg` — but 48 other blocks roll their own |
| Panel / section header | 49 | 52 | `PanelHeader` component exists; most panels use their own `__head` |
| Empty state | 44 | 40 | none |
| Tooltip / popover / hint | 41 | 40 | none |
| Input / field | 29 | 29 | none |
| Badge / chip / pill / tag | 25 | 27 | none |
| Dialog / modal | 24 | 20 | none — each dialog owns its backdrop, header and close |
| Segmented control / toggle | 23 | 23 | none — workspace switcher, Board/3D, Console/Problems, Settings segments, view tabs … |
| Close button | 22 | 22 | none |
| Slider / knob | 19 | 19 | `btn--knob`; instruments roll their own |
| Select / dropdown / picker | 16 | 17 | none |
| Tabs | 15 | 12 | none |
| Checkbox / switch | 12 | 11 | none |
| Icon button | 10 | 11 | `btn--icon` |
| Collapse chevron / caret | 10 | 11 | `CollapsiblePanel` |
| Notice / banner / toast | 9 | 9 | `Notice` component |
| Card | 9 | 9 | none |
| Tree row | 6 | 7 | none |

## 3. Suggested build order for pass 2

1. **Button** (primary, secondary, danger, ghost, icon) — most copies, and two
   of its variants fail contrast today.
2. **Segmented control** — owns most of the light-skin `--txt3` failures.
3. **Panel header** — wrap the existing `PanelHeader` and migrate.
4. **Dialog** (backdrop + header + close button + footer) — fixes the Flash
   firmware island in one move.
5. **Badge / chip** and **status pill** (LIVE, ERC, counts).
6. **Empty state** — includes the instrument "No signal yet" state that fails in both skins.
7. **Input / select / search field** — with a `--border-control` that clears 3:1.
8. **Notice banner**, **tooltip / popover**, **tabs**, **tree row**, **card**.
9. **Instrument chrome** — bezel, bar, keys, readout, shared by 25 instruments.

## 4. Open questions

- Should the instrument dock and instrument windows stay dark in the light skin
  ("instrument glass"), or follow the skin? Either is defensible; it needs one
  decision, recorded as a fixed surface or themed.
- Is the Help panel's parchment meant as a fixed "book" surface? If yes, its
  dark-skin text failures need fixing in place; if no, it moves to Soft Shell surfaces.
- One token family or two? The audit recommends Soft Shell as the survivor,
  with the legacy chrome tokens aliased to it and then removed.
