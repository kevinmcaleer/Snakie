# MicroPython & Blockly — Delivery Plan (Epic #1007)

> A block-based editor for MicroPython inside Snakie, so a learner coming off
> Scratch can drive a real Pico — and then graduate to the Python they were
> writing all along.
> Owner: Kevin McAleer. Status: planning. Target: Snakie ≥ 0.57.0
> (current `package.json` is `0.56.0`).

Twelve sub-issues (#1008–#1019), built in order. This document is the
architecture, the phased roadmap, the design decisions the epic turns on,
per-issue plans grounded in real files, cross-cutting concerns, and the open
questions for the owner.

---

## 1. Overview & guiding principles

**What we're building.** A Blockly workspace as a first-class Snakie editor,
generating honest Snakie MicroPython that runs on the same board, through the
same Run button, with the same instruments as a hand-written file.

**The framing: an on-ramp, not a sandbox.** Scratch teaches sequencing, loops,
events and variables and then stops at the edge of the hardware. MakeCode
crosses that edge but is micro:bit-shaped, with TypeScript underneath. Nobody
does *blocks → real MicroPython → real Pico → real robot* in one app. Snakie
already has every piece except the blocks:

- a **friendly on-device API** — `micropython/snakie.py` (`Servo`, `Buzzer`,
  `Led`, `Pin`, `PWM`), `instruments.py` (telemetry + receivers), `turtle.py`;
- a **WASM MicroPython simulator**, so blocks run with no hardware at all;
- a **parts library** that already knows each part's driver, pins and buses;
- a **course system** (#479) to teach with;
- a **web build** for the Chromebook classroom (epic #267).

**The success test, stated once so every issue can be measured against it.** A
ten-year-old opens Snakie, picks **Blocks**, drags *forward 100 / turn right 90*
four times, presses **Run**, watches a square appear in the Turtle instrument on
a real Pico *or* the simulator, reads the Python those blocks wrote in the pane
next to them, presses **Graduate to Python**, and keeps going in Monaco.

**Honest constraints, documented on purpose.**

- **Blocks → code is generation. Code → blocks is decompilation.** The first is
  a compiler; the second is a research problem. Every design decision below
  falls out of taking that asymmetry seriously instead of papering over it.
- **The generated file is a real file.** It saves, runs, flashes and diffs like
  any other Snakie program. No proprietary runtime, no walled garden, nothing
  that has to be exported before it is useful.
- **We generate the code we would teach.** Blocks target `snakie` /
  `instruments` / `turtle`, not raw `machine` incantations, so nothing the
  learner reads in the mirror pane has to be un-learned later.
- **Monaco stays the centre of gravity.** Blocks are the way in, not the
  destination.

**Keystone-first strategy.** #1008 (the document model + file format) is a
keystone: it ships no Blockly at all, but every later issue consumes it. It
lands first, pure and unit-tested. #1010 (the generator) is the second spine —
its **block↔line source map** is a prerequisite for both #1015's tracebacks and
#1016's linked block↔code highlighting, so it ships *with* the generator rather
than being retrofitted once the shape is wrong.

**Engine choice: Blockly (Google, Apache-2.0).** Mature, themeable, keyboard-
navigable, and the thing Scratch itself is built on, so the muscle memory
transfers on day one. The licence is permissive — worth noting explicitly, since
the Circuit Sim epic had to work around Falstad's GPL. We write our **own**
MicroPython generator: Blockly's stock Python generator targets CPython and
knows nothing about `machine`, `snakie` or `instruments`.

---

## 2. The design decisions

### 2.1 Where the switcher goes

**Decision: a fourth segment in the existing toolbar workspace switcher —
`Blocks · Code · Electronics · Build`.**

`WORKSPACE_IDS` in `src/shared/workspaces.ts` already drives three surfaces from
one list: the centred segmented control in `Toolbar.tsx`, the per-workspace
geometry in `store/layout.ts`, and View ▸ Workspace on the application menu
(#916). One entry there buys all three. It is global, it is at the top of the
screen, and it is the control the user already reaches for to change what the
app is *for*.

The alternatives, and why they lose:

| Option | Why not |
| --- | --- |
| Next to Run/Stop | Run/Stop are **device** controls; view mode isn't. It also crowds the one cluster that has to stay unmissable for a beginner. |
| In the tab strip | Exactly the confusion raised in the epic: some tabs blocks, some code, and a toggle that cannot honour itself on a `.py` that was never blocks. |

**But the switcher does not convert anything**, because it can't — that's §1's
asymmetry. So:

- The **mode is a property of the file** (#1008), not of the app.
- The Blocks workspace is a **layout**: files panel + block canvas + Python
  preview + console; no board pane; instrument dock available.
- A blocks file **opens in blocks from any workspace**, exactly as `.urdf` opens
  Robot View and `.csv` opens Data View in `EditorArea.tsx` today. The tab
  carries a block glyph.
- Switching to Blocks changes the layout and what **New** creates. It never
  reinterprets an open file.

That gives the global, unambiguous switch that was asked for, without a control
that lies when you press it on the wrong file. It is *not*, however, a choice
between seeing blocks and seeing Python — see §2.2.

### 2.2 The split — the switcher is either/or, the *view* is both

The workspace switcher is a **layout** control, so it can only ever be one thing
at a time. But blocks and Python have to be on screen **together** — that is the
entire teaching mechanism, and a learner who has to switch away to see the code
will simply never look.

So the split lives *inside* the view, and the switcher decides **which side is
big**, never which side exists.

**Every blocks file is a split view, in every workspace:**

| Workspace | a blocks file shows | a plain `.py` shows |
| --- | --- | --- |
| **Blocks** | **blocks-primary** — canvas large, Python mirror beside it | Monaco (nothing to split) |
| **Code** | **Python-primary** — code large, blocks collapsed to a peek strip | Monaco |

It is the *same mounted component* in both: the workspace changes the split
ratio and which pane holds focus, nothing more. That is exactly the "restyle the
same tree, remount nothing" property `store/layout.ts` already guarantees for
workspace switching (the editor, the xterm scrollback and the instruments all
survive it today).

Which means pressing **Code** on a blocks file finally *does* something
meaningful — "make the Python the big one" — without converting anything, and
pressing **Blocks** brings the canvas back with that workspace's other geometry
(files panel, console height) in tow. The global switcher keeps its single,
honest job: it sets emphasis, not content.

**A local view-mode control** — `Blocks · Split · Python` — sits in the editor
header and overrides the emphasis per file, for when the workspace default is
wrong: full-width canvas to untangle a big program, full-width Python to read it
properly. The editor header already hosts the per-view controls (Chat, Find in
`EditorArea.tsx`), so that is where it belongs — and keeping it *out* of the
toolbar preserves the one global switcher as the app's only mode control.

**Mechanically it is a panel split, not a new framework.** The centre column is
already a `react-resizable-panels` group (`vertical = [editor, shell]`); the
editor slot becomes a nested horizontal group `[canvas, python]`, and
`WorkspaceLayout` grows one ratio field beside its existing `horizontal` /
`vertical` arrays. On a narrow window (epic #903) the split degrades to a tab
pair rather than two unusable columns.

**The Python side is a mirror, not a second editor.** Blocks are the source of
truth; the Python is regenerated (debounced) on every workspace change, with
hover-linked highlighting and synchronised scrolling in both directions
(#1016) — hover a block, its lines light up; click a line, its block is
selected.

So the mirror is **read-only** — but as an *affordance*, not a locked box.
Typing into it is caught and answered with the graduation offer (#1016):

> Editing the Python means leaving the blocks behind. **Graduate this file to
> Python?**

Yes → the file becomes a plain `.py` in Monaco with the blocks saved beside it.
No → nothing is lost and nothing is typed. That turns the single commonest
accident in a split view into the milestone this whole epic is built around,
instead of either a dead keypress or a silently clobbered edit.

This read-only rule is the honest default, not a permanent ceiling: it is the
one constraint #1019's decompiler would relax. If that spike succeeds, the
mirror becomes editable for the subset our generator emits and round-trips
through the blocks, with anything outside the subset landing as raw-Python
blocks (#1018).

### 2.3 The file format

**Decision: a blocks program *is* a `.py` file**, with the Blockly workspace
serialised into a trailing comment footer.

```python
from snakie import Led
import time

led = Led(15)
while True:
    led.toggle()
    time.sleep(0.5)

# --8<-- snakie-blocks v1 (do not edit below this line)
# eJyrVspLzE1VslJQchZSslIqS8wpTVWyUsov...
```

One file, deflated and base64'd into a comment block. It runs on the board
unmodified; it survives email, USB sticks, a school network share, git and
copy-paste — all of which matter far more in a classroom than elegance. Snakie
re-opens it in blocks; anything else sees a perfectly ordinary Python program.

Rejected: a sidecar `.blocks.json`. It loses on every one of those counts (one
of the two files always gets left behind), and MakeCode's embedded-XML precedent
is a decade of evidence that the footer approach holds up.

**Hand-edited Python is a detected conflict, never a silent overwrite.** If the
code above the footer no longer matches what the footer generates, opening the
file offers a choice: keep the code and drop the blocks, or regenerate the code
from the blocks. (#1019, if it survives its spike, adds a third option:
reconcile.)

**Flash cost.** The footer is a comment, so it is inert on the device, but it is
not free. If it proves to matter on constrained boards, "strip blocks data on
upload" becomes a setting — deliberately *not* the default, because a file on
the board that differs from the file on disk is a worse surprise than a few KB.

### 2.4 Unknown imports — three layers, and the third can never fail

A hand-maintained palette can only cover the parts we thought of. The parts
library is in the hundreds and grows via a skill; hand-written blocks would be
permanently, visibly behind. So:

1. **Parts generate blocks** (#1017). A part already declares its driver module,
   install source, pins and buses in `parts.yml`. Parts placed in the current
   project (`robot.yml`, via `project-parts.ts`) get their own toolbox category,
   auto-populated, with constructor blocks **pre-filled with the pins the part
   is actually wired to**. Wire a BME280 in Electronics and BME280 blocks are
   waiting for you in Blocks. This is the feature that will sell the epic.
2. **A declarative manifest** (#1017). `blocks.yml` — id, message, typed args,
   code template, imports, setup, colour, tooltip — shippable beside a part's
   `parts.yml`, or by a Python plugin over the existing JSON-RPC host
   (`docs/plugin-system.md` gains a `listBlocks` method). Extending the palette
   never means touching Electron code.
3. **Escape hatches** (#1018). A raw **Python block** (statement *and* value
   shapes, with Monaco-backed completion inside the field), an **import block**
   that routes through the generator's import manager, a generic **call
   block** (`call <method> on <object> with <args>`), and an **attribute block**.
   An unknown library is never a wall — at worst it is a slightly uglier block,
   and the code it generates is still correct Python.

Layer 3 is also a teaching device: the grey blocks are the ones that look like
code, so reaching for them is the first taste of text.

---

## 3. Instruments in block mode

*The short version: most of it already works, and that is the strongest argument
for generating real code rather than interpreting blocks ourselves.*

Instruments are surfaced today by scanning the **active file's source**:

- `components/parse-pins.ts` — best-effort regex over `Pin(…)`, `PWM(…)`,
  `ADC(…)`, `I2C(…)`, `SPI(…)` to find which pads are in use and how;
- the `uses` and `hints` fields on each `InstrumentDef` in
  `components/instruments-registry.ts` — peripheral types and import/driver
  substrings that mark an instrument "in use".

Blocks generate source. So the dock lights up the right instruments, and the
Board View draws the right wires, with **no new machinery at all**. What's left
is the two things that don't come free (#1014):

- **An Instruments category derived from `INSTRUMENTS` itself.** The registry is
  already the single source of truth for the dock, the "Add instrument" palette
  and the placeholder windows; it becomes the source of truth for blocks too.
  Each `InstrumentDef` grows an optional `block` descriptor beside its existing
  `uses`/`hints`, so a new instrument gets a block for free — the same one-line-
  change property the registry was built for.
- **The install banner has to be reachable from the canvas.**
  `lib/instrumentsLib.ts` drives the one-click install of `instruments.py`,
  `snakie.py` and `turtle.py`; today it surfaces in the Board View and the dock.
  In Blocks it must appear the moment a block needs a library the board doesn't
  have. A child cannot be expected to diagnose `ImportError: no module named
  instruments` — and dragging a scope block is now the commonest way to need it.

Beyond that: dragging an instrument block **opens that instrument in the dock**,
so the readout is on screen before the program is even run.

---

## 4. Architecture

```
  BLOCKS WORKSPACE (renderer)                      EXISTING SNAKIE
  ┌────────────────────────────────┐              ┌──────────────────────────────┐
  │ BlocksCanvas.tsx (#1009)       │              │ store/workspace.ts           │
  │   Blockly, lazy-loaded         │──workspace──▶│   OpenFile { …, isBlocks }   │
  │   Soft Shell theme             │    JSON      │   dirty / save / restore     │
  └───────────────┬────────────────┘              └───────────┬──────────────────┘
                  │ onChange (debounced)                      │ save
                  ▼                                           ▼
  ┌────────────────────────────────┐              ┌──────────────────────────────┐
  │ lib/blocks/generator.ts (#1010)│              │ shared/blocks-doc.ts (#1008) │
  │   per-block emitters           │──code───────▶│   code + footer → one .py    │
  │   import manager / hoisting    │              │   parse / write / conflict   │
  │   Map<line, blockId>           │              └──────────────────────────────┘
  └───────┬──────────────┬─────────┘
          │ code         │ source map
          ▼              ▼
  ┌──────────────┐  ┌─────────────────┐           ┌──────────────────────────────┐
  │ Python mirror│  │ traceback →     │           │ Toolbar handleRun            │
  │ read-only +  │  │ block highlight │◀──────────│   device.runProgram (#612)   │
  │ linked #1016 │  │ (#1015)         │  stderr   │   auto-connect / WASM sim    │
  └──────────────┘  └─────────────────┘           └───────────┬──────────────────┘
                                                              │ generated source
  ┌────────────────────────────────┐                          ▼
  │ TOOLBOX SOURCES                │              ┌──────────────────────────────┐
  │  core (#1011)                  │              │ parse-pins.ts + INSTRUMENTS  │
  │  hardware (#1012)              │              │   → dock lights up           │
  │  turtle (#1013)                │              │   → Board View draws wires   │
  │  INSTRUMENTS registry (#1014)  │              │   (NO CHANGES NEEDED)        │
  │  parts + plugins blocks.yml    │              └──────────────────────────────┘
  │    (#1017)                     │
  │  escape hatches (#1018)        │
  └────────────────────────────────┘
```

Two properties of that diagram are the whole design:

1. **Everything downstream of "generated source" is untouched.** Run, the
   console, the instrument dock, the Board View wiring, `.mpy` compilation, git,
   sync — all of it sees an ordinary MicroPython file.
2. **The source map is produced once, at generation time.** It is cheap there
   and impossible to reconstruct later, which is why #1010 owns it even though
   its two consumers (#1015, #1016) come later.

---

## 5. Phased roadmap

### Phase 1 — Foundations (#1008 → #1009 → #1010)

The keystone, the canvas and the generator. At the end of Phase 1 you can make
blocks, see the Python, and save a file that re-opens — but the palette is bare.
Strictly ordered; nothing in Phase 2 can start before #1010.

### Phase 2 — The block library (#1011, #1012, #1013, #1014)

Parallelisable once #1010 lands. Core → hardware → turtle → instruments. **The
first shippable demo is #1013 (turtle)**: it needs no hardware, it's visual, and
it is the closest thing Snakie has to Scratch's stage. Build the screenshots and
the first lesson around it.

### Phase 3 — Run it, teach it (#1015, #1016)

Run/Stop from the canvas with tracebacks that highlight the offending block, and
then the graduation path — the two panes of §2.2's split wired to each other
(hover a block, its lines light up; click a line, its block is selected), eject
to Python, a blocks lesson track. **#1016 is the epic's actual point.** Without it we have built a
nicer Scratch; with it we have built the bridge nobody else has.

### Phase 4 — Extensibility (#1017, #1018)

`blocks.yml`, part-derived categories, plugin-contributed blocks, escape
hatches. This is what stops the palette from ageing.

### Phase 5 — Stretch (#1019)

Python → blocks for the subset our own generator emits. **Spike before
committing**: the open question is how to get a Python AST in the renderer —
the bundled MicroPython WASM, a pure-JS parser, or the CPython plugin host
(which is absent on the web build, i.e. exactly where the classrooms are).

---

## 6. Cross-cutting concerns

**Bundle size.** Blockly core is a multi-MB chunk. It is code-split with
`lazy(() => import(…))` exactly as Monaco, DataView, RobotView and MpyView
already are in `EditorArea.tsx`. A user who never opens Blocks never downloads
it — which matters most on the web build, over a school's connection.

**Web parity.** Blockly is a browser library, so it works in
`vite.web.config.ts` unchanged. Combined with the WASM simulator, the whole
epic runs on a Chromebook with no board and no install (epic #267). Any block
that depends on a desktop-only capability must degrade per epic #853's rule: no
stub that lies.

**Theming.** Soft Shell (epic #573) is not optional here: a bright primary-
colour Blockly dropped into a warm parchment app looks broken. Category and
block colours come from the existing CSS custom-property tokens and the
per-instrument accents already in `instruments-registry.ts`, in both the
`skeuomorph` and `dark` skins — driven by tokens, not hard-coded hex (epic
#859's two-skin rule).

**Fonts.** Plus Jakarta Sans (`--font-ui`) on block text, IBM Plex Mono
(`--font-mono`) inside code fields and the Python mirror.

**`window.prompt` does not exist in the Electron renderer.** Blockly's stock
variable-rename and text prompts call it. They must be overridden to route
through the in-app `usePrompt()` modal, or renaming a variable silently does
nothing. This is a known trap and is called out in #1009.

**Accessibility.** Blockly's keyboard-navigation plugin goes in from the start
(epic #188), not bolted on. Drag-and-drop-only is not acceptable for a tool
aimed at schools.

**Testing.** The generator gets a **golden-file suite** — a block workspace in,
exact MicroPython out — so a generator regression is a failing diff rather than
a bug report from a child. The pure modules (`shared/blocks-doc.ts`, the
manifest normaliser, the traceback→block resolver) follow the house pattern of
React/DOM-free logic with plain-node vitest coverage, like `parse-pins.ts` and
`instrument-host.ts`.

**Schema safety.** `blocks.yml` normalisation follows epic #856: no silently
eaten fields, round-trip tested.

---

## 7. Versioning

Each phase that adds visible capability is a **MINOR** bump (a new workspace, a
new palette, a new panel). The epic as a whole will span several minor releases;
Phase 1 alone is one. Docs- and plan-only changes (including this file) are
**PATCH**.

---

## 8. Open questions for the owner

1. **Blocks or Code as the default workspace for a brand-new install?** Defaulting
   to Blocks is the strongest possible statement of intent for the young-learner
   audience — and the most annoying possible first run for everyone else. A
   first-run choice ("I've programmed before / I'm just starting") is the
   obvious compromise, but it is a decision, not a detail.
2. **How far does "no reading required" go?** Some block sets use icons and
   colour so a pre-reader can work. Our blocks say `forward 100`. Is the target
   age 8+ (reading) or 5+ (not)? This changes the palette design, not the
   architecture.
3. **Should the Blocks workspace show the Board View at all?** The layout
   proposed here hides it, on the grounds that a first-hour learner has enough
   to look at. But "blocks follow your circuit" (#1017) is much more legible
   when the circuit is on screen. A toggle, or a two-preset split?
4. **Strip the blocks footer on device upload?** Proposed default: no (§2.3).
   Worth confirming against the smallest board we care about.
5. **Does the `Blocks · Split · Python` view-mode control stick per file, per
   workspace, or globally?** Per file is the most obedient and the most
   forgettable; global is the most predictable and the most annoying. Proposal:
   per file, seeded from the workspace default, which is what a learner and a
   teacher both expect — but it is a judgement call, not a derivation.
6. **Is `.py` the right extension for a blocks file, or do we want a distinct
   one** (e.g. `.blocks.py`) so the file tree can sort and badge them without
   reading every file? Reading a footer is cheap; a distinct extension is
   cheaper and more legible, but slightly less "it's just Python".
