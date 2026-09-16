# MicroPython & Blockly — Delivery Plan (Epic #1007)

> A block-based editor for MicroPython inside Snakie, so a learner coming off
> Scratch can drive a real Pico — and then graduate to the Python they were
> writing all along.
> Owner: Kevin McAleer. Status: shipped — epic #1007 is closed with all 30
> sub-issues done: the twelve planned here (#1008–#1019) plus those filed while
> building. Landed on `master` from 0.57.0 through 0.68.8. This document is the
> epic's architecture record now, not a forward plan.

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

**The workspace switcher does not convert anything** — but since #1034 the
Blocks workspace will open ANY `.py` in the split, deriving the blocks from the
code (#1019). The asymmetry in §1 is still real; what changed is that the
conversion cannot fail, only be uglier, so there is nothing to refuse. So:

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

Python → blocks for the subset our own generator emits.

#### The spike's answer: there is no AST, and we do not need one

The open question was where a Python AST comes from in the renderer. All three
candidates were checked rather than guessed, and all three lose:

| Candidate | Verdict |
| --- | --- |
| **The bundled MicroPython WASM** | No `ast` module (`help("modules")` confirms it), and `compile()` returns a `code` object whose only attribute is `__class__`. It can say *whether* something parses; it cannot say *what it is*. |
| **The CPython plugin host** | A real `ast` one JSON-RPC call away — on the desktop. Absent on the web build, which is exactly where the classrooms are, so it can only ever be a second implementation of something that has to exist anyway. |
| **A pure-JS parser** | `tree-sitter-python` is ~1.2 MB of WASM plus a runtime, on top of a Blockly chunk we already apologise for. The unmaintained options are Python 2 flavoured. |

**The decision: a lexer and an indentation tree, not a parser**
(`lib/blocks/python-tokens.ts`). Python is line-oriented with significant
indentation; the subset that matters is one we define; and #1018's raw-Python
blocks are a per-line fallback that is *always* correct. So the reader is a few
hundred lines of pure TypeScript, identical on desktop and web, unit-tested in
node against the real generator.

The correctness property is not "produces nice blocks" — that is a quality
question, and it is allowed to vary. It is:

> **converting a program and generating it again gives back the same program.**

Under that rule a conversion that understood nothing and produced a stack of
raw Python blocks still passes. Recognition is then a *quality gradient* on top
of a guarantee, rather than a thing that can fail.

The one documented exception: **imports are re-grouped**, because they go back
through the generator's import manager, which sorts and sections them. A file
whose imports were already in that order round-trips byte-for-byte; one whose
weren't comes back tidied.

`compile()` in the WASM build is still worth having — as a *syntax validator*
that works on both hosts, which is strictly better than #1018's lint. Not wired
up yet; noted here so the next person does not re-run the spike.

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

**Dialects.** Every block in the palette generates MicroPython, and the blocks
are the one subsystem that ignores epic #209's dialect machinery. §9 audits what
CircuitPython would need — which is less than it sounds, and includes one bug.

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

---

## 9. Dialects: what CircuitPython would need (#1033)

**An audit, not a plan.** #1034 made the Blocks workspace the front door for
*any* Python file, and #1033 asked what a CircuitPython user gets when they walk
through it. This section is the answer. No code was written for it.

### 9.1 The short answer

**Converting CircuitPython is already safe. Authoring with the palette is not,
and it fails the worst possible way — silently.**

Those are two different surfaces and they are in very different states. Opening
a CircuitPython file in the Blocks workspace (#1019 + #1034) does the honest
thing today: recognisable structure becomes real blocks, and everything
CircuitPython-specific becomes a raw Python block holding the exact line. But
dragging a *hardware* block into that file emits code that imports `machine`,
and on a CircuitPython board that import does not raise — it falls through a
shim to a set of no-op stubs. The LED does not light and nothing complains.

The scope is also much smaller than "every block in the palette generates
MicroPython" suggests. It is **29 blocks out of 98**, in two categories, and the
generated code for most of them routes through **one** `try/except` in
`micropython/instruments.py`.

### 9.2 The census

Measured by walking the registry after `installCorePalette()`, not by reading.
"Needs" is the set of modules the blocks in that category declare.

| Category | Blocks | Needs | Dialect status | What we do |
| --- | ---: | --- | --- | --- |
| Control | 7 | — | **Both.** `while True:`, `for`, `if`, `break` | Nothing |
| Logic | 6 | — | **Both** | Nothing |
| Maths | 8 | `math`, `random` | **Both** — `ceil`/`floor`/`randint` exist on each | Nothing |
| Text | 4 | — | **Both.** `print`, `str`, `+` | Nothing |
| Lists | 6 | — | **Both** | Nothing |
| Variables | 3 | — | **Both** | Nothing |
| Functions | 5 | — | **Both.** `def`/`return` | Nothing |
| Python (#1018) | 9 | *(user's own)* | **Both by construction** — verbatim text | Nothing; change the import block's `machine` default |
| Turtle | 19 | `turtle` | **Both.** `micropython/turtle.py` imports only `math` and prints | Nothing |
| Wait | 2 | `time` | ~~Split~~ **Done (#1041).** `time.sleep()` both; `wait ms` has a CircuitPython template | — |
| Hardware | 12 | `snakie`, `machine` | **MicroPython** | The shim (§9.4) |
| Instruments | 17 | `instruments`, `snakie`, `machine` | **MicroPython** | The shim, plus #760's note |
| **Total** | **98** | | **68 fine, 1 trivial, 29 real** | |

The headline number is the one worth carrying around: **69% of the palette is
already dialect-neutral**, and it includes the whole of the beginner curriculum.

### 9.3 Turtle is the finding that changes the plan

`micropython/turtle.py` is a *telemetry* library, not a driver: every call
`print()`s one `SNK TURT …` line and the IDE draws the picture. It imports
`math` and nothing else. It runs on CircuitPython unchanged, today.

The blocks course — the entire on-ramp this epic exists to build — is taught in
turtle. So a CircuitPython learner can already do all of it. Whatever we decide
about the hardware palette, **the teaching path is not blocked**, which means
this is not an emergency and does not have to be solved before #1034 ships.

### 9.4 The hardware palette does not emit `machine` — and that is the problem

#1033 assumed the hardware palette is `machine.Pin` / `machine.PWM` /
`machine.ADC`. It is not. Only **three** of 98 blocks import `machine` directly
(`snakie_adc_read`, `snakie_inst_read_adc`, `snakie_inst_i2c_scan`, for `ADC`
and `I2C`). Everything else generates `from snakie import Led, Pin, PWM, Servo,
Buzzer`, and the chain is:

```
snakie_led_set  →  from snakie import Led
micropython/snakie.py:21   from instruments import Servo, Buzzer, Led, Pin, PWM
micropython/instruments.py:84
        try:
            from machine import Pin, PWM
        except ImportError:          # the CPython simulator has no `machine`
            class Pin: ...           # no-op stubs
            class PWM: ...
```

That is **one** place where the dialect is decided, for twelve blocks. Which is
good news for the fix and very bad news for the status quo:

> On a CircuitPython board, `import machine` raises `ImportError`, the `except`
> branch installs the **simulator's no-op stubs**, and `Led(15).on()` returns
> successfully having done nothing.

No traceback, no warning, a program that looks like it ran. That is strictly
worse than a crash, and it is the exact failure epic #209 was written to
prevent. It is also already true — it does not need #1034 to become reachable,
because a learner can type `from snakie import Led` in the Code workspace today.

**This is the one finding in this audit that is a bug rather than a gap.**

*Fixed in #1038.* The runtime is now asked (`sys.implementation.name`) rather
than inferred from a failed import, and every path in `instruments.py` that used
to give up silently — the `Pin`/`PWM` stubs and six more in `Buzzer`,
`Rangefinder`, `Display` and `Servo` — raises a readable error on CircuitPython
while staying inert under CPython, which is what the simulator needs.

### 9.5 Timing is one line

`snakie_wait_seconds` emits `time.sleep(…)`, correct on both. `snakie_wait_ms`
emits `time.sleep_ms(…)`, which CircuitPython does not have — and
`API_EQUIVALENTS`' `delay` row already states the replacement (`time.sleep()`
takes a float; `time.monotonic()` replaces `ticks_ms`).

`instruments.py` is already ahead of this: every `sleep_ms`, `sleep_us`,
`ticks_ms` and `ticks_diff` in it is guarded with `hasattr(time, …)` and a
seconds-based fallback, because the CPython simulator needed it.

**DECIDED (#1041): a per-dialect template**, the same shape §9.7b chose for the
hardware blocks. #1041 offered three fixes and called the portable
`time.sleep(0.5)` the smallest — but it costs the idiom, and `sleep_ms` is what
every MicroPython tutorial writes and what the mirror is meant to show. A second
block costs a second block, for a difference that is a unit conversion. An
inlined `hasattr` ternary is a lot of noise in a beginner's program for one
wait. The template costs none of those: the label still says milliseconds, and
each board gets the call it actually has.

A **literal** is converted at generation time — `time.sleep(0.5)`, which is what
a CircuitPython tutorial writes — while a variable or an expression keeps
`… / 1000`, the only form still correct when the value changes.

### 9.6 What a CircuitPython file actually converts into (measured)

Two canonical Adafruit programs, run through `pythonToBlocks` and back through
`generateProgram`:

**Blink** (`board` + `digitalio`, 10 statements): 7 recognised, 3 raw. The
`while True:` became `forever`, both `time.sleep(0.5)` became **wait** blocks,
the three imports became import blocks, and `led.direction = …` / `led.value =
True` / `led.value = False` became raw Python blocks holding those exact lines.

**Analog + PWM** (`analogio` + `pwmio`, 10 statements): 9 recognised, 1 raw.
`for i in range(10)` became a for-each, `print(pot.value)` became a print block
with a raw value inside, and only `buzzer.duty_cycle = 32768` stayed raw.

So the answer to "what does a CircuitPython `.py` convert into?" is **not** a
stack of grey blocks. It is a mostly-real program with the hardware lines held
verbatim — which is the best outcome available and needs no work at all.

**One caveat, and it is not CircuitPython's:** the round trip is not
byte-identical once imports are involved. The generator's import manager
normalises order and grouping (`import time` is hoisted above `import board`),
and string literals are re-emitted single-quoted. The same is true of a
MicroPython file with its imports out of canonical order — verified with a
control run. #1019's property is "every line survives and still runs", not
"byte-for-byte", and §5 should be read that way.

### 9.7 Does a block declare a `DialectScope`?

**Yes, and almost all of the machinery exists.** `DialectScope` is already
`'both' | 'micropython' | 'circuitpython'` in `src/shared/dialect-api.ts`, and
`inScope(scope, dialect)` already encodes the rule that matters:

```ts
export function inScope(scope: DialectScope | undefined, dialect: Dialect): boolean {
  if (scope === undefined || scope === 'both') return true
  if (dialect === 'unknown') return true
  return scope === dialect
}
```

`unknown` sees everything. A learner with no board plugged in gets the whole
palette — which is the right default for a workspace whose whole point is that
it works on a Chromebook with no hardware.

`helpTreeFor()` in `help-content.ts` is the working precedent: it walks the tree,
drops out-of-scope nodes and prunes branches that lose all their children.
`buildToolbox()` in `BlocksCanvas.tsx` has exactly the same shape over the block
registry, and the canvas already has a toolbox-rebuild path.

**But the filter must go on the TOOLBOX, never on the REGISTRY** — and this
answers #1033's worry that scoping recreates #1008's "newer Snakie" case.
`workspace-check.ts` refuses to mount a canvas containing a block type this
build does not know, precisely so it can never serialise an empty workspace over
somebody's file. If a dialect filter *deregistered* blocks, plugging in a
CircuitPython board would make every existing hardware program unopenable. If it
only hides them from the flyout, an existing file opens and edits normally and
the learner simply cannot reach for a new one. Hide, don't deregister.

The blocks are also the only subsystem left out. `src/renderer/src/lib/blocks/**`
contains **zero** dialect code — two passing mentions in comments, no import of
`shared/dialect`, no `DialectScope`. Meanwhile the help tree, the Monaco
completions, the modules panel, the packages panel, the status bar, the run
controls and the firmware flasher all read `status.runtime?.dialect`. The help
tree already admits the gap: the `blocks-python` article carries
`scope: 'micropython'`.

### 9.7b DECIDED: one block, two templates (#1040)

#1040 asked the question this section left open — *one block emitting two
dialects, or two block sets?* — and it is settled: **one block, with a
per-dialect code template.**

`BlockDefinition` gains an optional `circuitpython: { imports, code }`, and
`installEmitters` picks it when the generator's dialect says so. The block, its
message, its fields and its pin dropdown are unchanged; only what it *writes*
moves.

**Why, in one line:** a learner's program should be a program, not a
program-for-a-Pico.

That is the property the `.py`-with-a-footer format exists for, and two block
sets throw it away — a canvas built in a classroom's MicroPython half would
carry blocks the CircuitPython half cannot reach. With one block it opens, it
runs, and the mirror next door shows exactly what it generated. The objection
in the issue — *"a block whose generated code the learner cannot predict"* —
is answered by the mirror: the code is on screen, beside the block, always.

**The shapes really are different, and the template absorbs it.** `machine.Pin`
says everything in its constructor; `digitalio.DigitalInOut` is built first and
told its `direction` after, and its `value` is an attribute rather than a call.
So `gen.setup()` takes an `after` list — extra lines emitted straight below the
assignment, with `{NAME}` filled in — and a hoisted object stays *one* object
with one key that happens to take two lines to make.

**Pin names come off the board profile.** `board.GP15` and `machine.Pin(15)` are
the same physical hole, and `BlockPin.label` is already the board's own silk
label — `GP15` on an RP2040, `IO15` on an ESP32-S3, `D13` on a Feather. So
`circuitPythonPin()` reads the name that is written on the plastic rather than
imposing a convention.

**Scope is derived, not declared.** A block with a CircuitPython template is
`both`; one without is `micropython`. Saying it twice would mean one copy could
drift, and the copy that drifts is the one hiding a working block from the board
it works on.

**Nine of the twelve.** Servo and buzzer have no CircuitPython *core*
equivalent — they want `adafruit_motor` and `simpleio`, which are third-party
libraries and a different promise — so they stay MicroPython and the toolbox
withholds them. The 17 instrument blocks stay MicroPython too: `instruments.py`
is telemetry over `print()`, which CircuitPython runs happily, but the sensor
reads underneath it are `machine`-based and #1038 made those *degrade* rather
than work. A block that draws an empty oscilloscope is worse than a block the
board never offered.

**Still open after #1040:** the #1058 round-trip reads MicroPython-shaped
constructors only, so a CircuitPython program converts back to raw blocks; and
`blocks-python`'s `scope: 'micropython'` in the help tree stays until the
article's examples are true on both sides.

### 9.8 Where the asterisk goes

> *"Snakie opens any Python file in blocks."*

That sentence is true, with no asterisk, as a statement about **reading**.

The asterisk belongs on **writing**: the hardware and instrument blocks — 29 of
98 — generate code that needs `machine`, and on a CircuitPython board that code
currently fails silently rather than loudly.

### 9.9 One issue or five?

**Four, and only the first is urgent.** They are independent and deliberately
ordered by how much harm each removes. Filed as #1038, #1039, #1040 and #1041.

1. **Make the `machine` shim fail loudly, or not at all** (#1038). `instruments.py`'s
   `except ImportError` cannot keep meaning "we are in the simulator" now that
   CircuitPython also lands there. Detect the runtime (`sys.implementation.name`
   — the same signal `RUNTIME_PROBE_PY` already uses) and either raise something
   a learner can read, or map to `board`/`digitalio`/`pwmio`. **This is a bug
   fix and it is not blocked by anything in this epic.**
2. **Give blocks a `DialectScope` and filter the toolbox** (#1039). `scope` on
   `BlockDefinition`, `inScope` in `categoryContents`, rebuild on dialect change,
   and a category hint saying why a drawer is empty — the same shape as #1017's
   "wire something up in Electronics". Hide, never deregister.
3. **A CircuitPython hardware palette** (#1040). The real work, and the only item with
   any size to it. `API_EQUIVALENTS` already holds the mapping for digital out,
   digital in, analog in, PWM, I²C, SPI, UART, delay and pin names — eleven rows
   that were written for the help tree and turn out to be a specification.
   Whether that is one block emitting two dialects or two blocks is a question
   for that issue; the manifest language from #1017 (`blocks.yml`) suggests one
   block with a per-dialect `code` template.
4. **`snakie_wait_ms`** (#1041). One block, one `hasattr`, or a scoped pair. Trivial,
   listed separately so it is not lost inside (3).

Nothing here blocks #1034, because of §9.3: the course is turtle, and turtle
already works.
