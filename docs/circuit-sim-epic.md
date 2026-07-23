# Circuit Sim — Delivery Plan (Epic #597)

> DC electronic simulation for the Snakie breadboard / Board View.
> Owner: Kevin McAleer. Status: planning. Target: Snakie ≥ 0.36.0 (current `package.json` is `0.35.1`).

This is the staff-engineering delivery plan for the whole Circuit Sim epic: 10 sub-issues
(#600–#609), built in order 1→10. It defines the architecture, the phased roadmap, per-issue
plans grounded in real files, UI/UX design for the visible phases, cross-cutting concerns, the
recommended first PR, and open questions for the owner.

---

## 1. Overview & guiding principles

**What we're building.** A behavioural DC circuit simulator wired into the existing Board View,
so that a breadboard/robot laid out in Snakie *behaves* like the real thing: LEDs light with the
right brightness, an over-current resistor lets the magic smoke out, a multimeter reads a real
voltage between two points, and current visibly *flows* along the wires. It layers on top of the
current live-value polling that already animates the node graph (`board-values.ts`,
`BoardGraph.tsx`).

**The framing: "Tinkercad's consequences + Falstad's visibility, for the Pico."**
- *Tinkercad consequences* — you can break things, and breaking teaches. Magic smoke, post-mortem
  cards, power budgets.
- *Falstad visibility* — you can *see* electricity move: animated current on wires, node-voltage
  colour overlays. We **learn from Falstad, we do not embed it** — Falstad's engine is GPL and this
  is a self-built implementation (per #604: "our own implementation, not embedded").
- *For the Pico* — first-class Pico/Pico 2W parts, the Snakie robot PCB, DRV8833, servos: the parts
  our audience actually wires up.

**Honest simplifications (documented, on purpose).** This is not SPICE.
- **DC steady-state only.** We solve the resting operating point, not transients or AC. No capacitor
  charge curves, no inductor dynamics, no RC time constants.
- **PWM modelled as average duty.** A pin at 50% duty is treated as a steady half-voltage source.
  This is exactly right for the two things our users care about — LED brightness and servo position —
  and wrong for anything needing edges (that's what #608's logic analyser reconstructs separately).
- **Piecewise-linear LEDs, no Newton–Raphson.** Nonlinear parts (LEDs, diodes) use a piecewise-linear
  Vf model rather than iterative nonlinear solving. Simpler, deterministic, testable, fast enough to
  re-solve on every change.
- **Explicit wires only.** Snakie has *no implicit breadboard-strip conductivity* — two pads on the
  same physical row are **not** auto-connected (see §6, and `robot.ts` connection model). The netlist
  is exactly the wires the user drew, plus the "all GND pads are one net" rule.

**Keystone-first strategy.** #600 (netlist extractor + electrical metadata) is a *keystone*: it ships
no visible UI but every later issue consumes it. We land it first, pure and unit-tested, so the
solver (#603), ERC (#601) and everything downstream build on a stable, headlessly-verifiable spine.
The hard build-order constraint is: **#603 (solver) precedes #604/#605/#606/#607**; **#605 precedes
#606**; **#606 feeds #607**.

---

## 2. Architecture

### Data flow

The existing pipeline already carries pin state from the MicroPython WASM interpreter to the board
visuals by **polling** (issue #97): every `POLL_INTERVAL_MS = 800` (`BoardGraph.tsx:223`) the
`useLiveValues` hook (`BoardGraph.tsx:250`) builds one probe snippet (`board-values.ts`
`buildValueProbe`), runs it via `window.api.device.exec`, and parses `<<SNKV>>i:value` lines back into
a `Map<number, LiveValue>` that colours the node cards. Circuit Sim inserts **netlist → ERC/solver →
visuals** into that same cadence.

```
 SIM WORKER (mp.worker.ts)                MAIN / RENDER THREAD
 ┌───────────────────────────┐           ┌───────────────────────────────────────────┐
 │ MicroPython WASM           │  probe    │ useLiveValues (BoardGraph.tsx:250, 800ms)  │
 │  sim-machine.ts Pin/PWM/ADC│ ───text──►│  parseProbeOutput → Map<idx, LiveValue>    │
 │  (pin._v, pwm._duty)       │ <<SNKV>>  │        │                                   │
 └───────────────────────────┘           │        ▼ (pin states + PWM duty)           │
                                          │  ┌─────────────────────────────────────┐  │
 robot.yml (RobotDefinition)             │  │ netlist (#600, PURE)                 │  │
   connections[] ── onChange ───────────►│  │  wiring graph → nodes/nets/parts     │  │
   (WiringCanvas persist / BoardGraph)   │  └───────────────┬─────────────────────┘  │
                                          │                  │ netlist                 │
 part.yml electrical{} (#600/#602) ──────►│         ┌────────┴────────┐               │
                                          │         ▼                 ▼               │
                                          │   ERC (#601, PURE)   ┌──────────────────┐ │
                                          │   ErcIssue[]         │ DC SOLVER worker │ │
                                          │      │               │ (#603, MNA, PURE)│ │
                                          │      ▼               └────────┬─────────┘ │
                                          │  ErcBadge/Panel       node V / branch I   │
                                          │  (dock, #601)                │            │
                                          │                              ▼            │
                                          │   component models (#605/#606) + viz:     │
                                          │   LED brightness, current-flow marquee    │
                                          │   (#604), consequence engine (#607),      │
                                          │   probes/scope/LA instruments (#604/#608) │
                                          └───────────────────────────────────────────┘
```

### Where each piece runs

- **Netlist extractor (#600)** — **pure module, main/render thread.** No DOM, no MicroPython. Input:
  `RobotDefinition.connections` + `BoardDefinition` + placed `PartDefinition`s; output: a netlist
  (nodes/nets/parts/pin-roles). Computed on the same `onChange`/probe seam that already drives
  `useLiveValues`. Pure ⇒ unit-testable under `vitest`/node.
- **ERC (#601)** — **pure module, main/render thread**, mirroring the existing bus-pin diagnostics
  pattern (`board-pin-check.ts:174` `validateBusPins`). Takes the netlist; returns `ErcIssue[]`. No
  simulation needed, so it runs even when nothing is executing.
- **DC solver (#603)** — **dedicated Web/Node worker** (`web/dc-solver.worker.ts`), mirroring how the
  MicroPython sim already runs off-main-thread (`mp.worker.ts`). MNA linear-algebra on a topology +
  pin-state snapshot must never block the UI, and a worker keeps it testable in isolation and
  reusable on web (no SharedArrayBuffer needed — `postMessage` topology in, solution out). This
  matches the "sim must run in a worker" project rule.
- **Component models (#605/#606)** — pure functions consumed by the solver (I–V behaviour) and by the
  render layer (brightness/animation), main-thread for rendering.
- **Consequence engine + power budget (#607)** — main-thread state derived from solver output, with
  persisted "damaged" flags on the robot/session.
- **Probes / current viz / scope / LA (#604/#608)** — main-thread instruments + SVG overlays in
  `BoardGraph.tsx`, fed by solver output and (for #608) by reconstructing edges from PWM duty +
  bus classification (`bus-wires.ts`).

**Key seams to reuse (not invent):**
- Wiring mutation funnel: `WiringCanvas.persist()` → `BoardGraph` `onChange` → `robot:save` IPC
  (`src/main/robot/ipc.ts`). Re-run the netlist here.
- Live-value tick: `useLiveValues` in `BoardGraph.tsx:250` — piggyback the solver kick here.
- Web simulated probe path: `isProbeCode`/`simulateProbeResponse` (`shared/simulation.ts`, used at
  `web-device.ts:127`) — extend for any new probe fields (e.g. PWM duty already available via
  `duty_u16()`).

---

## 3. Phased roadmap

Ten sub-issues, five phases. "User value" = does landing it alone give the user something visible.

| # | Issue | Phase | Goal | Standalone value | Size | Hard deps | Primary files (add / touch) |
|---|-------|-------|------|------------------|------|-----------|------------------------------|
| 600 | Netlist extractor + electrical metadata | **P1 Foundation** *(engine-only)* | Turn wires+parts into a netlist; add `electrical` block to parts | No (keystone) | **M** | — | **add** `src/shared/netlist.ts` (+ `netlist.test.ts`), `PartElectrical` in `src/shared/part.ts`; **touch** `src/shared/part-yaml.ts` (round-trip), `WiringCanvas.tsx`/`BoardGraph.tsx` (re-run hook) |
| 601 | ERC engine + panel | **P2 Rules & Power** *(UI)* | Catch wiring mistakes; badge → issues list | **Yes** | 600 | **M** | **add** `board-erc-check.ts` (+test), `board-erc-diagnostics.ts`, `ErcBadge.tsx`, `ErcIssuesPanel.tsx(.css)`, `CollapsiblePanel.tsx`; **touch** `InstrumentHost.tsx`, `BoardGraph.tsx` |
| 602 | Power inputs: battery packs + bench PSU | **P2 Rules & Power** *(UI)* | Give circuits a source | **Yes** | 600 | **M** | **add** `examples/parts/snakie-standard/battery-*/`, `.../bench-psu-*/`, `PsuInstrument.tsx(.css)`; **touch** `part.ts`/`part-yaml.ts` (electrical), parts seeder |
| 603 | DC solver (MNA) | **P3 Solver** *(engine-only)* | Steady-state node V / branch I | No (engine) | 600, 602 | **L** | **add** `src/shared/dc-solver.ts` (+ vectors test), `web/dc-solver.worker.ts`; **touch** `BoardGraph.tsx` (spawn worker, hold `SolverState`) |
| 604 | Probe tools + current-flow viz | **P4 Visible physics** *(UI)* | Multimeter/clamp + animated current | **Yes** | 603 | **M** | **add** `MultimeterProbeInstrument.tsx`, `ClampInstrument.tsx(.css)`, current-flow SVG overlay in `BoardGraph.tsx`; **touch** `instruments-registry.ts`, `InstrumentHost.tsx` `renderSingleton` |
| 605 | Models: passives + interactive + environment | **P4 Visible physics** *(UI)* | LED/R/pot/LDR/thermistor/button/buzzer behave | **Yes** | 603 | **M** | **add** `src/shared/models/*.ts` (+tests), `EnvironmentPanel.tsx(.css)`; **touch** solver hookup, `BoardGraph.tsx` render |
| 606 | Models: motors + sensors | **P4 Visible physics** *(UI)* | Servo/DRV8833/HC-SR04/SSD1306/BME280 | Partial | 603, 605 | **L** | **add** `src/shared/models/servo.ts` etc., DRV8833 part; **touch** env panel, power-budget feed |
| 607 | Consequence engine + power budget | **P5 Consequence & Learn** *(UI)* | Magic smoke + per-rail budget | **Yes** | 603, 602, 606 | **L** | **add** `consequence-engine.ts`, `PowerBudgetPanel.tsx(.css)`, post-mortem card; **touch** ERC (budget warnings), damaged-state persistence |
| 608 | Virtual logic analyser + scope | **P5 Consequence & Learn** *(UI)* | Decode I2C/SPI/UART; scope any node | **Yes** | 603 (+ existing instruments) | **L** | **add** `LogicAnalyserInstrument.tsx`, `DecodeInstrument.tsx(.css)`, decoders; **touch** `bus-wires.ts` reuse, Data View feed |
| 609 | Pre-flight check + fault-injection challenges | **P5 Consequence & Learn** *(UI)* | Sim↔real diff + challenge mode | **Yes** | 601, 604, robot.yml | **M** | **add** `PreflightPanel.tsx`, challenge manifest format + loader; **touch** ERC, robot.yml |

**Phase summary**
- **P1 Foundation (#600)** — engine-only, ships no UI, is the keystone.
- **P2 Rules & Power (#601, #602)** — first user-visible value: catch mistakes, add a source. Neither
  needs the solver, so they de-risk early and give momentum.
- **P3 Solver (#603)** — engine-only again; the single largest technical lift.
- **P4 Visible physics (#604, #605, #606)** — the "wow": current flows, LEDs glow, sensors respond.
- **P5 Consequence & Learn (#607, #608, #609)** — magic smoke, instruments, curriculum.

---

## 4. Per-issue plan

### #600 — Netlist extractor + electrical part metadata *(keystone, engine-only)*
**Scope.** Convert the wiring graph + board + parts into an electrical netlist (set of nodes and the
part-pins joined to each), and add an `electrical` metadata block to parts so sources can declare
voltage/current/impedance.
**Approach.** Pure module `src/shared/netlist.ts`. Endpoints are strings `"<key>.<pin>#<index>"`; parse
with the existing `parseEndpoint` logic (`WiringCanvas.tsx:859`). Resolve MCU pad index via
`enumerateBoardPads()` (`board-layout.ts`), part pins via `Part.pins[index]`. Apply the two implicit
rules Snakie's model *requires*: **all GND pads collapse to one ground net**; **distinct power rails
stay distinct** (VBUS ≠ VSYS ≠ 3V3 — detect by label with `isGndPad`/`isPwrPad`). Every non-GND
connection is an explicit 2-endpoint edge; 3-way junctions are multiple edges (no junction type
exists). Reuse `classifyBusWire` (`bus-wires.ts:54`) to tag I2C/SPI bus edges. Re-run on the
`WiringCanvas.persist()` / `BoardGraph.onChange` seam.
- **New:** `src/shared/netlist.ts` + `src/shared/netlist.test.ts`; `PartElectrical` interface + `electrical?` on `PartDefinition` (`part.ts`).
- **Extend:** `part-yaml.ts` — coerce `raw.electrical` on read (`num`/range checks), add `electrical: part.electrical` to the `pruneEmpty()` object on write.
- **Risks:** (1) The **sanitiser/whitelist gotcha** — `pruneEmpty()` is a *denylist*; a hand-authored `electrical` sub-field only survives if the coercion explicitly builds it (mirror the krf-sanitiser lesson). (2) Union-find correctness for global GND + multi-edge junctions must be nailed by tests.

### #601 — ERC engine + panel *(UI)*
**Scope.** Static electrical-rules check over the netlist: floating/unconnected power, GND-less parts,
missing I2C pull-ups, VCC↔GND shorts, over-voltage into a 3V3 pin, etc. Surface as a badge on the
board that expands to an issues list with quick-fixes.
**Approach.** Mirror the shipped bus-pin diagnostics three-tier pattern: pure checker
`board-erc-check.ts` (like `validateBusPins` at `board-pin-check.ts:174`) → optional Monaco markers
`board-erc-diagnostics.ts` (owner `'snakie-erc'`, separate from `'snakie-board-pins'`) → dock UI. The
panel lives as the first `DockItem` in `InstrumentDockRegion` (`InstrumentHost.tsx:820`), with an
`ErcBadge` in the dock header. Compute issues on robot/board change like the `DriverInstallBanner`
probe does.
- **New:** `board-erc-check.ts`(+test), `board-erc-diagnostics.ts`, `ErcBadge.tsx`, `ErcIssuesPanel.tsx`(.css), reusable `CollapsiblePanel.tsx`.
- **Extend:** `InstrumentHost.tsx` (dock state), `BoardGraph.tsx` (compute).
- **Risks:** rule false-positives erode trust — keep rules conservative + each issue must carry a plain-English "why this matters". Deciding which rules are `error` vs `warning`.

### #602 — Power inputs: battery packs + bench PSU *(UI, early)*
**Scope.** Add source parts (AA/LiPo/coin battery packs, adjustable bench PSU) with 2 pins (PWR/GND),
electrical specs, and a bench-PSU instrument with V/A display + voltage/current-limit controls.
**Approach.** New parts under `examples/parts/snakie-standard/` (auto-seeded by
`seedStandardLibrary()`), carrying the `electrical` block from #600. Bench PSU also gets a docked
`PsuInstrument` following the multimeter's 7-seg pattern (see §5.2). Batteries are passive parts; the
PSU's live output voltage/limit are instrument state the solver reads as a source.
- **New:** `battery-*/`, `bench-psu-*/` part folders (parts.yml + help.md); `PsuInstrument.tsx`(.css); registry entry.
- **Extend:** `part.ts`/`part-yaml.ts` electrical round-trip (shared with #600), parts seeder mirror to `userData` for `npm run dev`.
- **Risks:** part `electrical` schema must be final before batteries ship (avoid re-authoring). Where the PSU "slides in" (desk-edge UX, §5.2) needs a home in the board area, not just the instrument dock.

### #603 — DC solver (MNA) *(engine-only, the heart)*
**Scope.** Modified Nodal Analysis DC steady-state solve over the netlist; event-driven re-solve;
PWM-as-average-duty; piecewise-linear LEDs; pure + unit-tested with known-answer circuits.
**Approach.** Pure `src/shared/dc-solver.ts`: build the MNA conductance matrix + source vector from
the netlist and current pin/PWM/source states, solve the linear system (Gaussian elim / LU — small,
dense, few dozen nodes). Nonlinear parts injected as piecewise-linear segments chosen by operating
region (no Newton iteration). Run inside `web/dc-solver.worker.ts`; `BoardGraph` spawns it on mount,
posts `{topology, pinStates}` whenever `useLiveValues` detects a change, and holds the returned
`SolverState { nodeVoltages, branchCurrents }`.
- **New:** `dc-solver.ts` (+ vectors test with hand-computed answers), `web/dc-solver.worker.ts`.
- **Extend:** `BoardGraph.tsx` — worker lifecycle + `SolverState` + change-detection on probe output.
- **Risks:** (1) singular/ill-conditioned matrices (floating nodes, no reference GND) — must degrade gracefully, not NaN-crash the UI. (2) Choosing PWL breakpoints so LED brightness *looks* right across colours.

### #604 — Probe tools + current-flow visualisation *(UI)*
**Scope.** Multimeter (click two points → voltage), clamp (click a wire → current), both docked like
instruments; animated moving-marquee current on wires (dashes travelling − → +), thickness/speed =
magnitude, direction shown; node-voltage colour overlay toggle.
**Approach.** Two new singleton instruments registered in `instruments-registry.ts` and rendered via
`renderSingleton` (`InstrumentHost.tsx:961`), reading `SolverState`. Current animation is a new SVG
overlay `<g>` in the `BoardGraph` canvas: per-wire `stroke-dasharray` with an animated `dashoffset`
(CSS/RAF), stroke-width and animation-duration bound to `|branchCurrent|`, dash direction from current
sign. Self-built — **do not embed Falstad (GPL)**; we borrow the *visual language*, not the code.
- **New:** `MultimeterProbeInstrument.tsx`, `ClampInstrument.tsx`(.css), current-flow overlay + CSS.
- **Extend:** `instruments-registry.ts`, `InstrumentHost.tsx` switch, `BoardGraph.tsx` render + click-to-probe hit-testing.
- **Risks:** two-point probe hit-testing on the node graph (which pad did you click?). Animation perf with many wires — throttle to solver cadence, animate in CSS not React.

### #605 — Models: passives + interactive + environment *(UI)*
**Scope.** LED (brightness ∝ current, colour-correct Vf), resistor, potentiometer (drag),
LDR + thermistor driven by an environment slider panel (light, temperature), button/switch with
pull-up/down awareness, buzzer (active vs passive).
**Approach.** Pure model functions in `src/shared/models/*` returning I–V behaviour for the solver and
a render hint (brightness, sounding). Environment panel is a small docked/side panel whose sliders set
global `light`/`temp` that LDR/thermistor models read. Interactive parts (pot drag) mutate a model
parameter → trigger re-solve on the existing change seam.
- **New:** `models/led.ts`, `resistor.ts`, `potentiometer.ts`, `ldr.ts`, `thermistor.ts`, `button.ts`, `buzzer.ts` (+tests); `EnvironmentPanel.tsx`(.css).
- **Extend:** solver model dispatch, `BoardGraph` LED-glow overlay (HSL by Vf + brightness).
- **Risks:** colour-correct LED Vf table; making "asserted vs off" read clearly on both dark & light skins (theme-variant rule).

### #606 — Models: motors + sensors *(UI)*
**Scope.** Servo current model (idle/moving/stall) feeding the power budget; DRV8833 as a first-class
part (pairs with the Pico 2W robot PCB); HC-SR04, SSD1306, BME280 behavioural models tied to the
environment panel.
**Approach.** Extend the model layer with active parts. Servo draw is state-dependent and exported to
#607's budget. DRV8833 gets a part + a small internal model (inputs → output channel voltages).
Sensor models produce values the running MicroPython would read (I2C/echo timing), coordinated with
the env panel.
- **New:** `models/servo.ts`, `models/drv8833.ts`, `models/hcsr04.ts`, `ssd1306.ts`, `bme280.ts`; DRV8833 part folder.
- **Extend:** env panel inputs, servo↔joint binding is already a spine (`servo-bind.ts`) — reuse for draw mapping; power-budget feed.
- **Risks:** scope creep toward "emulating the chip" — keep behavioural. Servo stall current is the number that drives magic smoke, so its default matters.

### #607 — Consequence engine + power budget *(UI)*
**Scope.** Magic-smoke mode (on in sandbox, off in guided): over-current parts visibly fail (LED pops,
GPIO dies) with animation + one-click reset; damaged state persists until reset; post-mortem card
(what/why/prevention). Power budget panel: per-rail draw, worst-case all-servos-stall, battery-life
estimate; budget warnings surface in ERC.
**Approach.** `consequence-engine.ts` watches solver branch currents vs each part's rated max; on
breach it flips a damaged flag (persisted on the session/robot), swaps the render to a failed state,
and emits a post-mortem. Power budget derives per-rail sums from solver output + source `electrical`
specs (#602) + servo draw (#606); `PowerBudgetPanel` shows it and pushes an ERC issue when a rail
exceeds its source.
- **New:** `consequence-engine.ts`, `PowerBudgetPanel.tsx`(.css), post-mortem card component, damaged-state persistence.
- **Extend:** ERC (budget warnings), `BoardGraph` failed-part rendering, mode plumbing (sandbox/guided).
- **Risks:** damaged-state persistence surface (session vs robot.yml — probably session, to avoid polluting saved wiring). Undo/reset must be truly one-click.

### #608 — Virtual logic analyser + scope probe *(UI)*
**Scope.** Logic analyser decodes I2C/SPI/UART on any wire, feeding existing instruments + Data View;
scope probe on any node (DC + PWM-duty representation).
**Approach.** New instruments styled on the phosphor-screen chrome + a decoded-frame table (see §5's
instrument-styling notes). Bus identity from `classifyBusWire`/`bus-wires.ts`; frame reconstruction
from the sim's I2C/SPI/UART calls (the sim buses are currently no-ops in `sim-machine.ts` — this is
where they gain observable traffic). Scope reads node voltage from `SolverState` and PWM duty (already
available via `duty_u16()` in `board-values.ts`).
- **New:** `LogicAnalyserInstrument.tsx`, `DecodeInstrument.tsx`(.css), protocol decoders.
- **Extend:** `sim-machine.ts` bus classes to record traffic; Data View feed.
- **Risks:** biggest departure from "DC steady-state" — decoding needs *events*, so this reconstructs a transaction log rather than sampling waveforms. Keep it a decode table, not a true timing engine.

### #609 — Pre-flight check + fault-injection challenges *(UI)*
**Scope.** Pre-flight: before flashing real hardware, diff sim wiring + ERC against `robot.yml`
("sim has I2C pull-ups — does your desk?"). Fault-injection challenge mode: teacher ships a pre-broken
circuit, student diagnoses with the multimeter, per-challenge success criteria.
**Approach.** Pre-flight reuses the netlist (#600) + ERC (#601) results and compares against the saved
`robot.yml`, presenting a diff panel gated in front of flashing. Challenge mode adds a manifest format
(a broken robot.yml + hidden fault + success predicate) loaded into a guided session; the multimeter
(#604) is the diagnosis tool; success is evaluated against the predicate.
- **New:** `PreflightPanel.tsx`, challenge manifest schema + loader, success-criteria evaluator.
- **Extend:** ERC results consumption, flashing entry point (insert pre-flight gate), guided-mode plumbing.
- **Risks:** authoring UX for challenges (out of scope to build an editor now?). Defining "success criteria" expressively but safely (no arbitrary code exec).

---

## 5. UI/UX design for the visible phases

Conventions to reuse across all three (from instrument-styling + board-view research):
- **Shared instrument chrome** — every instrument gets `InstrumentWindow` chrome for free: `.instr`
  (404px brushed body), `.instr__bar` (drag title), `.instr__bezel` + `.instr__screen` (green phosphor;
  `--blue` variant for scope). You only style the body between bezel and readout strip.
- **Unique BEM prefix per panel** — instrument CSS is **global**; pick a unique 3–5 letter prefix
  (`psu__`, `clamp__`, `erc__`, `decode__`) to avoid the i2cd-style collision.
- **Theme tokens** — must work in **both** dark & light skeuomorph (never hardcode dark-only). Use
  `--panel`, `--card`, `--text`, `--text-muted`, `--bg-sunken`, `--accent` (highlight text = `var(--accent)`,
  never gold `#c8a24a`). New ERC severity tokens: `--erc-error`, `--erc-error-bg`, `--erc-warning`,
  `--erc-warning-bg`.
- **Two board views parity** — the board view exists twice (in-window `BoardPane` + pop-out
  `board-main`); any overlay/badge added to one must be wired to both (props are optional and silently
  diverge — this bit us before).

### 5.1 · #601 ERC — badge → expandable issues list

Discovery pattern mirrors the shipped bus-pin diagnostics + `DriverInstallBanner` expandable list.
A small **badge** sits in the dock header (count + worst-severity colour). Clicking it expands a
`CollapsiblePanel` of issue cards. Each card is a single plain-English warning with a "why this
matters" explainer and, where possible, a one-click fix (same code-action muscle as
`board-pin-diagnostics.ts`).

```
 Dock header
 ┌───────────────────────────────────────────────┐
 │ [MiniBoard]        ⚠ ERC 2 · ⓘ 1     [+ Add]   │   ← ErcBadge: count + severity dot
 └───────────────────────────────────────────────┘
 ┌───────────────────────────────────────────────┐
 │ ▼ Electrical Rules Check           ⚠2  ⓘ1     │   ← CollapsiblePanel header
 │ ┌───────────────────────────────────────────┐ │
 │ │ ⚠  I2C bus has no pull-up resistors        │ │   severity glyph + message
 │ │    SDA/SCL float without pull-ups; the bus │ │
 │ │    may read garbage on real hardware.      │ │   ← "why this matters" explainer
 │ │    Why it matters: most breakout boards     │ │
 │ │    include pull-ups, but a bare bus needs   │ │
 │ │    ~4.7kΩ to 3V3.        [ Add pull-ups ▸ ] │ │   ← quick-fix (code action)
 │ ├───────────────────────────────────────────┤ │
 │ │ ⛔  VCC shorted to GND at node N4           │ │   ← error (red)
 │ │    A wire joins 3V3 directly to GND.        │ │
 │ │    Why it matters: this is a dead short —   │ │
 │ │    on real hardware it browns out or blows. │ │
 │ ├───────────────────────────────────────────┤ │
 │ │ ⓘ  GP15 drives an LED with no resistor      │ │   ← info/warning
 │ │    Add a current-limiting resistor (~330Ω). │ │
 │ └───────────────────────────────────────────┘ │
 └───────────────────────────────────────────────┘
```

- **Severity levels:** `error` (⛔, `--erc-error`) = will damage / won't work; `warning` (⚠,
  `--erc-warning`) = likely wrong / risky; `info` (ⓘ, `--text-muted`) = advisory/best-practice.
- **Components/tokens:** new `CollapsiblePanel.tsx` (reused later by budget/preflight); `ErcBadge.tsx`
  styled like the driver banner head; prefix `erc__`; row states `erc__row--error|--warning|--info`.
- Optional Monaco squiggle in the editor (owner `'snakie-erc'`) for issues that map to a code line
  (e.g. a bus constructed on the wrong pins), sharing the code-action provider muscle.

### 5.2 · #602 Bench PSU — desk-edge unit + battery library

The bench PSU **slides in from the top edge** of the blueprint/board area — a "reach up to the shelf
above your desk" metaphor — rather than living only in the instrument dock. It has a seven-seg V/A
display and voltage / current-limit controls, and exposes exactly **2 pins (PWR / GND)** to wire down
onto the board.

```
        ┌═══════════════════════════════════════════┐  ← unit docked to top edge (slides down)
        ║  BENCH PSU              ⏻  [ CV ] [ CC ]   ║
        ║  ┌───────────────┐   ┌───────────────┐     ║
        ║  │  3.30 V       │   │  0.142 A      │     ║   ← .psu__seg 7-seg (DSEG7),
        ║  │  8.8.8. ghost │   │  8.8.8. ghost │     ║     ghost backing for layout stability
        ║  └───────────────┘   └───────────────┘     ║
        ║   VOLTAGE  ◀──●────▶   LIMIT  ◀────●──▶     ║   ← set-voltage + current-limit sliders
        ║                         ( ● )+   ( ● )−     ║   ← 2 output pins: PWR / GND
        └───────╥═══════════════════════╥════════════┘
                ║ (+)                    ║ (−)
   ┌────────────╨────────────────────────╨───────────────┐
   │  blueprint / board area — wires drop from PSU pins   │
   │                                                      │
```

- **Seven-seg:** reuse the multimeter precedent (`Multimeter.css` `.dmm__seg` — ghost `8.8.8` backing +
  live value, `DSEG7-Classic` font). New prefix `psu__` (`.psu__seg`, `.psu__seg-ghost`,
  `.psu__seg-live`, `.psu__readouts`, `.psu__cell-lbl`/`.psu__cell-val`). CV/CC annunciators light like
  the DMM's LCD annunciators.
- **Controls:** voltage set-point + current-limit are the two live knobs the solver reads as the
  source spec (feeds power budget #607). CC (current-limit reached) is a state the consequence engine
  can also surface.
- **Battery parts in the library:** batteries are ordinary parts in the Parts panel (family `Power`,
  tags `battery`/`lipo`/`aa`), no special rendering — they show with image + name like any other and
  drag onto the board. Their spec lives in the part's `electrical` block (voltage, range, maxCurrentA,
  impedanceOhms). A battery's 2 pins (`+`/`-`) wire straight in; the solver treats it as a source with
  internal `impedanceOhms`, enabling battery-life estimates in #607.

### 5.3 · #604 Probe tools + current-flow visualisation

Two docked instruments plus a wire animation overlay. Learn from Falstad's visual grammar; **build our
own** (Falstad is GPL — no embedding, no code lift).

**Multimeter (two-point voltage) & Clamp (per-wire current):**

```
 ┌─ MULTIMETER ──────────┐     ┌─ CLAMP METER ─────────┐
 │  ▓▓ phosphor screen ▓ │     │  ▓▓ phosphor screen ▓ │
 │   3.28 V              │     │   142 mA  →           │   ← direction arrow
 │   ── click 2 nodes ── │     │   ── click a wire ──  │
 │  ┌─────┐  ┌─────┐     │     │  bar ▓▓▓▓▓▓░░░░ 30%   │   ← magnitude bar
 │  │(red)│  │(blk)│     │     │  peak 0.19A  avg 0.12 │   ← reuse .dmm__readouts cells
 │  └─────┘  └─────┘     │     └───────────────────────┘
 └───────────────────────┘
   probe A ● … ● probe B  (highlighted pads on the board)
```

**Current-flow on wires** — a moving marquee of dashes travelling **− → +** along each conducting
wire:

```
   GND ●────‹ ‹ ‹ ‹ ‹ ‹────● +      thin line, dashes crawl slowly   → small current
   GND ●══‹‹ ‹‹ ‹‹ ‹‹ ‹‹══● +      thick line, dashes crawl fast    → large current
       (arrows/dash tips point toward +, i.e. conventional current direction)
```

- **Encoding:** `stroke-width` ∝ `|current|`; animation speed (dash `dashoffset` rate) ∝ `|current|`;
  dash travel direction = current sign; zero current = static, dim. Colour: a warm red thread (matches
  the #604 "pulsing red thread" note) over the wire's own colour.
- **Implementation:** a dedicated SVG `<g class="cflow">` layer in `BoardGraph.tsx`, one animated path
  per conducting edge, `stroke-dasharray` + CSS `@keyframes` translating `stroke-dashoffset` (animate in
  CSS, not React, and re-parameterise only on solver ticks to keep it cheap). A separate toggle adds a
  **node-voltage colour overlay** (rail-to-rail gradient) tinting pads by `nodeVoltage`.
- **Instruments:** register in `instruments-registry.ts`, render via `renderSingleton` switch. Reuse the
  DMM right-column readout pattern (`.dmm__readouts`: big-num + bargraph + min/max/avg cells); new
  clamp prefix `clamp__`. Two-point probe uses board pad hit-testing; highlight the two chosen pads.

---

## 6. Cross-cutting concerns

**Persistence & the sanitiser gotcha.** The `electrical` block round-trips through `part.ts` →
`part-yaml.ts`. `pruneEmpty()` is a **denylist** (drops empty/undefined), *not* a whitelist — so a new
electrical sub-field only survives a save→load if the parse path **explicitly coerces it** and the
serialise path **explicitly lists it** in the `pruneEmpty({...})` object. This is the same class of bug
as the krf `sanitiseRobotModel` whitelist: add the field in *both* directions or it's silently dropped.
Damaged/consequence state (#607) should persist on the **session**, not `robot.yml`, so saved wiring
stays clean. Netlist and solver output are **derived** and never persisted.

**Desktop vs web parity.** Everything electrical is pure/main-thread + a worker, so it runs identically
on desktop and web. The web path already fakes probes (`isProbeCode`/`simulateProbeResponse` at
`web-device.ts:127`); any new probe fields (PWM duty, future current) must be mirrored there so web
doesn't diverge. The DC solver worker uses `postMessage` only (no SharedArrayBuffer) so it works on
GitHub Pages. And: the board view exists twice (`BoardPane` + `board-main`) — overlays/badges must be
wired to both.

**Testing strategy.** The two keystones are **pure and vector-tested**: `netlist.test.ts` (known
wirings → expected nets, incl. global-GND collapse and multi-edge junctions) and `dc-solver` known-answer
circuits (voltage divider, LED+resistor, parallel loads — hand-computed expected node V / branch I).
ERC rules each get a pure fixture test. Component models get I–V unit tests. Run headlessly:
`npm test` (vitest) for TS, `PYTHONPATH=python python3 -m unittest` for any host-side. Keep `lint`,
`typecheck`, `test`, `build` green per CLAUDE.md. UI-level flows verified via the `verify` skill
(headless Chromium / renderer preview).

**Performance — event-driven re-solve.** Never solve per-frame. Re-solve only on **topology change**
(the `persist`/`onChange` seam) or **pin-state change** (detected by diffing `parseProbeOutput` results
against the previous tick in `useLiveValues`). Current animation runs in CSS, re-parameterised only on
solver ticks (~≤800ms cadence). The solver is off-main-thread so a slow solve never janks the UI.

**Sandbox vs guided mode.** Magic smoke (#607) is **on by default in sandbox**, **off in guided**.
This mode flag also gates: pre-flight strictness (#609), whether ERC errors block flashing, and
challenge mode. Thread a single `simMode: 'sandbox' | 'guided'` through the board/session state and
read it in the consequence engine, ERC gating, and pre-flight.

---

## 7. Recommended first PR (#600)

**Land the pure netlist extractor + the `electrical` metadata round-trip — no UI.**

**In scope:**
- `src/shared/netlist.ts` — pure function `buildNetlist(robot, board, parts) → Netlist`. Resolves
  endpoints via `parseEndpoint` semantics, collapses all GND pads to one net, keeps power rails
  distinct, emits explicit edges (multi-edge for junctions), tags bus edges via `classifyBusWire`.
  Exports typed `Netlist` (nodes, nets, part-pin membership, bus tags).
- `src/shared/netlist.test.ts` — vectors: single LED+resistor, I2C device (SDA/SCL bus tag), a 3-way
  junction (→ multiple edges, one net), two GND pads on different headers (→ one ground net), a distinct
  VBUS vs 3V3 (→ two nets). Hand-authored expected output.
- `PartElectrical` interface + `electrical?: PartElectrical` on `PartDefinition` (`src/shared/part.ts`).
- `part-yaml.ts`: coerce `raw.electrical` on read (num + `[min,max]` range validation, drop garbage);
  add `electrical: part.electrical` to the `pruneEmpty({...})` write object.
- `src/shared/part-yaml` round-trip test proving an `electrical` block survives read→write→read.

**Deliberately NOT in scope:** the solver, any ERC rules, any UI/badge/panel, any parts (batteries/PSU),
any wiring to `BoardGraph`'s render or the `onChange` re-run hook beyond what a unit test needs. #600 is
a library + its tests; nothing user-visible changes.

**Headless verification:**
- `npm run typecheck` and `npm run lint` clean.
- `npm test` — `netlist.test.ts` + the part-yaml round-trip test green.
- No Electron/display needed; both modules are pure. Confirm `npm run build` still bundles.
- Bump `package.json` PATCH? — no: #600 adds a feature capability (netlist) but ships no user feature;
  version bump lands with the first user-visible phase (#601/#602 → MINOR). Keep #600's PR versionless
  or note it for the batch.

---

## 8. Open questions for the project owner

1. **Breadboard rows as implicit nodes?** Today Snakie models *explicit wires only* — two pads on the
   same physical breadboard row are **not** auto-connected. Real breadboards conduct along rows/rails.
   Do we keep "explicit wires only" (simpler, matches current model), or teach the netlist to treat
   breadboard rows/rails as implicit nodes (more realistic, larger change)? Recommendation: explicit-only
   for the epic; revisit if users trip on it.
2. **Which battery chemistries / packs first (#602)?** Proposed starter set: 3×AAA (4.5V), 4×AA (6V),
   single LiPo (3.7V), 2S LiPo (7.4V), CR2032 coin (3V), plus the adjustable bench PSU. Agree the list
   and nominal/impedance defaults (they drive battery-life + brown-out behaviour).
3. **Magic-smoke default per mode (#607).** Plan: **on in sandbox, off in guided**. Confirm — and should
   a first-time sandbox user get a one-time "things can break here" heads-up + a global off switch?
4. **Damaged-state persistence.** Persist "blown" parts on the **session only** (my recommendation) so a
   reload/reset heals them and saved `robot.yml` stays clean — or should damage survive a reload?
5. **Servo stall-current defaults (#606).** The stall figure drives budget warnings and magic smoke.
   Do we ship a conservative generic (e.g. SG90 ~650mA stall) and let parts override via `electrical`?
6. **#608 scope creep.** The logic analyser needs *events*, which stretches "DC steady-state." Confirm
   we ship it as a **decoded-transaction table** (reconstructed from sim bus calls), not a timing-accurate
   waveform engine.
7. **#609 challenge authoring.** For v1, do teachers author challenges by hand-editing a manifest +
   broken `robot.yml`, or do we need an in-app authoring UI (larger)? Recommendation: manifest-only v1.
8. **PSU desk-edge home.** Does the "slide in from the top edge" PSU live in the in-window board area,
   the pop-out board window, or both? (Parity concern — see §6.)
