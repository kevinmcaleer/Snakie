# Blocks: classes, methods and properties — Delivery Plan (Epic #1206)

> How a learner builds their own type in Blocks, how the reader opens somebody
> else's, and what the ratchet says about both.
> Owner: Kevin McAleer. Status: **track B in flight** — B1 (#1220) and the
> `level:` key (#1213) merged; B3/B4/B5 open as #1238/#1236/#1237; B2 (#1221)
> not started. This document is B6 (#1225) and is written to stay true either
> way: everything below says what has landed and what has not.

---

## 1. Why classes needed an epic of their own

Two epics ran at this before and each left the same half undone.

- **#1086 (`blocks-coverage-epic.md`)** taught the *reader* about classes — W6's
  "class cluster" — and it worked: a `class` header, a `def name(self)` and a
  `self.x = …` have all opened as real blocks since then. §4.3 and §4.4 of that
  document are still the law here (`self` is not a variable; a class is a hat
  that holds a body).
- **#1119 (`blocks-language-epic.md`)** asked the *authoring* question — "can a
  learner say it in blocks at all?" — and answered it for dictionaries, slices,
  bitwise maths and a dozen other things. It explicitly did **not** answer it
  for classes: `snakie_class`, `snakie_method` and `snakie_self` stayed
  `hidden: true`, which §4.2 of that document calls "a decision, not a default".

So classes arrived at this epic **readable and unbuildable**, which is the worst
of the three states: Snakie understood a learner's class perfectly and gave them
no way to write one. Everything in track B is closing that gap, and track C
(simple/advanced levels) exists because closing it puts six more blocks in front
of a nine-year-old who does not need them yet.

---

## 2. What is on the Classes shelf

| Block | Writes | Where | Status |
| --- | --- | --- | --- |
| `snakie_class` | `class Robot(Base):` | Functions ▸ Classes | **merged** (#1220) |
| `snakie_self` | `self` | Functions ▸ Classes | **merged** (#1220) |
| `snakie_super` | `super()` | Functions ▸ Classes | **merged** (#1220) |
| `snakie_method` | `def drive(self, speed):` | Functions ▸ Classes | registered; **B2 (#1221) still owes it a real parameter mutator** |
| `snakie_property` | `@property` + optional `@name.setter` | Functions ▸ Classes | open as #1238 (B3) |
| `snakie_self_attr_get/set`, `snakie_attr_get/set` | `self.speed`, `robot.speed` | Functions ▸ Classes | open as #1236 (B4) |
| `snakie_new_instance` | `Robot("Bob", speed=3)` | Functions ▸ Classes | open as #1237 (B5) |
| `decorators` on `def`/method | `@micropython.native` | the block's cog | open as #1235 (A1) |

All of them are `level: 'advanced'` (#1209), so a fresh profile does not see the
shelf at all and **Settings ▸ Appearance ▸ Advanced blocks** — or the in-toolbox
switch, C3/#1234 — brings it back.

---

## 3. The three open questions, answered

The epic listed three. All three now have an answer that shipped or is shipping.

### 3.1 Is `Classes` its own category, or a shelf inside `Functions`?

**A shelf inside Functions** (decided in #1220, merged). A sixteenth top-level
drawer for three blocks would be the widest change for the smallest content, and
a class *is* a way of organising functions — a learner arriving at it comes from
`def`. The shelf carries a `BlockGroup.hint`, a one-line sentence at the top of
the flyout saying what it is for, which is new to this epic and is now available
to any group.

It forced one fix that was worth having on its own: Blockly's `custom` category
**replaces** a drawer's contents, so `snakie_return` and `snakie_super` had been
registered in Functions and reachable from nowhere since #1045.
`functions-drawer.ts` now puts Blockly's dynamic caller list first and the
registry's own entries after it, the way the Variables drawer already did.

### 3.2 Should the cog be replaced by a Snakie-owned popover?

**No — extend Blockly's mutator** (decided in #1215/#1235). `installDecorators()`
*wraps* whichever serialisation hooks a block already has rather than replacing
them, so Blockly's own parameter bookkeeping and caller renaming carry on
untouched. A Snakie-owned popover would have had to reimplement all of that to
gain a list of strings. If the cog UI (A3, #1217) proves too cramped for
parameters *and* extras *and* decorators, that is the moment to revisit it — not
before.

### 3.3 Is "simple" the default for everyone?

**Simple for a fresh profile, advanced for any profile that already has a
`snakie.*` key**, written to storage the first time so it cannot drift (decided
and shipped in #1210). Nobody who was using Snakie loses a drawer; nobody
starting today has to scroll past `try`.

### 3.4 And a fourth, decided along the way

**`staticmethod`/`classmethod` are decorator entries, not a dropdown.** The old
`snakie_method` carried `@property`/`@staticmethod`/`@classmethod` as a field.
A1 (#1235) migrates that field to a list of one and keeps it readable, and B3
(#1238) takes `@property` off it entirely, because a *settable* property is two
`def`s whose names must agree — something a modifier dropdown cannot express.
One mechanism instead of two.

---

## 4. The measurement (B6, #1225)

### 4.1 What was added

Four fixtures in `test/fixtures/coverage/`, each real MicroPython somebody would
write rather than a sample built to make a recogniser pass (the corpus README's
rule):

| Fixture | What it is in for |
| --- | --- |
| `motor_driver.py` | `__init__`, six `self.x = …` lines, two instances built, methods called on them |
| `thermostat.py` | a `@property` with an `@name.setter`, a class constant, `self._target` |
| `blinker_subclass.py` | inheritance, `super().blink(1)`, `@staticmethod`, an overridden method |
| `node_queue.py` | two classes in one file, `obj.x` get *and* set on someone else's object, `None` checks |

### 4.2 The numbers

Whole corpus, before and after the four files:

| | before | after |
| --- | --- | --- |
| files / logical lines | 43 / 679 | **47 / 774** |
| statements | 98.53% (10 raw) | **98.58% (11 raw)** |
| sockets | 83.88% (78/484 grey) | **83.70% (90/552 grey)** |
| clean files | 11/43 — 25.58% | **11/47 — 23.40%** |

And the new slice the ratchet now asserts on its own — the fifteen fixtures with
a `class` header in them:

> **15 files · 321 lines · statements 99.38% · sockets 88.18% (26/220 grey) ·
> clean 3/15.**

Floors moved as follows, each argued beside the constant it sits on in
`test/blocksCoverageRatchet.test.ts`:

- `STATEMENT_FLOOR` **98, unchanged**.
- `SOCKET_FLOOR` **81 → 82**. The floor had been left two and a half points
  under the measurement since #1119 and the class files show the headroom is
  real.
- `CLEAN_FILE_FLOOR` **24 → 23**, *lowered on purpose*. The same eleven files
  are clean; the denominator grew by four that are not, because a class-heavy
  file always constructs something and a constructor call is a grey socket until
  B5. A corpus that may only gain files the reader already handles measures the
  reader against itself, and this ratchet was written to allow the trade as long
  as it is made out loud.
- New: `CLASS_STATEMENT_FLOOR` **99** and `CLASS_SOCKET_FLOOR` **87** over the
  class slice, plus a shape assertion — *every* `class` header in the corpus
  reads as a real `snakie_class` block, so a reader change that quietly demoted
  one to grey fails a test instead of a learner.

---

## 5. B4 does not move the socket number, and that is a gap in the ratchet

Reported by one of the track's authors, and **verified here rather than taken on
trust**, because it is the sort of claim that would excuse a missing number.

It is true. `rawSockets` is incremented in exactly one place in
`python-to-blocks.ts` — the single `expression()` door every value socket is
filled through — and only for a type in `GREY_VALUE_TYPES`, which holds exactly
two: `snakie_python_value` and `snakie_python_call_value`. The attribute pair
`snakie_python_attr_get` / `snakie_python_attr_set` is in neither set, and
`attr_set` is a *recognised* statement. Measured on the new fixture:
`motor_driver.py` reports `raw: 0` with six `self.x = …` lines in it, and none
of its four grey sockets is an attribute.

So B4 (#1236) — arguably the largest single readability win in the track, since
`self.x` is the second-commonest theme in the corpus after method calls — is
invisible to all three headline numbers.

**What follows from it.** Not that B4 is worth less; that the ratchet counts
greyness and the attribute blocks were never grey, only *coarse*: `self.speed`
opened as a block in the Python drawer, named after the language rather than
after what it does. That is a different failure and the ratchet was never asked
to measure it.

Two options were considered for closing the gap and **neither is being taken in
B6**:

1. **Add the attr pair to `GREY_VALUE_TYPES`.** It would make B4's win visible
   and would retroactively *lower* every historical socket number in this
   document and in the #1086 delivery plan, making the published series
   dishonest. Rejected.
2. **Count "Python-drawer blocks" as a fourth number**, beside grey. Defensible,
   and the right home for it is a follow-up with its own before/after, not a
   footnote in the epic that would benefit from it. Not filed yet.

What B6 does instead is put the constructions B5 *will* fix into the denominator,
so at least one member of the class cluster is measured on its way in:
`Motor(14, 15)`, `Queue()`, `Thermostat(19.5)` are grey sockets today.

---

## 6. What the class fixtures still leave grey

Eleven greys across the four files, every one of them a known thing:

| Still grey | Owner |
| --- | --- |
| `Motor(14, 15)`, `Queue()`, `Node(value)`, `Thermostat(19.5)`, `QuietBlinker(25)` | **B5 (#1237)** — becomes `snakie_new_instance` |
| `@target.setter` (a grey *statement*) | **B3 (#1238)** — folded into the property block |
| `super().blink(1)` used as a statement | unowned; `super()` is a value block, calling a parent method as a statement is not modelled |
| `left.drive(30000)`, `jobs.push("scan")` — method calls on an instance | by design: the Python drawer's call block, and #1007's module blocks cover the *library* case |
| `PWM(Pin(pin_a))`, `Pin(pin, Pin.OUT)` | hardware constructors — #1007's own territory |
| a float written `21.0` | out of scope, and *interesting*: the reader refuses a number block for it because the generator would write `21` back and round-trip is not negotiable. The fixtures avoid trailing-zero floats rather than pretend |

---

## 7. What is left in the track

- **B2 (#1221)** — rebuild `snakie_method` on the real parameter mutator and
  migrate the free-text `PARAMS`. The largest piece still unstarted, and the one
  that makes the method block feel like the `def` block.
- **A2/A3 (#1216/#1217)** — the reader side of decorators and the cog UI.
- **A5/#1219, C6/#1214** — the course step, once there is something to teach.
- The fourth ratchet number from §5, if somebody wants the attribute win counted.

Nothing here blocks a release: every block in §2 that has landed round-trips,
and the reader has been ahead of the toolbox since #1086 — which, as §4.5 of
that document puts it, is the way round it should be.
