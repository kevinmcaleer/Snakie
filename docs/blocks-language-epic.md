# Blocks: the missing language — Audit & Delivery Plan (Epic #1119)

> Which MicroPython language features a learner still cannot *build* in Blocks,
> and which of them should become native blocks.
> Owner: Kevin McAleer. Status: **audited** — fifteen sub-issues filed and linked
> to epic #1119 (#1120–#1128, #1130–#1135).
>
> **#1118 landed between the audit and this document**, shipping the cast block
> (`turn %1 into %2`) and a `global` block with a variable field. #1130 and #1133
> are narrowed to what those two do not cover, and §2's Variables row counts
> them. Nothing else here is implemented.

---

## 1. Why this is a different question from #1086

Epic #1086 (`blocks-coverage-epic.md`) asked **"can the reader understand the
MicroPython people already wrote?"** and answered it: 54.67% → 97.94% of logical
lines on the fixture corpus, with fourteen lines left grey and every one of them
a recorded decision.

This epic asks the other question: **"can a learner say it in blocks in the
first place?"** The two are not the same, and conflating them is the mistake
this document exists to avoid.

- A construct can be **readable and unbuildable**. `try`, `with`, `raise`,
  `class` and tuple assignment are all registered today with
  `hidden: true`, which is #1086 §4.5 working as designed: *"the toolbox is
  curated, the reader is comprehensive."* The reader emits them; no learner can
  drag one.
- A construct can be **buildable and unreadable**. That is the asymmetry W2
  (#1089) closed and `blocksPaletteSymmetry.test.ts` now guards.
- And a construct can be **neither**, which is most of this audit: there is no
  dictionary block, no tuple block, no bitwise operator, no `bytearray`, no
  slice, no string method and no comprehension.

**The measure is therefore not corpus coverage.** #1086's ratchet counts lines
of somebody's existing code. The question here is "how often does a learner have
to drop into the `snakie_python_value` escape hatch to say an ordinary thing?",
and the honest unit is *the construct*, not the line. §5 proposes what to
measure instead.

---

## 2. What the palette has today

Fifteen drawers (`BLOCK_CATEGORIES`, `lib/blocks/theme.ts`), of which nine are
language rather than hardware:

| Drawer | Blocks | Source |
| --- | --- | --- |
| Wait | 6 — sleep ×3, ticks ×2, ticks_diff | `palette/wait.ts` |
| Control | 7 — forever, repeat, while/until, if, for, for-each, break/continue | `palette/control.ts` |
| Logic | 6 — compare, and/or, not, true/false, None, is-None | `palette/logic.ts` |
| Maths | 9 — number, arithmetic, modulo, round ×2, random, abs, min/max, map-range | `palette/maths.ts` |
| Text | 4 — literal, join (f-string), length, print | `palette/text.ts` |
| Lists | 6 — create, length, append, get, set, contains | `palette/lists.ts` |
| Variables | 5 visible — get, set, change-by, cast, `global` (+3 hidden) | `palette/variables.ts` |
| Functions | 6 — def ×2, call ×2, return, if-return | `palette/functions.ts` |
| Python | 12 visible — raw statement/value/suite/call ×2, comment, blank, imports ×3, attr get/set | `palette/python.ts` |

Plus thirteen blocks registered and hidden: `snakie_class`, `snakie_method`,
`snakie_self`, the `try` block, `snakie_with`, `snakie_raise`, `snakie_await`,
`snakie_await_value`, `snakie_python_assign`, `snakie_python_augmented`,
`snakie_python_scope`, `snakie_python_docstring` and `snakie_python_import_here`.

Two of the three "trimmed" notes in that table are load-bearing evidence for
this epic, because they are the palette telling us what it left out and why:

> `TRIMMED: sort, reverse, split, sublist, repeat and index-of are registered nowhere` — `lists.ts`
>
> `TRIMMED: case conversion, substring, index-of, trim, replace, reverse and text_prompt … They are a text-processing library, and this is a palette for making a robot do something.` — `text.ts`

Those were right for #1007's first palette. #1119 re-opens them, and §4 says
which way each one should go.

---

## 3. The audit

Fifteen gaps, grouped. Each one is a filed sub-issue; the issue carries the
block-by-block proposal and the acceptance criteria, and this table carries the
argument for why it is on the list at all.

### 3.1 Data structures — the biggest hole

| # | Gap | Why it matters |
| --- | --- | --- |
| #1120 | **Dictionaries — no blocks at all** | A dict is a config, a note→frequency table, a pin map, a JSON payload, a state machine. Needs a new drawer and a new theme token. |
| #1121 | **Tuples, unpacking, `for k, v in …`, `enumerate`, `zip`** | `for name, value in rows:` is on #1086's still-grey list. Unblocks dict iteration, so it gates #1120. |
| #1122 | **List operations beyond `append`** | You cannot take anything *out* of a list in blocks. `sum`/`min`/`max` over a list is the "average five readings" block. |
| #1123 | **Slicing** | `buf[1:]`, `xs[-1]`, `s[::-1]`. Also how you handle a buffer, which is why it matters more here than on a desktop. |
| #1135 | **`bytes` / `bytearray`** | The one gap that is MicroPython-specific rather than Python-general: you cannot talk to an I2C or SPI device without a buffer. |

### 3.2 Text

| # | Gap | Why it matters |
| --- | --- | --- |
| #1124 | **String manipulation** — case, strip, replace, split, join, find, starts/ends-with | Serial command parsers, CSV sensors, WiFi responses, menus. Re-opens `text.ts`'s trim. |
| #1125 | **Format specs and multi-argument `print`** | "One decimal place" is the commonest formatting job in a sensor program and has no block; `print("x:", x)` is on #1086's still-grey list. |

### 3.3 Operators and builtins

| # | Gap | Why it matters |
| --- | --- | --- |
| #1127 | **Bitwise, `//`, hex/binary literals** | `ARITHMETIC` is five operators. Masks, flags, `1 << pin`, `0x3C` — the vocabulary of a microcontroller, entirely absent. |
| #1128 | **General `in` / `not in`, `is` / `is not`** | `snakie_list_contains` has `check: 'Array'`, so membership on a string or dict is refused by the block's shape. 31 of 73 projects. |
| #1130 | **Inspection, and the conversions the cast block doesn't cover** — `ord`, `chr`, `isinstance`, `int(s, base)` | **Narrowed by #1118**, which landed `turn %1 into %2` (int/float/str/bool/list/tuple) after this audit was written. What is left is the byte-and-character half. |

### 3.4 Control flow and structure

| # | Gap | Why it matters |
| --- | --- | --- |
| #1131 | **Surface `try` / `except` / `finally` / `raise`** | Built by W7, hidden. The difference between a robot that stops dead when a sensor is unplugged and one that carries on. |
| #1132 | **Surface `with`, and give it file blocks to hold** | Built by W7, hidden — and flipping it alone gives a C-shape with nothing to put in it. Logging to `data.csv` has no blocks at all. |
| #1133 | **`del`, `pass`, `assert`, `nonlocal`** | **Narrowed by #1118**, which landed `snakie_global` with a variable field. `del` is unclaimed by any #1086 workstream and gates "remove a key" in #1120; `nonlocal` and multi-name scope stay with the escape hatch. |
| #1126 | **Comprehensions** | 26 of 73 projects write them. The one item here where authoring and reading genuinely part company — see §4.3. |
| #1134 | **Keyword arguments, defaults, `*args`/`**kwargs`** | MicroPython library APIs are full of keyword arguments and the escape hatch is the only way to pass one. Subclassing needs `**kwargs`. |

---

## 4. The decisions

### 4.1 Re-opening a trim is not reversing it

`lists.ts` and `text.ts` trimmed on a principle — *"a palette is a curriculum,
and the blocks you leave out are part of it"* — that this epic does not abandon.
What changed is the premise underneath it: #1007's palette was for making a robot
move, and Snakie now ships a serial console, a file tree, WiFi examples and a
parts library in the hundreds.

So the test for each trimmed block is not "is it useful" (all of them are) but
**"does a learner meet it while doing something Snakie encourages them to do?"**
`split` passes: the serial console invites you to parse a line. `text_prompt`
still fails, and for the original reason — there is no keyboard on the board.

The practical consequence is that several of these drawers should grow a
**sub-category** rather than a flat list. `categoryContents` already builds one
per `group`, and a `Text ▸ more` keeps the first four blocks the first four.

### 4.2 `hidden: true` is a decision, not a default

Four of the fifteen (#1131, #1132, #1133, and part of #1121) are not new code —
they are `hidden` fields, and the wording and placement that flipping one
requires. #1086 §10 anticipated exactly this: *"One field flips any of them if
the curriculum decision goes the other way."*

The rule proposed here: **a hidden block is a block we have decided a learner
should not reach, and that decision should be written down next to the field.**
Where the argument is only "the reader needed it and we hadn't thought about the
toolbox", it is not an argument, and the block should be assessed on its merits.
`class` and `async def` stay hidden on merit. `try` does not.

### 4.3 One block will not read back, and that is allowed

`blocksPaletteSymmetry.test.ts` requires every draggable block to be produced by
a reader rule, by the reader itself, or by an **argued exception** — and it is
deliberately annoying about it, *"because the cost of adding a block to the
palette should include saying how it reads back, even when the answer is 'it
doesn't, and here is why'."*

Comprehensions (#1126) are the case that will need the third branch. #1086 §4.1
lists them as one of the two shapes the no-AST design genuinely cannot parse,
and §3.5 measured their reader value at **three lines**. A learner who drags one,
saves and reopens gets a grey value block that still runs and still regenerates
verbatim. That is acceptable; it is also the sort of thing a help page must say
out loud rather than let someone discover.

Everything else in the audit is a `registerCallRules` one-liner or a
line-shaped statement, and should read back.

### 4.4 Precedence is where round-trip breaks

#1087 found that `raw * 3.3 / 65535` regenerating as `(raw * 3.3) / 65535` made
the round-trip gate treat it as a different program — so blocks silently stopped
following anyone who wrote one of the commonest lines in a sensor program. The
long comment at `maths.ts:52` is the fix and the reasoning.

**#1127 adds six operators at four new precedence levels.** It is the single
highest-risk item in this epic for that reason, and it inherits that comment's
argument verbatim rather than re-deriving it: `a & b & c` must not come back as
`(a & b) & c`.

### 4.5 The no-AST decision still holds

Checked against `blockly-epic.md` §5 and #1086 §4.1, the same way that epic
checked its own workstreams:

| Shape | Fits the lexer? |
| --- | --- |
| Dicts, tuples, slices, buffers, bitwise, conversions, string methods | Yes — token-level or line-shaped |
| `del`, `pass`, `assert`, keyword arguments | Yes — simple statements and call arguments |
| Comprehensions | **No** — §4.3 takes the exception |

Nothing here re-opens the parser question.

### 4.6 Considered, and not filed

- **`lambda` (10 projects) and `yield` (6)** — genuinely rare in device code, and
  both want an expression model the palette does not have.
- **`match` / `case`** — zero occurrences in all 73 projects of #1086's corpus.
  Not rare: absent.
- **Chained comparisons (`0 <= x < 10`)** — the existing refusal is correct and
  documented (folding left gives `(0 <= x) < 10`, which compares a bool with 10).
  A `between` block is the friendlier answer if anyone asks.
- **`micropython.const()`** — idiomatic, and an optimisation rather than a thing
  a learner needs to say.
- **Sets** — `set` exists in MicroPython, and nothing in the corpus or the
  lessons wants one.
- **Decorators in general** — `@property` is already handled as a modifier on the
  method block (W6); arbitrary decorators are a text-Python feature.
- **`text_prompt`** — still no keyboard on the board.

---

## 5. Sequencing, and how to know it worked

**Phase A — the operators (#1127, #1128, #1130).** Small, mechanical, mostly
`registerCallRules` one-liners, and #1127 is the precedence work that everything
numeric sits on. Do it first and do it carefully.

**Phase B — the data structures (#1121 → #1120, #1122, #1123, #1135).** #1121
(tuples and multi-value loops) gates #1120 (dict iteration) and should land
first. #1135 wants #1127's hex literals, so it follows Phase A.

**Phase C — text (#1124, #1125).** Independent of everything else. #1125's
f-string folding is the one genuinely interesting piece of design in it.

**Phase D — the hidden four (#1131, #1132, #1133).** Cheap in code, expensive in
wording; each one is a curriculum decision that wants Kevin's eye more than an
implementer's.

**Phase E — the ones with migration risk (#1134, #1126).** #1134 extends
Blockly's own procedure mutator, so every saved workspace is a compatibility
test; #1126 needs §4.3's exception argued and accepted.

**The measure.** Not line coverage — §1. Two properties instead, both testable:

1. **The escape-hatch count.** Build a fixture of ~20 small programs a learner
   would plausibly want (parse a serial command, log to a file, average five
   readings, drive an I2C sensor, walk a config dict) and count the
   `snakie_python_value` / `snakie_python_call` blocks needed to express each in
   blocks. That number should fall, per phase, and never rise. It is the
   authoring twin of #1086's socket-coverage ratchet, and it is the honest way
   to say whether this epic worked.
2. **Symmetry and round-trip stay green**, which the existing gates already
   enforce — every sub-issue lists both.

---

## 6. Open questions

1. **How big may a drawer get?** Text goes from 4 blocks to ~14 and Lists from 6
   to ~16 if every proposal lands flat. Sub-categories are the answer this
   document assumes (§4.1), but the first-day learner's view of the toolbox is
   the thing being spent, and it is Kevin's call.
2. **Two new drawers, or one?** #1120 wants Dictionaries and #1132 wants Files.
   Each needs a theme token at the measured luminance. Fifteen categories is
   already a long rail.
3. **Is `assert` in or out?** §3.5 of #1086 declined it for the reader on good
   evidence. #1133 asks for an explicit decision rather than silence.
4. **Whose curriculum?** The audit is measured against "what a learner meets
   while doing what Snakie encourages", which is a judgement, not a corpus. It
   is the same honest limitation #1086 §9.1 recorded about its own evidence.

---

## 7. What landed, and the answers to §6

All fifteen sub-issues are implemented. §6's four open questions were answered
by doing the work, and the answers are recorded here rather than left in a pull
request nobody will find again.

### 7.1 How big may a drawer get?

**Sub-categories, as §4.1 assumed — and used more than it expected.** Four
shelves were added rather than growing a flyout:

| Shelf | In | Why |
| --- | --- | --- |
| **Working with text** | Text | Nine new blocks; the drawer's first four stay its first four. |
| **When things go wrong** | Control | `try` and `raise` (#1131) would have taken Control from seven blocks to nine. |
| **Files** | Control | The four file blocks (#1132). |
| **Buffers** | Hardware | `bytes` / `bytearray` (#1135), next to the I²C blocks that ask for one. |

Lists grew flat, from 6 blocks to 16, and that is the one place §6's worry
lands. It is defensible — every one of them is a verb of a list, and a learner
scanning for "how do I take something out" reads them in one pass — but it is
the drawer to watch if the palette grows again.

### 7.2 Two new drawers, or one?

**One: Dictionaries.** Files became a shelf inside Control instead, and the
reason is arithmetic rather than taste. The block palette carries fourteen
vivid hues roughly 24° apart at one measured luminance, five of them anchored
to the brand (#1098), and `blocksTheme.test.ts` holds them 20° apart. **There
was no gap left that admits a fifteenth**, let alone a sixteenth.

Dictionaries got in by taking the one hue that was never occupied *at the
palette's depth*: the burnt orange two degrees off `--block-hardware`, which
lives at a luminance of 0.37 rather than 0.15 and carries black lettering for
that reason. A dark block and a bright one are told apart by lightness, exactly
as the near-greys the hue test already excludes are — so the test gained that
one narrow exclusion, with the argument, and `blocksContrast.test.ts` still
fails if `hardware` ever drifts back onto the depth.

**A sixteenth drawer would have to take a colour from somebody else**, and that
is now a real constraint on the palette rather than a preference.

### 7.3 Is `assert` in or out?

**Out, explicitly** (#1133). §3.5 of #1086 declined it for the reader on
evidence: 890 lines across 8 projects, almost all `pytest` files, which is test
code and not device code. Authoring is a different question and came out the
same way — on a board an `assert` stops the program with a traceback nobody is
there to read, while **if … then report a problem** says the same thing and says
*why*, from two blocks the palette has had since #1131. `snakie_python_scope`
(`nonlocal`) stays hidden for the sibling reason: #1118's `global` block with a
variable field is the better half of that pair, and `nonlocal` needs a function
inside a function, which nothing in the curriculum reaches.

### 7.4 The measure

§5 proposed an escape-hatch count over a new fixture corpus. **The existing
socket ratchet turned out to measure the same thing**, on a corpus that already
exists and is already maintained — a grey value block inside a real block *is*
an escape hatch, and `report.rawSockets` already counts them. So the floors in
`blocksCoverageRatchet.test.ts` were raised rather than a second corpus built:

| | W0 | before #1119 | after |
| --- | --- | --- | --- |
| Statements recognised | 53.31% | 97.94% | **98.53%** |
| Sockets holding a real block | 53.88% | 73.17% | **82.25%** |
| Files that open with no grey at all | 4.65% | 16.28% | **25.58%** |

The socket number is the one this epic is about, and nine points is the largest
single move it has had. The clean-file number is the strictest reading of §1's
question — one grey line disqualifies a whole file — and it went from seven
files in forty-three to eleven.

### 7.5 Two decisions that recur

Two rules were applied often enough across the fifteen issues to be worth
naming, because they will come up again:

**One line, one block.** Where a proposed block would have generated a line an
existing block already writes, the existing block was widened instead of a twin
being added: `in` lost its `Array` check and moved to Logic rather than the
Dictionaries drawer gaining `has key`; `item n of` lost its check rather than
Text gaining `letter n of`; neither Dictionaries nor Buffers has a `how many`,
because `length of` counts them both.

**A check that is too tight refuses the workspace, not the socket.** #1087
found this the hard way, and it decided four sockets here: every slice socket,
the membership haystack, `item n of`, and the output of the bitwise blocks —
`if flags & 0x01:` is how every driver asks whether a bit is set, and declaring
that result `Number` made Blockly refuse the `if` socket and cost two shipped
`.py` files their whole canvas.

## 8. A later decision, taken here because this is where the reasons are (epic #1206)

Epic #1206 asks, as its open question 3: **should Blockly's cog be replaced by a
Snakie-owned popover that handles parameters, the extra-parameter text and the
new decorator list in one place?** It was settled in #1217, and it belongs in
this document because the argument is §4's argument, applied once more.

**Decided: no. The cog is extended, not replaced.** A `def` block's mutator
bubble gains a second section, *decorators*, below the parameters, holding one
small `@ [____]` block per decorator. The entries are text with the known
MicroPython decorators on a `<datalist>` — `property`, `staticmethod`,
`classmethod`, `micropython.native`, `micropython.viper` — so the common ones
are a click and `@app.route("/")` is still typeable. `micropython.asm_thumb` is
deliberately not suggested: its body is not Python, so nothing else in the
blocks editor could fill one in.

Three reasons, in the order they weighed:

1. **The parameter mutator is not a form.** Each `procedures_mutatorarg` in it
   *is* a workspace variable; dragging, renaming or deleting one runs Blockly's
   bookkeeping that renames every caller of the function and adds or removes
   their sockets. A popover would have to reimplement `saveConnections`, the
   caller sockets and the rename flow against internals with no public API — a
   second copy of the machinery `palette/index.ts` says is worth not
   rebuilding, in a second place that can disagree with the first. This is
   exactly the cost #1134 refused when it put the extra parameters in a field.
2. **The cog is already where the learner looks.** It is where they added the
   parameters, and a decorator belongs to the same `def`. Two doors — a cog for
   parameters, a popover for everything about parameters — is the split the epic
   complains about in `snakie_method`'s decorator dropdown, rebuilt larger.
3. **The wrap is the same shape as the one that already works.** A1 (#1215)
   wrapped the four serialisation hooks rather than replacing them; #1217 wraps
   `decompose`/`compose` the same way. Our section is read and written *around*
   Blockly's, which never sees it, so the parameter half cannot be broken by
   the decorator half.

What the popover would have bought — one place for everything about a
signature — is still reachable: #1218 can fold the extras row into this same
bubble as a third section. That is one more section in a mechanism that works,
not a different mechanism.

Two things outside the cog carry the same decision:

- **Right-click "Add decorator…"** on a `def` or method block, for the learner
  who does not want to open the cog at all — the same door #1134 and #1163 put
  on their own hidden rows. It goes through `Blockly.dialog.prompt`, which
  `BlocksCanvas` has already routed to the in-app `usePrompt()` modal, because
  `window.prompt` does nothing in Electron's renderer.
- **An `@` badge on the block**, naming the first decorator (`@property`, with
  `+2` after it when there are more) so a decorated function says so on the
  canvas. Hidden while the list is empty, by the rule the extras row follows:
  the ordinary `def` block stays ordinary.
