# Changelog

All notable changes to Snakie are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Identifying a board now selects it, instead of just describing it.** The
  flash dialog would run its detection, learn that the connected board was an
  ESP32-PICO-V3-02 with PSRAM and 8 MB of flash — and then leave the Board
  picker sitting on *"Other / set up manually…"*. Everything that follows from
  knowing the board (the flash offset, whether to erase first, the note that
  this one needs BOOT held while you tap RESET, which firmware build suits it)
  was left to be worked out by hand, from a list of fifteen entries.

  **Identify board** now applies what it finds: one click and the right profile
  is selected, with the dialog saying so rather than moving the settings
  silently underneath you. Where a chip is used by more than one board it offers
  the choice instead of guessing — two boards on the same chip can want
  different flash offsets, and the wrong one writes cleanly and leaves the board
  dead.


### Fixed
- **The firmware flasher's text is readable on the light theme again.** The
  dialog is deliberately dark whichever theme you are using, but several bits of
  it took their colour from the theme's own tokens — which on the parchment skin
  are near-black, meant for dark text on a light page. On this dark panel that
  came out as dark-grey-on-dark, which is what gave the body copy its odd
  embossed, hard-to-focus look. The explanatory lines were the worst affected,
  and they are the most useful text in the dialog: the port that was detected,
  the chip that was identified, the build being recommended.

  Those now use the dialog's own light palette, and the secondary text is
  distinguished by colour rather than by being faded out. Measured against the
  panel, the affected text went from **2.62:1 — below the WCAG minimum — to
  10.13:1**. A duplicate `.firmware-hint` rule, where the second copy was
  silently overriding the first, is collapsed into one.

### Added
- **An Autoscroll toggle on the firmware flasher's output.** The log followed
  the newest line and nothing else, so scrolling back to read while a flash was
  still running was impossible — every new line yanked you to the bottom again.
  That is exactly when you want to look: esptool prints the chip it detected,
  the flash size it found and the settings it chose right at the *top*, and a
  flash takes half a minute of scrolling after that. Untick **Autoscroll** and
  the view stays put; tick it again and it jumps back to the newest line
  straight away, rather than waiting for the next one to arrive.


### Changed
- **The flasher can ask the board what it is, and flashes the way Thonny does.**
  (#829) A new **Identify board** button runs `esptool flash-id` against the
  selected port and reports what came back — the exact chip, the real flash size,
  and crucially **whether the board has PSRAM**. MicroPython publishes
  `ESP32_GENERIC` and `ESP32_GENERIC-SPIRAM` as separate builds and only the
  second can use the PSRAM, but nothing in the firmware catalog says which one a
  board wants; the board itself knows. When PSRAM is found, the dialog now names
  the build to use and why. It reads only — nothing is written — and a board it
  cannot reach is reported as unreachable rather than as a board without PSRAM.

  The flash itself now matches what Thonny does, which is what people have been
  successfully flashing these boards with: **one** `write-flash --erase-all`
  invocation instead of a separate erase pass followed by a separate write. Two
  invocations meant two connections, and a board that needs BOOT held while RESET
  is tapped had to be coaxed into download mode twice — with the second attempt
  landing after the flash had already been erased. The flash mode and size are
  also pinned to `keep` explicitly rather than left to an esptool default that
  its own help does not state and that has moved between versions.

- **The flasher erases the whole flash by default, and then tells you whether
  the board actually started.** (#826, #827)

  Erasing first used to be opt-in per board, which was the wrong way round: the
  hazard belongs to whatever was on the flash *before*, which no board profile
  can know. In practice the flag ended up set only on boards somebody had
  already been caught by — and not on the generic ESP32 entry, which is exactly
  what you pick when your own board is not listed and its history is therefore
  unknown. It is now on for every esptool board, and a profile can opt out.
  Erasing needlessly costs about seven seconds and a filesystem you are
  replacing anyway; not erasing can cost you a board that looks bricked.

  And the flasher no longer signs off with `Flash complete.` regardless of what
  happened next. esptool exits successfully for a flash whose result cannot
  boot, so that message was a claim about the tool rather than about the board.
  Snakie now resets the board it just wrote and listens: a MicroPython or
  CircuitPython banner is reported as *"the board is running …"*, and a board
  looping on `Image hash failed` or `No bootable app partitions` is said out
  loud, with the fix that usually works. It stays advisory — a board that says
  nothing (a native-USB board re-enumerates and is not there to hear) is
  reported as nothing, and a flash esptool completed is never recast as a
  failure.


### Fixed
- **CircuitPython on an original ESP32 or S2 is flashed to the right address.**
  (#823) The esptool write offset was chosen from the chip alone, but on those
  two chips it also depends on which runtime you are flashing: MicroPython
  expects a second-stage bootloader already at `0x1000` and is written there,
  while CircuitPython ships a *combined* image whose own bootloader sits at `0`.
  Picking a CircuitPython build wrote it 4 KB too high.

  Nothing reported an error — the flash completed, said so, and the board simply
  never came back, which is close to the worst way for this to go wrong. The
  offset now follows the runtime as well as the chip. The ESP32-S3 and the
  RISC-V parts are `0x0` for both runtimes, which is why only these two chips
  were ever affected.

- **The Adafruit ESP32 Feather V2 erases before it flashes.** It ships with
  factory firmware, and a plain write leaves the old partition table behind — the
  board then boot-loops on `Image hash failed` / `No bootable app partitions`,
  which reads exactly like a failed flash even though the flash succeeded.


### Fixed
- **A board with an unfamiliar USB-serial chip can be flashed again.** (#821)
  An Adafruit ESP32 Feather V2 never appeared in the flasher's **Serial port**
  dropdown, so there was nothing to select and no way to go on — even though the
  board enumerated fine and was listed in the Console panel's device dropdown.

  Detection matches a port's USB vendor/product id against a table of known
  bridge chips, and Adafruit moved this board onto a **CH9102F** once the CP2104
  went obsolete. The table knew the older CH340 and CH341 and nothing else from
  that vendor, so the port was silently dropped. The CH9102F and its CH343
  sibling are now in the table, and the **Adafruit ESP32 Feather V2** has a board
  profile — so it appears in the Board dropdown too, with the right 0x1000 flash
  offset and a note that it needs BOOT held while you tap RESET.

  More importantly, **an unrecognised port is now offered rather than hidden**,
  marked as such, so you can pick it and choose the board type yourself. That
  table will always trail the market, and until now the cost of it trailing was a
  board that could not be flashed at all with nothing on screen to say why.


### Added
- **The RCWL-1601 ultrasonic distance sensor is in the Standard parts library.**
  It is pin- and software-compatible with the HC-SR04 already in the library, so
  any wiring or code written for that one works unchanged — but it is specified
  from **3.0 V**, which is the reason to reach for it. A classic HC-SR04 is a 5 V
  part, and running one from a Pico means powering it off VBUS and putting a
  voltage divider on Echo, because a 5 V echo pulse into a 3V3 GPIO can damage
  the pin. That is a step which is easy to skip and expensive to get wrong. The
  RCWL runs straight off 3V3 with nothing in between, which makes it a much safer
  part to hand to a workshop or a classroom.

  Slightly smaller too, at 40 × 18 mm against the HC-SR04's 45.5 × 25.5.

- **The Cytron Maker Pi RP2040 is in the Standard parts library.** An RP2040
  robot controller with two DC motor channels, four servo ports and seven Grove
  ports, so a Maker Pi build can be wired up in the Electronics workspace and
  written against in the editor. Pin assignments come from Cytron's own
  datasheet (Rev 1.2) and their CircuitPython board definition, cross-checked
  against the RP2040's GPIO function table — including the board's genuine
  quirk that **Grove 5 and Grove 6 share GP26**.

### Fixed
- **A board whose pins are all connectors now appears in the MCU picker.**
  (#818) A `family: Microcontroller` part whose I/O is entirely Grove sockets,
  servo ports or screw terminals — with no header rails at all — was silently
  absent from the board list in both the Code and Electronics workspaces. The
  projection that turns a part into a board counted pads from `headers` alone,
  found none, and discarded the board before it could be listed; the same count
  meant the life-like view could not find the part to draw either.

  Connector contacts are pads now, carrying their GPIO and the board's declared
  I²C role through with them. Three boards that already had a QWIIC socket — the
  QT Py RP2040, Motor 2040 and Servo 2040 — gain four wireable contacts each,
  which were previously invisible for the same reason. Those contacts are added
  *after* a board's existing pads, so every wire already saved against one still
  points at the pad it always did.


## [0.46.0] - 2026-08-23

### Fixed
- **Installing a driver no longer leaves the board using its old, broken copy.**
  (#784) If you tried an import, it failed, you installed the driver, and tried
  again — the natural order of events — the import kept failing. The files on
  disk were byte-for-byte correct and exported the missing symbol, but the first
  failed import had left a half-built module in the board's `sys.modules`, and
  every retry got that cache back instead of re-reading the disk. The error
  named a real symbol in a real file that really contained it, so every instinct
  was to suspect the installer, the package or the URL. Only a board reset
  cleared it.

  A successful install now drops that module — and its submodules — from the
  board's import cache, so the next `import` reads the files that were just
  written.

  It is a **targeted purge rather than a soft reset**, which is the difference
  between fixing this and charging for it: a reset would throw away the whole
  REPL session, every variable you were mid-experiment with, to solve a problem
  you did not know you had. And it is not silent — when a cached copy really was
  found, the install row says so, and says plainly what a purge cannot undo
  (a name you already imported *from* the stale module keeps pointing at it
  until the board resets). On a board that had never imported the module,
  nothing is said, because there is nothing to report.
- **A board Snakie can't identify is no longer greeted as MicroPython.** (#770)
  A CircuitPython 10.2.1 board was welcomed in the REPL as
  `MicroPython v10.2.1` — the version was right, so the probe had reached the
  board; only the runtime was wrong, in the very first line the user reads.

  The cause was a binary in the greeting: `circuitpython ? … : MicroPython`. Any
  failure to *positively* identify CircuitPython — a probe line that didn't
  arrive, an `implementation.name` that is neither runtime — silently reported
  the board as MicroPython. That reintroduced, at the very last step, the
  "assume MicroPython everywhere" default the dialect module exists to remove.
  The `v` prefix was the second half of it, since that is MicroPython's own
  convention and CircuitPython prints its version bare.

  An unidentified runtime now claims **no** runtime name and drops the `v`,
  while still printing the version, build date and board — those came off the
  board and are true. It also now matches what the status bar shows for the same
  information, so the two can no longer disagree about what a board is running.
- **`test/` is type-checked, so the part field guard actually guards.** (#793)
  `test/partFieldContract.test.ts` exists to make a forgotten `PartDefinition`
  field a *compile error* — its `Required<PartDefinition>` fixture is a
  deliberate tripwire, because this repo has repeatedly shipped fields that were
  then silently dropped on save. It could not do that: `tsconfig.node.json`
  covers main/preload/shared, `tsconfig.web.json` covers the renderer, and
  **neither included `test/`**. Vitest transforms with esbuild, which strips
  types without checking them, so `npm test` did not catch it either. A
  deliberate type error in a test file passed all four gates clean.

  The guard had been working by convention — every recent author dutifully
  updated the fixture — but it was trusted, not enforced, and the next person
  who did not know the convention would have got no error at all.

  A `tsconfig.test.json` now covers `test/` and runs as part of
  `npm run typecheck`. Turning it on surfaced **48 real errors across 15 test
  files**, every one of them a fixture that had drifted from the type it claims
  to be — a `FakeRuntime` missing the `runStream` the interface gained in #612,
  `PartCatalog` tests passing an `onAdd` prop that had been renamed to
  `onAddMany`, `syncPlan` reading a `partId` off a union arm that has none,
  `BoardDefinition` fixtures without `pcbColor`, a schematic fixture using a
  `name` field `SchematicPin` never had, and a duplicated import line. All
  fixed. Adding a field to `PartDefinition` now fails `npm run typecheck` at the
  one place that makes you decide what that field does.
- **The console pops out into a real window on the web app too.** (#810) The
  sibling of #781, and a worse failure than it looked. On app.snakie.org the
  pop-out control called `console.open`, which outside Electron landed on a stub
  that did nothing — but the panel had *already* hidden the docked terminal
  behind a "Console popped out to its own window" placeholder. So the console
  vanished, no window appeared, **and the Redock button was dead too**: it asks
  the window to close and then waits for the `console:closed` event to put the
  console back, and that event could never arrive because its listener was a stub
  as well. The console stayed gone for the rest of the session.

  It now opens a real, resizable browser window — and a live one. As with an
  instrument, a pop-up is its own JavaScript world, so a window that built its
  own backend would be watching a second simulator (and a USB board can only be
  open in one place at a time). Instead the editor tab lends the pop-out its own
  device, so the detached console shows the same output *and* types back to the
  same board. It opens seeded with the scrollback you already had rather than
  blank, and closing it re-docks exactly as on the desktop.

  Every route back to the dock now reports itself, because that event is the
  console coming back: closing the window, clicking Redock, the browser blocking
  the pop-up (the console re-docks and says why), and the window being closed
  behind the editor's back. A reload is deliberately *not* treated as a close, so
  refreshing a detached console doesn't re-dock a perfectly good one. If the
  editor tab it belongs to is gone, the window says so instead of accepting
  keystrokes that go nowhere.

  Two smaller things came out of the same fix: `console.html` was missing from
  the web build entirely, and the offline service worker would have answered its
  navigation with the app shell — opening the whole editor inside a 760px window.
  And the detached console now uses the Soft Shell fonts the rest of the app
  does, which #781 had already corrected for instruments.

### Added
- **Publish a project to GitHub without leaving Snakie.** (#795) A repository
  you created locally had nowhere to go: the Source Control panel offered
  **Push** and **Pull**, both of which need a remote, and setting one up meant
  a terminal, `gh repo create` or the GitHub website plus a `git remote add`
  typed by hand. Those two buttons were dead controls in exactly the state
  where a useful one belongs — so on a repository with no remote they are now
  replaced by **Publish to GitHub**.

  It opens a dialog: the repository name (pre-filled from your folder, and
  sanitised — "Line Follower (v2)" becomes `Line-Follower-v2`, because GitHub
  will not take the first), an optional description, and who can see it.
  Publishing creates the repository, adds it as `origin` and pushes your
  current branch in one step, then the panel says what it did — the full
  `owner/name`, the visibility, and the branch it pushed.

  **It defaults to private, and that is a safety decision rather than a
  preference.** The MicroPython convention for Wi-Fi credentials is a plain
  `secrets.py` sitting next to `main.py`, and a public repository is scraped,
  forked and cached within minutes — "delete the repo" does not un-publish a
  password. Choosing public costs one extra click; getting it wrong by default
  would cost some people their network. For the same reason, choosing public
  when the repository actually *tracks* a credentials-shaped file — `secrets.py`,
  `.env`, a `.pem` — names those files before you commit to it. It warns rather
  than blocks (your `.pem` may well be a public certificate), and it only counts
  files git is already tracking, because an untracked or ignored one is never
  pushed and warning about it would just teach you to click through.

  **Snakie never holds a GitHub credential.** Publishing runs through the
  GitHub CLI, which already keeps your token in the OS keychain and already
  handles two-factor — the alternative was a personal access token typed into
  a Snakie field and stored by Snakie, which is a thing that can leak. So the
  dialog checks up front, before showing you a form: no `gh` installed, not
  signed in, no commits yet, or a remote already configured each appear as a
  sentence with the next step in it, rather than as an error after you have
  typed a description and pressed the button. Sign-in itself stays in your
  terminal (`gh auth login`) on purpose, so your credentials only ever go to
  GitHub.

  The repository name is validated as you type against the same rule the main
  process guards with, so the dialog cannot accept something GitHub will
  reject — and every value reaches `gh` as its own argument rather than as part
  of a command line, which is what makes a repository named `foo; rm -rf ~`
  merely an invalid name. Desktop only: the web app has no local git and no
  `gh` to run.
- **Right-click your code and Snakie offers to tidy it — and explains why.**
  Select some Python, right-click **Refactor…** (or <kbd>Ctrl/Cmd</kbd>+<kbd>⇧</kbd>+<kbd>R</kbd>),
  and you get concrete, safe rewrites: *Convert to guard clause*, *Merge nested
  conditions*, *Iterate over the items directly*, *Wrap the constant in
  `const()`*. Every one shows you a **diff before it touches your file**, comes
  back with a single <kbd>Cmd</kbd>+<kbd>Z</kbd>, and carries a **Why?** link
  into a help page that teaches the principle behind it.

  The catalogue is deliberately not just "Python tidying". Snakie's users are
  learners writing robot code on a microcontroller, which makes a whole class of
  smell worth flagging that desktop tooling has no reason to care about — and
  these are the ones that actually make a robot work better:

  - **A raw `ticks_ms()` subtraction is a bug, not a style nit.** Tick counters
    *wrap*; `ticks_us()` roughly every 17 minutes. Subtract two of them with a
    plain `-` and, at the wrap, the result goes hugely negative and your timer
    either fires on every pass forever or never fires again. It cannot show up
    on the bench, because the bench session is shorter than the wrap.
  - **An `.irq()` handler with no
    `micropython.alloc_emergency_exception_buf()`** gives you no traceback at
    all when it fails — just silence, at 3am, with the robot halfway down a
    corridor. One line fixes it, and almost nobody writes it.
  - **Allocating inside an interrupt handler**, re-creating a `Pin()` every loop
    iteration, `s += "…"` in a loop, a blocking `time.sleep()` inside an `async
    def` — each flagged with what it costs you on a board with 264 KB.

  Nothing is guessed. A file that does not parse offers *nothing*, rewrites are
  ranged text edits so your comments and formatting outside them survive
  byte-for-byte, Snakie matches your file's own indentation rather than imposing
  four spaces, and where a rule cannot *prove* your code still means the same
  thing it declines instead of trying. A learner who accepts a bad "fix" and
  breaks their robot will not trust the feature again.

  The whole engine is dependency-free TypeScript, so it works with **no Python
  installed** and in **Snakie for Web** — which is exactly the classroom that
  needs it most. Board-specific advice is the opposite: it appears *only* when a
  board is plugged in and Snakie has asked that firmware what it actually
  supports, and speed hints can be **benchmarked on the real device** before you
  accept them, so when `@micropython.native` buys you 4% you see 4% and skip it.

  Plugins can contribute rules too, via `@plugin.refactor` — a school can ship
  its own house style. **90 rules**, each with worked examples and a page
  explaining the principle behind it. Issues #799–#808, #451; epic #634.
- **Stage a whole group in the Source Control panel, in one click.** Staging
  twenty new files one **＋** at a time was twenty clicks. Each group header now
  carries its own button — **Stage 12 untracked** on the *Untracked* list,
  **Stage 3 changes** on the *Changes* list.

  The button sits **inside the group it acts on**, and the count is **in the
  label**. Both are deliberate. A single "add changes" button sitting above two
  lists reads as "stage everything I can see", which is a much larger promise
  than the one being made; putting it in the header means its scope is never in
  doubt. And the count is the brake — *Stage 3 untracked* invites a click,
  *Stage 412 untracked* makes you look at the list first. That is why there is
  no confirmation dialog: unlike **Initialise Repository** (#783) this writes
  nothing to your disk, it only moves files into git's index, and the per-file
  **−** beside each one puts them back.

  Files ignored by `.gitignore` are never staged — not because Snakie filters
  them, but because the paths come from `git status`, which has already applied
  every ignore rule. **Conflicted files are held back** from a bulk stage: `git
  add` on a conflicted file is how you tell git "I resolved this", and doing
  that in bulk would mark a merge resolved with the `<<<<<<<` markers still in
  the file. Those keep their own per-file button, and the tooltip says so when
  the header count and the button count differ because of it. Failures — no
  `git` installed, an unreadable working tree — arrive as a sentence in the
  panel, and the lists refresh in place. (#794)
- **Position a linked 3-D model: nudge it, or snap a corner to the origin.** #741
  let you turn a model the right way up; this is the other half. An STL's origin
  is wherever the exporter left it — often a corner of the build plate — and
  until now the only fix was to re-export from CAD. The Part Editor's **3-D** tab
  grows a **Position** panel:

  - **Nudge** along X, Y or Z by a step you choose — **0.1, 1 or 10 mm**. Fixed
    millimetres, not a fraction of the model: the same button moves a 5 mm sensor
    and a 100 mm battery the same distance, the number that lands in `parts.yml`
    is one you picked, and 10 mm is exactly one square of the stage's grid.
  - **Snap** a feature you name onto the origin. Pick `min` / `centre` / `max`
    for each axis and the three picks between them name any **corner**, **edge
    midpoint**, **face centre** or the **centre** — 27 in all, one rule. Snakie
    does the arithmetic and nothing else: following the Join tool's lesson,
    there is no auto-fit and no inferring which feature you probably meant.

  New `PartDefinition.meshOffset`: `[x, y, z]` **millimetres** in the part's
  frame, applied **after** `meshRotation`. That order is URDF's own
  (`<visual><origin xyz rpy>` is rotate-then-translate), so the offset is written
  out as the stored millimetres ÷ 1000 with no compensation term — and it is what
  makes a nudge travel along the axis you pressed however the model is turned.
  The same order holds in the editor stage, in `PartMeshView`, and in the URDF
  that `addMeshLink` and `swapLinkVisualToMesh` write. Absent means no
  translation, so parts authored before this need no migration. (#788)
- **Type a quote and the project's sprites are right there.** (#791, part of
  epic #789) Inside a string literal, autocomplete offers every `.spr` in the
  project — the file's **own folder first**, then the rest of the project — each
  with its size and frame count on the line (`eyes.spr`, `12×8 · 3 frames`), so
  the choice is informed rather than a bare filename. A typo in a sprite name
  used to fail **at runtime, on the board**, which is the worst possible place to
  learn about it; and the second benefit is the bigger one — you now find out
  which sprites exist by typing, instead of by opening a file browser.

  It offers inside a string and **nowhere else**: never in code, never in a `#`
  comment, never in a docstring, and never inside a template or a glob
  (`f"{stem}.spr"`, `"%s.spr"`, `"frames/*.spr"`) that no completion could
  correct. It uses the reference rule #790 settled rather than a second copy of
  it, and every name it offers is checked back through that rule — where two
  folders hold the same filename, the nearer one wins the short name and the
  other is offered by full path instead of quietly naming its rival. A project
  with no sprites offers nothing at all rather than an empty popup. The one
  visible trade: inside a string you no longer get the module catalogue
  (`machine`, `time`…) suggested, which was never a useful thing to write there.

  The file list is a snapshot, never built on a keystroke — refreshed when the
  file or project folder changes, marked stale the moment a file is saved or a
  `.spr` is written from the Sprite editor, and re-walked in the background at
  most every few seconds. Sizes come from the cache #790 already fills, so
  nothing is read from disk while you type.
- **The Sprite editor tells you where a sprite is used — or that nothing uses
  it.** (#792, part of epic #789) Open a `.spr` for editing and a line under the
  toolbar names the files that reference it, each one a click away from the exact
  line: `eyes.spr is used in 2 files:` `play_spr.py:12` `demo.py:3`. When nothing
  references it, it says so in as many words — `Nothing references eyes.spr —
  searched 14 Python files.` — because that is the answer that tells you the
  sprite is safe to delete, and an empty area would only read as "still loading".

  The search covers **every `.py` under the open project folder**, not just the
  files you happen to have open: a sprite goes stale in the file you closed three
  weeks ago, which is exactly the file an open-files-only answer would miss.
  Dependency and cache trees (`node_modules`, `__pycache__`, dot-folders) are
  skipped, and it stops at 500 files, breadth-first, so a project folder that
  happens to sit above something enormous still gets an answer. **Open buffers
  beat disk**, so a reference you just typed and have not saved counts (its chip
  is dashed, to say the file on disk does not agree yet) and one you just deleted
  stops counting. It re-reads the project when a file is saved beneath the
  overlay, and on the ↻ button; it never runs on a keystroke — the sprite editor
  has no code in it to type. Saving a new drawing now adopts the file it was
  saved to, so **Save .spr** stops asking twice and the new sprite gets its
  own "used in" answer immediately.

  Uses the reference rule #790 exported (`sprite-refs.ts`), so what counts as a
  use is exactly what draws a thumbnail — including that a relative name means
  the sprite beside the file before the one in the project root, and that a name
  built at runtime is invisible to both.
- **A sprite in your code draws itself, right there in the line.** (#790, part of
  epic #789) Name a `.spr` in a Python file and the sprite appears beside the
  string — at about line height, **always visible, not on hover**. Hover only
  helps someone who already suspects there is something worth hovering; the thing
  MakeCode gets for free is that the artwork is simply *there*. Click the sprite
  and it opens in the Sprite editor on that file, where **Save .spr** writes
  straight back over it and the code repaints with the new artwork.

  The reference rule is settled once and exported (`sprite-refs.ts`), because
  #791's autocomplete and #792's back-link inherit it: a **string literal whose
  text names a `.spr` file**, looked for beside the file first and then in the
  project folder. Templates (`f"{stem}.spr"`, `"%s.spr"`), globs, variables,
  comments and docstrings are deliberately ignored rather than guessed at — a
  thumbnail beside the wrong sprite is worse than none. An animation shows its
  first inked frame and holds still (a cycling image competes with the code for
  attention; the hover says how many frames there are), a reference to a file
  that is not there is drawn as a broken marker instead of quietly vanishing, and
  a reference with nowhere to resolve against draws nothing, because "I cannot
  tell" is not "it is broken". Sprites are read and rendered once per file per
  mtime and cached, so the decorations never touch the disk on a keystroke.
- **A Sprite editor for LED matrices and OLED displays.** The Display
  instrument grows a **✎ Sprites** key that opens a full-screen pixel editor:
  set the sprite size (presets from the 12×8 Arduino Modulino / UNO R4 LED
  matrix up to a full 128×64 SSD1306), draw with pencil / eraser / flood-fill,
  nudge, flip, invert and clear a frame, and build animations on a **filmstrip**
  of frames — add, duplicate, reorder, delete — with onion skinning, live
  playback at the chosen frame rate, and undo/redo throughout. The editor opens
  with a pair of blinking eyes drawn for the Modulino LED Matrix
  (`examples/sprites/` has the same animation as a `.spr`, a PBM frame, an
  exported MicroPython module, and players for the Modulino matrix and an
  SSD1306 OLED).

  Animations save as **`.spr`** — a new Snakie container built for
  microcontrollers after a survey of the prior art (PicoGraphics'
  raw `.rgb332` spritesheets, Thumby's headerless `.bin` sprites, Badgeware's
  PNG/GIF loaders): a 16-byte self-describing header (magic `SNKS`, size, pixel
  format, frame count, frame duration) followed by frames whose bytes are
  exactly `framebuf.MONO_HLSB`, so MicroPython plays one straight from flash
  through a single reusable frame buffer in ~20 lines with no decoder
  (`examples/sprites/play_spr.py`). Single frames import/export as **PBM**
  (P1 + P4 — a P4 raster is byte-identical to MONO_HLSB, so it too loads with
  one `readinto`), and the editor also exports a ready-to-import **MicroPython
  module** and round-trips **PNG, JPEG and animated GIF** (GIF timings are kept,
  bright-on-black art is auto-repolarised, and integer-upscaled pixel art is
  folded back to its true grid). 1-bit today; the `.spr` format byte mirrors
  framebuf's constants so higher bit depths can arrive without a format break.
  The local-file layer gains binary writes (`fs.writeFileBytes`) and filtered
  save dialogs to carry the new formats.
- **The Part Editor has a 3-D view: link an STL to a part, and turn it the right
  way up.** (#741) Attaching a model used to mean copying the file into the part
  folder by hand and editing two lines of `parts.yml` — and a model that arrived
  lying on its side couldn't be corrected in Snakie at all. There's now a **3-D**
  tab beside Breadboard and Schematic.

  **Link a model** picks an `.stl` (or `.dae`) and **copies it into the part's own
  folder**, because a part folder is the thing that gets zipped, committed and
  published — a link pointing at `~/Downloads` travels nowhere. If a file of that
  name is already there, the copy takes the next free name (`model-2.stl`) rather
  than overwriting it; the one exception is the model the part *currently*
  references, which **Replace** may overwrite because the part authored it. Link
  the same file twice and Snakie recognises the identical bytes, re-uses what is
  already there and copies nothing. **Unlink** removes the reference and leaves
  the file where it is: Snakie does not delete a file it did not write.

  **The model is shown at its real size**, in millimetres, standing on a 10 mm
  grid inside a ghost outline of the part's declared dimensions, with an axis
  triad naming which way is up. A mesh authored in metres is then obvious the
  moment it loads rather than the first time the part is placed, and the panel
  says so in words when the two sizes disagree.

  **Orientation is stored, not baked.** A new `meshRotation` on the part records
  `[x, y, z]` degrees in URDF's own roll-pitch-yaw convention; your STL is never
  rewritten. ±90° buttons and numeric fields turn the model about the part's
  axes — composed properly, so the fourth press of a button really does bring you
  back to square. The stored rotation is honoured everywhere the model is used:
  this view, the catalog's turntable, and the `<visual>` origin of the URDF link a
  placed part gets in Build (on the visual, not the placement joint, so re-jointing
  the part in Build doesn't fight it). A part authored before this field existed
  keeps working unchanged — absent means no correction.
- **A folder that isn't a repository yet can become one from the Source Control
  pane.** (#783) It used to say "not a Git repository" and offer you nothing but
  a different folder — so starting version control meant leaving Snakie for a
  terminal. There's now an **Initialise Repository** button in that empty state.
  It confirms first, because it writes to your disk, then creates the repository
  and reports back in words: which branch git started you on, whether it added a
  `.gitignore`, and how many files are now waiting.

  It does **not** commit anything. An initial commit made on your behalf would
  sweep every file in the folder — including whatever you haven't looked at — into
  permanent history from a single click, so instead your files appear under
  **Untracked** and you choose what goes into the first commit with the commit box
  like any other commit. Until you make it, the branch chip reads **no commits
  yet**, because the branch really is only a name so far.

  A starter `.gitignore` is written **only** when the folder doesn't already have
  one — an existing one is never touched. It's a short list of things this
  computer generates and can regenerate (`__pycache__/`, `*.pyc`, `.DS_Store`,
  Snakie's own `robot.yml.bak` rescue copies, editor scratch files) and nothing
  else. Your `.py` sources, `robot.yml`, `.urdf` models, the `meshes/` those
  models are useless without, and any vendored `.py`/`.mpy` drivers all stay
  tracked: a first commit that quietly omits a robot's meshes is a much worse
  outcome than one that includes a stray `.pyc`.

  Failures say so. Git not installed reads as "Git is not installed on this
  computer" with where to get it, rather than the bare `spawn git ENOENT` Node
  hands you; a folder that already sits inside another repository is refused by
  name, rather than nesting a second one inside it; and a `.gitignore` that
  can't be written is reported as a warning next to a repository that was still
  created, rather than as a failure that wasn't. Source Control is desktop-only,
  so none of this appears in the browser build, which has no filesystem and no
  local git to run.

- **A CircuitPython board is told when a newer CircuitPython is out — and never
  told about MicroPython.** (#757, epic #209) Snakie already offered MicroPython
  updates once per connection; the same prompt now covers CircuitPython, and it
  names the runtime it's offering, so nobody is told about a release for a Python
  their board isn't running. It's matched on the **Board ID** from `boot_out.txt`
  rather than the chip family, because CircuitPython ships a separate build per
  board — so what you're offered is your board's own newest build, not the newest
  build for something with the same chip in it. Where that id can't be
  established, or the board isn't in the catalog, you're told nothing rather than
  offered a guess. Pre-releases are never offered: CircuitPython publishes its
  alphas and betas in the same list as its stable builds, and `10.3.0-alpha.1`
  really is "newer" than `10.2.1` — it's just not an update.

- **You can now choose which Python you're flashing.** (#756, epic #209) The
  flash dialog was MicroPython all the way down and offered no way to say
  otherwise — there was no runtime selector at all. There is one now, at the top,
  and it drives everything below it: which catalog is fetched (micropython.org's
  or circuitpython.org's), what every label says, and which board's build is
  offered. If a board is already connected the dialog opens on whatever that
  board says it is running, rather than assuming. CircuitPython builds are per
  **board**, not per chip — `raspberry_pi_pico` and `raspberry_pi_pico_w` are
  different files — so Snakie matches your board to its own build using the
  **Board ID** from `boot_out.txt` on the CIRCUITPY drive, and pre-selects it.
  When that id can't be established it pre-selects **nothing** and says so:
  another board's `.uf2` flashes without a single error message and comes up with
  the wrong pins. Boards that CircuitPython publishes twice — the same ESP32-S3
  as a `.uf2` for its bootloader drive AND as a `.bin` for esptool — now read as
  two clearly named choices instead of one list with every version in it twice,
  and the flash mechanism is taken from the file you actually picked rather than
  from its chip family, so a UF2 container can never be handed to esptool. Board
  detection also stopped calling every UF2 bootloader an RP2040: a Feather, QT Py
  or Metro names its own volume (`FEATHERBOOT`, `QTPY_BOOT`, `ARDUINO`…), and
  Snakie now reads the board's name out of the `INFO_UF2.TXT` the UF2 spec
  defines and shows that instead.
- **CircuitPython libraries install from the Adafruit bundle — the way
  CircuitPython users expect.** (#758, epic #209) CircuitPython has no `mip` and
  no package manager on the board at all; its libraries come from the Adafruit
  CircuitPython Library Bundle, copied in from the computer — which is exactly
  what `circup` does, and exactly the shape Snakie's installs already have.
  Connect a CircuitPython board and the Modules panel now offers Adafruit's own
  drivers: HC-SR04, VL53L0X, SSD1306, MPU-6050, LSM6DS, NeoPixel and the motor
  library. Installing one downloads it on your computer and writes the `.mpy`
  into `/lib`, dependencies and all — asking for the MPU-6050 quietly brings
  `adafruit_bus_device` and `adafruit_register` with it, because without them the
  driver imports and then fails. The archive is matched to the board's own
  CircuitPython **major version**, read from the bundle's daily release rather
  than assumed: `.mpy` bytecode is version-locked, so a 10.x file on a 9.x board
  simply doesn't import. If the bundle no longer ships a version for your board,
  the install says so and names both sides — which version the bundle offers and
  which one the board runs — instead of failing later with an `ImportError` that
  mentions neither.
- **The Modules and Packages panels know which Python your board runs.** (#758,
  epic #209) The module catalog now holds both runtimes' drivers, and a
  connected board only ever sees its own: a MicroPython board is not offered an
  Adafruit `.mpy` it cannot import, and a CircuitPython board is not offered a
  `machine`-based stub it cannot run. A short line says which runtime is being
  shown and why, so the shorter list reads as an explanation rather than a
  missing feature. With nothing connected the whole catalog is still browsable.
  The Packages tab — which searches micropython-lib and PyPI — now says plainly
  on a CircuitPython board that those are MicroPython packages, and points at the
  Modules panel instead.

### Fixed
- **The Inspect panel scrolls.** A file with more than a dozen top-level symbols
  ran off the bottom of the Outline pane with no way to reach the rest, and the
  Variables list below it did the same. There *was* an `overflow: auto` on each
  pane — it simply never applied: `react-resizable-panels` writes
  `overflow: hidden` as an inline style on every panel it renders, and an inline
  style outranks any stylesheet rule. The scrolling now belongs to the list
  inside each pane, the way the Files view has always done it, with the count and
  **Refresh** staying put at the top while the rows move under them. (#796)
- **The Inspect panel lists your variables, not Snakie's.** Everything Snakie
  asks a board to do — list a folder, gauge the flash, upload a file — runs as a
  snippet in the board's `__main__`, the same namespace your program uses. Every
  temporary those snippets bound stayed bound, so a program with no variables of
  its own was reported as **"3 variables"**: a spent file handle, an
  `os.statvfs()` tuple from the flash gauge, and a chunk of the last file
  uploaded, still holding its bytes.

  Snippets now clean up after themselves, which also gives a Pico back the
  memory they were pinning — a chunk left over from an upload holds the whole
  file. The cleanup runs even when a snippet *fails*, which is exactly when
  someone opens the inspector to find out what happened. The few names that must
  outlive a single snippet, such as the file handle a chunked upload writes
  through, carry a `_snk_` prefix and are filtered from the panel by that one
  rule — not by a list of single letters, which could never tell Snakie's `_s`
  from yours. (#798)
- **A linked 3-D model no longer gets left behind when a part changes library,
  and a missing one now says so.** Linking an STL in the Part Editor's 3-D tab
  copies it into the part's folder — but saving the part into a *different*
  library moved only `parts.yml`. The image and help ride in memory and made the
  trip; the mesh exists only on disk and did not, so the 9V battery ended up with
  `mesh: battery-9v.stl` in `snakie-standard/` and the actual model still sitting
  in `my-parts/`. A save now brings the model with the part, and reports the
  filename when it cannot find one at all rather than writing a dangling
  reference and calling it a success.

  **`meshUnits` is recorded when the model is linked.** An `.stl` states no
  units, so the link step is the last moment anything can measure the geometry
  and write a conclusion down; without it a 48 mm part read as metres arrives
  1000× too big. The guess is stored as the ordinary, editable `meshUnits` field
  and named in the confirmation message, so a wrong one is a visible click to
  correct.

  **A broken mesh no longer looks like a rendering bug.** "This part has no
  model" and "this part's model is missing" used to render identically — a plain
  footprint block, with nothing said. A part that declares a `mesh:` and doesn't
  get one still gets a block (a part with no body is worse), but now reports it
  in the status bar, naming the part and the file. The same silent-failure shape
  is fixed on the placeholder→mesh upgrade in Sync, and in both stubbed bridges
  that used to answer with a bare `{}`. (#787)
- **A package's dependencies now provably land where the board can import them,
  and the install says which ones came along.** (#785) A dependency has to be
  installed at the install ROOT — `/lib/lsm6dsox.py`, on the board's `sys.path`
  — because it is imported by name. Written under the package that asked for it,
  it is a downloaded, present, completely unreachable file, and the install
  still reports success. Snakie's resolver was doing the right thing, but
  nothing said so: the tests proved the files were *fetched*, which is a
  different claim from *put in the right place*, and a resolution's files
  carried no record of **whose** they were, so the placement rule could not even
  be stated. Every resolved file now names the package that declared it, the
  device path is computed in exactly one place that can only ever see the
  install target — so "relative to the package that pulled this in" is not
  expressible — and the rule is pinned per-dependency and as a property.

  Two real faults came out of the same look. An install folder given as `lib`
  (the placeholder a part author is shown) produced **relative** device paths,
  while the directories for those same paths were created **absolute** — they
  only ever agreed because a board's working directory happens to be `/`; a
  target is now anchored before anything is joined to it. And an install was
  silent about what it brought: installing the Arduino Modulino package quietly
  installs three more packages, and the only way to check was to list `/lib` on
  the board. The install note now names them, on the desktop and the web, for
  driver and package installs alike. The Part Editor also warns an author whose
  `mip` install folder points *inside* another package — that folder is the root
  its dependencies land in too.
- **The Build workspace could overwrite the file you had open with a 3-D robot
  model. It can't any more.** (#782) Building in the Build workspace edits the
  project's robot model — but it saved that model through *whatever tab the
  editor happened to have focused*. If that was your program, your program was
  replaced by the robot model, on screen and on disk. The only check was "is
  this a saved file", which a `.py` passes.

  A robot model now goes to a `.urdf` or it goes nowhere. Where a model is
  written is decided from the document itself — the file it came from, or the
  `.urdf` open in the editor — never from what has focus, and a target that
  isn't a `.urdf` is **refused, and says so**, rather than falling back to
  something plausible. The same rule applies wherever a model is written: the
  part-placement bridge, the Sync reconcile, and the robot.yml `urdf:` link
  itself, which can no longer be pointed at a non-`.urdf` file.
- **Sync no longer adds a second, third and fourth copy of your microcontroller
  to the 3-D view.** (#782) A part that lost track of which 3-D body was its own
  could still recognise it by name; the microcontroller couldn't — its only
  identity was a note in `robot.yml`, so if that note went missing (which an
  ordinary save could do), Sync reported the board as having no body and
  reconciling made another one, identical to the one already there. The board is
  now identified exactly the way a part is, so a lost note costs nothing, and
  running Sync twice leaves the model exactly as it was.
- **A deleted part can no longer leave a connection behind that breaks the whole
  robot.** (#782) A `<joint>` referring to a link that isn't in the model is
  invalid — the file fails to load in any 3-D viewer, so one stray connection
  costs you the entire robot rather than one part. Snakie now refuses to write
  one: a joint is never created for a body that isn't there, and any that is
  found is dropped as the file is saved.
- **A board whose firmware version isn't a version is no longer told to update.**
  (#757) A vendor MicroPython build was reporting its *branch name* where the
  version goes. The comparison turned anything non-numeric into `0`, so that
  board read as `0.0.0` and every build in the catalog looked like an upgrade
  from it. An unrecognisable version now compares as "no update" — we don't know
  what it's running, and that isn't evidence that it's behind.
- **Build no longer opens the help panel every time you switch to it.** Switching
  to the Build workspace kept reopening the lesson/help sidebar, however many
  times you closed it. The cause was a "sticky lesson" rule that carried the
  sidebar across on EVERY workspace switch whenever the workspace you were
  leaving happened to have Learn or Help selected with its sidebar open — which,
  in Code, is simply where you're left after reading one help article. Worse, it
  wrote that open panel into Build's own remembered layout, so collapsing it
  there could never stick.

  Now every workspace keeps its own panel state: Build (and Electronics) opens
  the way you last left it — collapsed by default — and a panel you open there
  yourself stays open, across switches and restarts. A panel still appears when
  something deliberately asks for one: a tutorial step that sends you to the
  workspace it's about brings its instructions with it, and an instrument's or
  part's `?` still opens the Help article beside the board. Sessions that already
  had the stale open panel stored for Electronics/Build get it collapsed once on
  upgrade.
- **Instruments pop out into their own window in the browser too.** (#781) On
  app.snakie.org, undocking an instrument did nothing you could see: the
  instrument left the dock, no window opened, and there was no way to get it
  back except toggling its kind off and on. The pop-out control called
  `instruments.openWindow`, which outside Electron landed on a stub that
  returned and did nothing at all.

  It now opens a real, resizable browser window — and, importantly, a LIVE one.
  A pop-up is its own JavaScript world, so a window that built its own backend
  would be watching a second, separate simulator (and a USB board can only be
  open in one place at a time, so it could not join in at all). Instead the
  editor tab lends the pop-out its own device: same telemetry, same
  `sendControl`, one board. Close the window and the instrument re-docks, exactly
  as it does on the desktop. If the browser blocks the pop-up, the instrument
  comes straight back to the dock and says why; if the editor tab it belongs to
  is gone, the window says that too instead of showing a dead dial.

  Two smaller things came out of the same fix: the offline service worker was
  answering *any* navigation with the app shell, so the instrument window would
  have opened the whole editor inside itself; and a detached instrument now
  uses the Soft Shell fonts the rest of the app does.
- A unit test no longer depends on what is plugged into the machine running it.
  (#773) The CircuitPython file-routing tests exercise one case — a drive that
  ejected — that made the device re-resolve its mount, and re-resolution is the
  one step that leaves the test's temp directory and scans the developer's real
  volumes (and, if it finds a board, their real serial ports). That is unbounded
  I/O: it is why that single case timed out repeatedly under a loaded suite
  while passing every time on its own. The scan is now stubbed — the logic under
  test is untouched, and two cases now assert something they could not before:
  that the device really does look again when the marker file is gone, and that
  a drive still present does **not** cost a rescan on every file operation.
- **Pin labels are the same size on every board with the same hardware.** (#778)
  A Tiny 2350's pin names didn't match a Modulino LED Matrix's, even though both
  carry an ordinary 2.54 mm header. Label size wasn't a setting: it was derived
  from the tightest gap between *any* two pins, measured in pixels of the part's
  own fit-to-footprint box — an accident of the outline, not of the hardware. So
  the same header was typeset one size on a 18 mm board and another on a 41 mm
  one, and a placed part's silk labels carried its body scale on top of that,
  setting identical pins in nearly twice the type on a big part as on a small one.

  Labels are now sized the way everything else on a part already is: physically.
  A label is as big as the room its pin really has — its neighbour's distance in
  millimetres at the canvas' pixels-per-millimetre — so identical hardware drawn
  at the same scale reads at the same size, whatever board it sits on.

  The density shrink is still there, because it is the only thing keeping a Servo
  2040's eighteen servo headers legible, but it now applies **per board edge**. A
  label is anchored to the edge its pin faces and can only collide with the other
  labels on that edge, so the Tiny 2350's QWIIC contacts — 1.2 mm apart, and
  labelling off the bottom — no longer shrink the castellations down both sides.
  Pins that draw no label at all (a servo header's V+/GND rows) no longer shrink
  their neighbours either.
- **A running Snakie can no longer undo an edit you made to a part outside it.**
  (#750) The parts library is a folder of plain text files, so a script, an
  editor and `git checkout` are all perfectly good ways to change a part — but
  the app assumed it was the only author. It held each part in memory from the
  moment the library loaded and, on the next save, wrote that copy back over
  whatever was on disk. Corrected I²C addresses reverted to their 8-bit values,
  QWIIC socket rotations flipped so GND sat on the wrong contact of a power
  connector, and a module lost its whole template — four times in one session,
  silently each time, because a save reported success.

  A part now carries a stamp of the exact file it was read from, and a save that
  presents a stamp the file no longer matches is **refused**, with a message
  asking you to reopen the part. Nothing is written, so nothing is lost.

  The same save also used to prune the part's folder to match its own idea of
  the part's contents: every `image.*` and any `help.md`, whether the part
  referenced them or not. That is how a hand-written `help.md` and a `.stl` mesh
  were deleted from disk. A save now only removes an asset the part's own
  previous `parts.yml` named, and only when it is being replaced or cleared —
  anything else beside `parts.yml` is left alone. The dev "Update Standard"
  mirror and the bundled-library refresh follow the same rule: they copy over
  the top rather than emptying the folder first, and the mirror refuses outright
  when the copy it would overwrite carries a newer version than the one being
  promoted.
- **Snakie downloads packages, instead of asking the board to.** (#776,
  supersedes #769) Installing a driver or a package used to run `mip.install()`
  **on the board** — which quietly required the *board* to have its own internet
  connection. Most don't: a Pico, a Tiny 2350, any board without a radio could
  never install anything this way. Even a Wi-Fi board needed `mip`, an optional
  micropython-lib package that CircuitPython and many vendor builds leave out,
  so the failure usually arrived as a bare
  `ImportError("no module named 'mip'")`.

  Now the machine with the internet connection does the downloading. Snakie
  resolves the package on your computer and writes its files to the board, which
  only has to do the thing every board can do: accept files. That reaches a
  CIRCUITPY drive or the serial REPL through the same path every other file
  write uses, so one route covers MicroPython and CircuitPython, wired and
  wireless boards, and the simulator — which could never install anything
  before. Whole packages come across, not just single files: the Modulino driver
  installs all 25 of its files, including its three transitive dependencies.
  It applies to the Packages panel too, not just drivers.

  When an install can't proceed, the message now says which half failed —
  downloading the package, or writing it to the board — and what to do about it,
  instead of handing back the board's `ImportError`.
- **An onboard LED's real size survived saving and vanished on loading.** The
  YAML writer passes an LED through whole but the reader rebuilt it field by
  field, so `sizeMm` (and a hand-placed silk label) were dropped on the next
  load — the bundled LED Bar has authored 2.5 mm segments that never reached the
  renderer. The reader now names them, and `single` LEDs are drawn life-size like
  NeoPixels already were, so a 5 mm LED on a 20 mm module reads as the quarter of
  the board it is. Its glow is a fixed ring around the package rather than a
  multiple of it, so an ordinary indicator looks exactly as it did.

### Changed
- **The flash dialog's Runtime choice now has a picture on it.** MicroPython and
  CircuitPython were two identical text buttons, told apart only by reading them
  — on the one control in Snakie where picking the wrong option writes the wrong
  firmware to your board. Each now carries a glyph: a **chip** for MicroPython (a
  microcontroller — the *micro* half of the name) and a **routed PCB trace** for
  CircuitPython (the *circuit* half). Neither is the project's own logo — those
  are trademarks — they're simple original drawings in Snakie's line style, one a
  compact block and the other an open diagonal, so they stay apart at icon size.
  The names stay next to them: an icon-only control here would be asking you to
  guess. The selected runtime is now marked by a tick, a heavier ring and bolder
  text as well as the accent colour, so it reads without relying on colour at
  all, and the Source toggle below it uses the same accent instead of the old
  hardcoded blue.
- Installing a driver can now write **binary** files to a board, not only source
  text (#758). Both device write paths already carried bytes — the CIRCUITPY
  drive writes them directly and the raw REPL hex-encodes its chunks precisely so
  arbitrary bytes survive — but the boundary between them only carried strings,
  which would have silently corrupted every `.mpy` in the UTF-8 round-trip.
- **The help and the autocomplete now teach whichever Python your board is
  actually running.** (#763, epic #209) Snakie's reference pages and editor
  completions were MicroPython throughout: `machine.Pin`, `time.sleep_ms`,
  "Install packages (mip)" — and the only CircuitPython entries in the
  completion list were two empty stubs. Plug in a CircuitPython board now and
  the Help panel swaps its hardware section for **board · digitalio · analogio ·
  pwmio · busio**, plus the three things that actually catch people out —
  `code.py` and auto-reload, the read-only filesystem, and installing libraries
  from the Adafruit bundle — while `machine.Pin`, `sleep_ms` and mip disappear
  entirely. The completions follow the same catalogue, so `time.` on
  CircuitPython offers `monotonic()` and not `sleep_ms()`, and typing `from
  mach…` there gets a suggestion that says it doesn't exist on this runtime and
  shows what to write instead. Right-click → *Help for symbol* on a `machine`
  pasted out of a MicroPython tutorial opens the page that replaces it rather
  than nothing. Plain Python — control flow, classes, types, built-ins — stays a
  single set of pages shared by both, and the section that used to be called
  "MicroPython Language" is now "Python Language" with the runtime-specific
  pages split out beneath it. **With no board connected nothing is guessed:**
  both runtimes are shown side by side, each entry labelled with the Python it
  belongs to, and three pills at the top of the Help panel (Auto · MicroPython ·
  CircuitPython) pin it to one if you're reading before you plug anything in.
  There's also a new "Coming from MicroPython" page: the whole translation
  table, `Pin(15)` → `board.D15`, on one screen.
- **Electronics and Build now show the SAME component hierarchy.** (#718, epic
  #720) There used to be two trees describing one robot and disagreeing about
  it: the board browser listed the microcontroller and your placed parts nested
  by what they're plugged into; the Build dock listed URDF links and joints
  nested by how they're jointed together. Same idea, different rows, different
  behaviours. Now there is one tree, in one component, in both workspaces — a
  part and its 3-D body are a single row, carrier nesting is preserved (a XIAO
  still sits inside its expansion base), and rows that only exist in Build
  (structural blocks) appear in Electronics too, dimmed and inert, rather than
  being hidden — so the shape of the tree reads identically wherever you are.
  Only PARTS are rows: a part that's jointed to another carries a joint icon
  shaped by the joint's type, rather than the joint taking a row of its own and
  doubling the length of the list. Click the icon to edit that joint (right-click
  the row to rename it); a part with nothing above it — the base, a stray import
  — simply hasn't got one. It also *looks* the same in both places now: the
  hierarchy carries its own card — surface, hairline, ink and spacing — instead
  of borrowing whatever chrome the dock around it happened to have, so the Build
  tree reads as the board browser's tree rather than as bare rows floating on the
  3-D scene. Every colour in it is a theme token, so it stays readable on the
  dark skin and on parchment. Clicking a row selects it and zooms to fit it in
  whichever workspace you're in, and the selection now survives switching
  workspace (it even carries into the popped-out Board View window).
- **Honest mass: the robot tells you how much of it has actually been weighed.**
  (#719, epic #720) The centre of mass has always been computed from the parts
  whose mass is known, silently leaving the rest out — so a balance verdict from
  4 of 12 parts looked exactly like one from all 12. Every row in the hierarchy
  now carries its weight in its tooltip, stated as unknown when there isn't one;
  a line under the tree states the coverage ("mass known for 4 of 12 parts") and turns
  amber below full; the Build panel's total is marked as the lower bound it is;
  and the centre-of-mass overlay's readout says "4/12 weighed" while the picture
  is partial. Nothing is ever invented to fill a gap — no family estimates, no
  default masses, and a 0 g body reads as *unknown*, not weightless.
- **A Sync button keeps Electronics and Build honest with each other.** (#717,
  epic #720) The same control in both workspaces (and the pop-out board window)
  shows a badge when the two disagree, and opens a reconcile dialog where YOU
  decide each difference: a part with no 3-D body can be added, a stand-in box
  whose part now ships a real mesh can be upgraded in place, a library weight
  can be applied to a body that lacks one (never over a mass you measured), and
  — per the long-standing #626 design — deleting a part flags its 3-D body
  instead of destroying it, with a three-way choice: keep it in Build, remove
  it, or re-add the part to Electronics. Nothing destructive ever happens
  without a click.
- **Every part you place now appears in the Build workspace.** (#716, epic #720)
  Previously only a part shipping a 3-D mesh reached the Robot View — a handful
  of the standard library — and batch-added parts never did. Now
  a part without a mesh gets a **footprint box**: its real dimensions extruded
  to a family-tuned height in a desaturated take on its PCB colour, so the 3-D
  scene resembles your robot and centre-of-mass geometry stays meaningful. New
  parts land at their breadboard position (mirrored onto the ground plane), a
  part that declares its weight arrives with real mass in the model, and an open
  Build view picks all this up live instead of waiting for a remount. Behind the
  scenes each placed part now remembers which 3-D link is its (`urdfLink`) — the
  spine the coming sync and unified-hierarchy work builds on.
- **Packages install in the browser too.** (#776) Snakie for Web had no
  `packages` backend at all: the Packages tab could list nothing, search
  nothing, and its Install button quietly did nothing. #776 is what made a web
  version possible — an install is no longer `mip` running on the board but
  "resolve the package on the host, write the files to the board", and in a
  browser the host is the page. So the curated list, PyPI search, `github:`
  specs and bare micropython-lib names (dependencies and all) now work on
  app.snakie.org exactly as they do on the desktop, over Web Serial or into the
  simulator.

  What a web page **can't** do is fetch from just anywhere — it is fenced in by
  its content-security policy and by whether the far end allows cross-origin
  reads at all. A `gitlab:` spec, a custom package index, or any other host is
  therefore refused **up front, by name**, with a line saying so and pointing at
  the desktop app — rather than the bare "Failed to fetch" the browser would
  otherwise give.
- **A bitmap font editor, so a display project can have its own typeface.**
  (#250, epic #247) Small displays ship with one tiny built-in font; this
  instrument lets you draw your own the way hand-made display fonts are made —
  a per-glyph pixel grid you click and drag on, a navigator across the whole
  charset, an adjustable cell (5×7, 8×8, whatever), and a preview line that
  renders your text at **1×** so you see the real thing before you flash it.
  It opens on a bundled 5×8 printable-ASCII starter font rather than a blank
  grid, so the first move is "fix the letters you don't like", and your drawing
  is parked as you go. Fonts can be fixed-pitch or proportional: **Auto-fit**
  shrinks every glyph to its own ink plus a pixel of spacing, growing the cell
  first so the widest letters still get their gap. Export writes a
  **`font-to-py`-compatible module** into the editor, so existing `Writer` code
  works unchanged — or a simpler packed `bytearray` + metrics module if you'd
  rather blit into a `framebuf` yourself. Importing an existing font module,
  uploading straight to the board and previewing on real hardware are follow-ups.
- **Grove Red LED, as a Standard library part.** Seeed's 5 mm red LED module
  (SKU 104030005) on a Grove digital port, drawn from the product photo: the LED
  in its white holder, the brightness trimmer, the switching transistor and the
  chip resistors, with `SIG`/`NC`/`VCC`/`GND` on the socket and a `help.md`
  covering the on/off and PWM-fade snippets. `SIG` is `digital` + `pwm`, so a
  design can fade it as well as blink it. No driver — `machine.Pin` is enough.
- **Run, Stop and Reset say what they actually do on a CircuitPython board, and
  the file tree shows which file boots.** (#755, epic #209) Run stays a raw-REPL
  execution on both runtimes — it will not overwrite your `code.py` — but it now
  says what that costs: your `code.py` stops, and the board waits at the REPL
  rather than going back to it. Reset is where the runtimes really differ, and it
  says so: on CircuitPython a soft reboot runs `code.py` again from the start,
  rather than just clearing the board. The device file tree marks the file the
  board runs at boot — and marks one it will **ignore**, because CircuitPython
  tries `code.py` before `main.py`, so a board carrying both runs only the first
  and edits to the other appear to do nothing.
- **Files, drivers and libraries can be written to a CircuitPython board.**
  (#754, epic #209) CircuitPython's filesystem is read-only *to the board* while
  its CIRCUITPY drive is mounted, so every file operation Snakie has — the Files
  panel, driver installs, the instrument library, the Modules manager — used to
  fail with a bare `OSError: 30`. Those operations now go to the drive instead.
  Reads go there too, so listing a folder no longer has to interrupt a running
  `code.py` to do it, and a file copy replaces the hex-over-serial transfer.
  Writes are flushed before returning, so CircuitPython's auto-reload can't catch
  a half-written file. A board that has taken its filesystem back with
  `storage.remount` still works exactly as before, over the REPL — and if a write
  does hit the read-only filesystem, the error now explains it instead of naming
  an errno. The flash gauge measures the drive, which is the number that answers
  "will this fit".
- **Snakie finds a CircuitPython board's drive, and says what the board is before
  you connect.** (#753, epic #209) A board running CircuitPython mounts a
  **CIRCUITPY** volume, and its `boot_out.txt` names the version and the
  per-board build id — so the port picker can read "CircuitPython 10.2.1"
  against a board nothing has connected to yet. A drive is tied to its port by
  the board's own id, matched against the port's USB serial number, so two
  boards on one desk can't swap identities; where that can't be established it
  says nothing rather than guessing, because the next phase writes files to
  whichever drive this picks. Renamed drives are still found — the marker file
  decides, not the label.
- **Snakie can tell which Python your board is running.** (#752, epic #209) The
  connect probe now reads `sys.implementation`, so the session knows whether a
  board runs **MicroPython or CircuitPython** instead of assuming — the
  foundation the rest of the CircuitPython work is built on. The status bar names
  the runtime and version beside the port, with the board string on hover, and
  the connect greeting is rebuilt in that runtime's own wording rather than
  MicroPython's. A board that won't answer stays unidentified rather than being
  guessed at, and the previous board's runtime can't linger after you unplug it.
- **A display part can declare its size in pixels.** (#780) A part with a panel
  now carries a `display` block in `parts.yml` — `width`, `height` and a `colour`
  depth — so its resolution is a fact the part states rather than something each
  sketch or instrument re-guesses. This is deliberately **not** `dimensions`,
  which is the board's physical size in millimetres: a display part has both, and
  they are unrelated numbers. `colour` is named after bits per pixel (`mono`,
  `gray2`, `gray4`, `gray8`, `rgb332`, `rgb565`, `rgb888`) to match MicroPython's
  `framebuf` formats, so "gray4" can't be misread as four grey levels. Populated
  for the **Modulino LED Matrix** (12 × 8) and the **XIAO Expansion Base**'s
  onboard 0.96" SSD1306 (128 × 64). Reading it back on the board is a follow-up.
- The per-platform mount-point scanning behind board detection is now in one
  place (`fs/volumes.ts`) instead of being hand-rolled once per board type, and
  it no longer reads every folder in your home directory looking for a board.
- **The sprite reference rules are back down to one copy each** (#797, epic
  #789). The inline thumbnail (#790), the filename autocomplete (#791) and the
  "used in" back-link (#792) shipped as three phases, and the later two each grew
  their own copy of a rule the first already had: a Python tokeniser, a
  `dirname`, "which candidate does this reference mean", and "a file opened off
  the board isn't on this filesystem". All four now live once, in
  `sprite-refs.ts`, with both scanners built on the one tokeniser. Nothing
  changes on screen — except that a Python file sitting at a filesystem root
  (`/main.py`) now looks for its sprites beside itself, which the editor's own
  copy of `dirname` had been skipping.

## [0.44.0] - 2026-08-16

### Added
- **Arduino's Modulino range, as Standard library parts.** (#721, #722) The
  Modulinos are one board with different hardware on top, so the shared half —
  the 41 × 25.36 mm outline, both QWIIC sockets wired in parallel onto one bus,
  the generated 3-D mesh and the driver wiring — is authored once and each module
  fills in the rest. **Buttons, Buzzer, Distance, LED Matrix, Light, Motors** and
  **Movement** ship in this release, each with its own `help.md`, I²C address and
  mass. All thirteen declare the same catalog module, so a design using several
  is offered **one** driver install rather than one per board. A conformance test
  runs over every `modulino-*` part, so the modules still to come can't drift
  into subtly different boards.
- **The full-screen catalog, and a part's details, grow out of the control that
  opened them.** Pressing the expand button or a card's disclosure scales the new
  view out of that button rather than replacing the screen, and closing either
  one runs it backwards, shrinking back into the control it came from — so both
  read as a detour you can back out of, with your place still visible behind.
  Honours `prefers-reduced-motion`.
- **Rotate a part 90° in the Part Editor.** (#749) Two buttons on the canvas
  toolbar turn the whole board — pads, holes, connectors, components, labels,
  outline and both photos — so a board photographed portrait can be re-authored
  landscape and stay that way. It's a real edit, not a view transform, and it
  round-trips exactly: four turns restore the part unchanged.
- **Filter the parts catalog by type, manufacturer and tag.** (#740, #747) Type
  and manufacturer are facets — every part has exactly one, always shown, always
  counted against the *other* active filters, so a value that would return
  nothing reads as the dead end it is. Tags are a ranked layer beneath them, with
  the ones that merely restate a facet dropped and the long tail behind a
  disclosure. The facets live in a left-hand sidebar in the full-screen catalog;
  filtering collapses the category shelves into one flat grid, with each card
  carrying the type its shelf heading used to supply.
- **A board's corner radius can be given in millimetres.** (#739) How a PCB is
  actually specified, and the number on a mechanical drawing — rather than a
  fraction of the board's smaller side.
- **Cabled leads route around boards instead of across them.** (#745) A QWIIC
  lead used to run diagonally over the face of the board it left, hiding the silk
  and reading nothing like a cable. A lead now leaves along its socket's axis and
  drapes its slack outside the bodies it would otherwise cross, following the way
  its plugs point.
- **A full-sized part details view in the parts catalog.** (#748) A catalog card
  has room for a picture, a name and one truncated line; everything else a part
  knows was either buried in the narrow docked panel or not surfaced anywhere.
  Hovering a card now reveals a **disclosure** on its picture, and clicking it
  opens the part full-screen: the board drawn large with its pinout labels (and
  the flip, for a two-sided part), its schematic, and — for a part that ships an
  STL — a **3-D model** you can orbit. Beside it: manufacturer, part number,
  package, voltage, real dimensions in millimetres, mass, I²C addresses and the
  author's own spec rows; what driver it installs and from where; the modules it
  works with; its links; and its bundled `help.md`, rendered. The disclosure has
  its own hit area, so opening the details never ticks the card, and closing
  (✕ or Esc) lands you back in the grid with the selection and filters exactly
  as you left them — a part can also be ticked into the selection from the
  details view itself. A panel with nothing to say isn't drawn at all, and the
  3-D tab appears only when the model can actually be loaded, rather than
  offering an empty frame.
- **Author a part's drivers in the Part Editor.** (#655) A part that needs a
  MicroPython file on the board — what makes the Driver Install prompt fire when
  it's placed — could until now only say so via hand-edited `parts.yml`, so a
  community part couldn't ship a driver. A new **Drivers** section adds, edits,
  reorders and removes them, and makes the tricky rule visible: the install
  method (catalog module / mip / copy) is detected as you type, and the target
  field is relabelled to match — an install *folder* for mip, a full *path* for
  copy — because typing a path where mip wants a folder installs to the wrong
  place. Catalog modules are picked from a list so a bad id can't be authored,
  files that ship beside the part are offered as sources, and a bundled filename
  that isn't actually there is flagged at authoring time instead of on hardware.

### Changed
- **One mesh load path.** (#742) STL loading, measurement and placeholder
  geometry were duplicated across the robot and part views; they now share one
  module, which is also what the new 3-D part view is built on.

### Fixed
- **QWIIC connectors are drawn life-size, and the right colour.** The socket was
  smaller than the real part; it's now the JST-SH datasheet's 6.0 × 4.25 mm, with
  the board socket ivory and the cable plug white, as the real housings are.
- **Modulino I²C addresses are the ones a bus scan actually reports.** The
  MicroPython library declares each module's address in its **8-bit** form and
  shifts it before touching the bus — but only for modules with an onboard MCU.
  Three parts and most of the known-devices table carried the unshifted number,
  so I²C-detect could never name an MCU module: Buttons is `0x3E`, not `0x7C`.
- **Pin numbers and labels read upright on a rotated part.** (#746) Boxed labels
  on a part turned 180° were upside-down; they now counter-rotate to stay
  readable whatever the body's angle.
- **A part's title clears its top-edge pin labels** instead of overlapping them.
- **The part detail view flips the board, not the mat it sits on.**
- **Catalog cards read as a grid again.** Titles sit above the picture and always
  reserve two lines, so every image lines up; long names wrap rather than
  truncate; the FRONT/BACK badge and the SKU are gone; category headings hug
  their text; and the shelves fill their width, so they show as many columns as
  the filtered grid does.
- **The catalog's facet sidebar is legible in the dark theme** — it was styling
  itself from the theme tokens while sitting on a deliberately light panel, which
  put near-white ink on a near-white background.
- **`npm run dev` no longer trips macOS malware protection.** (#708) Apple
  revoked the stock ad-hoc Electron signature; the dev binary is re-signed on
  postinstall.
- **Mini board hover labels no longer crop at the old frame when zoomed out.**
  Hovering the mini board reveals the full pinout without re-framing (so the
  board doesn't resize under the pointer), which lets labels run past the frame
  — and the SVG was hard-cropping them at that original boundary even when
  zooming out had opened up empty space all around the board. The labels now
  paint into whatever room the panel actually has, clipped only at the panel
  edge.
- **A stale driver no longer reads as installed.** (#707) The Driver Install
  banner and the Modules manager only checked that a driver was *present*, so a
  board carrying an old copy of a bundled driver was never offered the newer one
  Snakie ships — a sketch using a new driver feature failed while the app
  insisted the driver was installed, and the only way out was deleting the file
  by hand. Every bundled driver now declares a `__version__`; on connect the
  `/lib` copy's version line is read back (one line over the wire, the #700
  mechanism) and compared against the shipped version. A stale copy shows as an
  **update** — the banner words the row and button as one, and the Modules
  manager swaps the INSTALLED stamp for an UPDATE key. A copy that imports from
  somewhere Snakie doesn't manage (a hand-placed root file, frozen firmware) is
  left alone, and a unit test keeps each driver's `__version__` and the
  catalog's declared version in lockstep so a driver edit can't ship without
  the bump that lets boards hear about it.

## [0.43.0] - 2026-08-02

### Added
- **Define a part's internal wiring in the editor.** A new **Rails** section lists
  one row per internal net — name it, then add its pins — so a distribution board
  can say that its power terminal feeds every servo header. Wire one pin of a rail
  and the rest go live with it. Previously this could only be written by hand in
  `parts.yml`. Pins are picked from the part's own list rather than typed (a rail
  joins by name, so a typo would join nothing), and a pin can only sit on one rail.
- **Say which wiring a Grove or JST group is.** A connector built as a group of
  pins could pick its housing type but not its wiring, so a Grove port couldn't
  declare itself I²C, UART, digital or analog — and a lead that shouldn't fit was
  allowed to. The housing menu now offers **Port type** for Grove and **Family**
  for JST, so the check that catches a plug fitting a differently-wired port works
  for these as well as for built-in connectors.
- **A Grove Ultrasonic Ranger test.** `examples/ultrasonic_test.py` answers "is it
  wired right, and is it any good?" — a burst of pings that stops with a plain-
  English checklist if nothing comes back, then raw unsmoothed readings with the
  echo rate, spread and worst jump between consecutive readings. The demo hides a
  bad reading; this one shows it to you.
- **A Grove Ultrasonic Ranger demo.** `examples/grove_ultrasonic_demo.py` reads the
  distance and feeds the Range instrument's gauge, with the two things that make an
  ultrasonic reading trustworthy built in: it paces the pings so it never measures
  the previous one's echo, and it takes a median of the last few readings so a
  single bad reflection doesn't make the gauge jump. "No echo" is reported as
  exactly that rather than sent to the gauge as a distance.
- **Tell Snakie how your IMU is mounted.** The tilt maths assumed a sensor lying
  flat, so a module mounted on its edge showed a permanent 90° lean and sent your
  rotations to the wrong axis of the IMU panel. The LSM6DS3 driver now takes an
  `axes` argument describing the mounting, applied once at the source so
  acceleration, gyro and attitude all arrive the right way up. It can work the
  setting out for you: one reading of a stationary board tells you which way is up,
  and a second with the nose pointed at the floor pins the rest down exactly. That
  second reading is what stops roll and pitch coming out swapped — gravity alone
  can't tell a mounting from the same one turned a quarter-turn.

### Fixed
- **The IMU's 3-D board now moves the way the numbers say.** Pitching the sensor
  rolled the picture instead — the model is built with its nose along the screen's
  horizontal axis, so the pitch angle was being applied about the nose, which is
  what roll means. The readouts underneath were right all along. The board is also
  drawn from above and in front now, so a level sensor reads as a slab lying flat
  and a 90° pitch visibly stands it on end, rather than the previous straight-down
  view where a pitch mostly moved the board toward you.
- **Deleting a driver from your board now offers it again.** Snakie decided a
  driver was installed by importing it, and MicroPython remembers imported modules
  for the rest of the session — so once anything had used a driver, deleting the
  file left Snakie still believing it was there. Removing and re-adding the part
  didn't help, because the part wasn't what was stale. It now asks the filesystem
  rather than the board's memory.
- **The I²C pin dropdowns match the board you actually have.** The bus/SDA/SCL
  lists were built from one hardcoded rule — the Pico family's, where SDA must be
  a multiple of 4 (or 2) and SCL the very next pin. On anything else that rule is
  wrong: a XIAO ESP32-S3's Grove port is GPIO5/GPIO6, which the rule can't express,
  so the pair that works was never offered and the nearest legal-looking one was
  shown instead — scanning it finds nothing on a correctly wired board. The lists
  now start from the pins the board itself declares, and keep the derived ones for
  boards that declare none.
- **Connecting a board no longer freezes the REPL and fills it with gibberish.**
  Snakie checked whether your board's copy of the instruments library was current
  by reading the whole 80 KB file back — 161 KB once encoded for the serial link,
  about 14 seconds at the usual speed, against a 10-second limit it could never
  meet. So every connection locked the terminal up, gave up, and then spilled the
  half-delivered file into it as a wall of hex. It now asks the board for the
  version line alone, so the check is instant; a read only times out if the board
  actually goes quiet, rather than because the file is big; and if one does fail,
  the connection is settled before the terminal starts listening again.
- **I²C examples now say which board they're for.** Every example shipped with
  Snakie used the XIAO RP2040's pin numbers while calling them "a XIAO" — but the
  Grove port is `D4`/`D5` on every XIAO and the GPIOs behind those names differ by
  board, so on a XIAO ESP32-S3 the examples addressed the wrong pins entirely. The
  bus just goes quiet: an I²C device that isn't there doesn't report anything.
  Examples now name their board and give the ESP32-S3 numbers alongside, and the
  bundled XIAO ESP32-S3 part's pins are corrected — all eleven had been copied from
  the RP2040.

## [0.42.0] - 2026-08-01

### Added
- **A part's power LED lights when it actually has power.** Add a **Power indicator**
  LED to a part and the Board View lights it from the solved circuit, so a breakout
  that isn't reaching its supply simply sits there dark — the same thing you'd look
  for on the bench. It uses the part's supply range if it has one, so an under-volted
  part reads as browned out. With no solvable circuit at all the LED draws as it
  always has, rather than claiming a part is unpowered when nothing is known.
- **A part can say which of its own pins are wired together.** A driver board
  passes power through rather than using it — a PCA9685's V+ terminal feeds all
  sixteen servo headers — and that connection was invisible, so a servo on a
  header read as unpowered even with the terminal wired to a battery. Parts can now
  declare their internal rails, and the PCA9685 and Servo 2040 do.
- **Snakie warns when a part is on the wrong supply.** A part's electrical model
  only described the current it draws, so nothing knew a 3.3 V sensor was wired to
  5 V — the commonest way to destroy a breakout. Give a part a supply range in its
  properties and the checker flags it: too high is an error (it damages the part),
  too low a warning (it browns out rather than dying).
- **Turn a part's connectors into groups of ordinary pins.** A connector's contacts
  couldn't be clicked, rubber-band selected, or edited with the full pin inspector
  — they were only reachable through the connector's own small editor. **Convert to
  pin groups** in the connector's properties turns them into ordinary pins that
  keep their housing, so they behave like every other pin while still taking a
  lead. Nothing moves on screen and existing wiring is untouched.
- **Set a connector contact's capabilities.** The contact editor could set a name,
  type, GPIO and I²C bus but never the capabilities, so a socket's SDA couldn't be
  marked as I²C without editing the file by hand.
- **Set how many contacts a JST or DuPont connector has.** Both were stuck at
  whatever they were created with — four — so a two-wire battery lead had to be
  built as a four-way and trimmed by hand. There's now a Contacts field, working
  the same way a terminal block's does: what you've already set up is kept, and
  shrinking drops from the end. QWIIC and Grove stay fixed at four, because that's
  what they are.
- **Duplicate a whole group.** A ⧉ button on a group row in the layers list copies
  the group and everything in it — including its connector housing, so duplicating
  a servo header gives you another servo header rather than three loose pads. The
  copied pins are renamed (`S1` → `S2`), because a pin's name is what a wire
  points at.
- **Copy the flashing log.** A **Copy log** button above the output puts the whole
  log on the clipboard — including the chip details at the top, which have usually
  scrolled out of sight by the time a flash finishes — with the terminal escape
  codes stripped so it pastes cleanly into a bug report.
- **Erase before flashing, and a steer towards the best build for your board.** A board
  arriving from other firmware keeps its old partition table through a plain
  flash, and then boot-loops — appearing for a second and dropping off again,
  which looks exactly like a failed flash even though the flash worked. The
  flasher can now erase first, and does by default on the boards that need it.
  Boards that have a best-fit build now say so up front — a XIAO ESP32-S3 gets
  more from the `SPIRAM_OCT` firmware, because it has octal PSRAM — while being
  clear that the plain build runs too.
- **Pick your board in the firmware flasher, and it sets the rest up.** Choosing
  the actual board — a XIAO ESP32-S3, a Pico, a micro:bit — now fills in the board
  type, the flash offset and the firmware family, and warns you if the build you
  picked is for a different chip. This matters most on ESP: only the original
  ESP32 flashes at `0x1000`, every other ESP chip at `0x0`, and getting it wrong
  flashes **without any error** and leaves the board silent. Boards that use their
  own USB (like the XIAO ESP32-S3) now say so, because they come back on a
  different port after flashing. The list includes boards the upstream firmware
  catalog doesn't carry, the XIAO ESP32-S3 among them.
- **Turn a group of pins into a connector.** Select a group in the Part Editor's
  layers list and pick a housing — QWIIC, Grove, JST, servo header or terminal
  block — and its pins become that connector's contacts, so a lead can plug into
  them. The housing centres itself on the pins you already placed, and stands on
  end when they run in a column. Nothing about the pins changes, so a part you
  convert keeps every wire that was already attached to it.
- **A servo lead cables to the Servo 2040's headers.** All 24 of its 3-pin headers
  (18 servo outputs and 6 sensor headers) now carry a real connector housing, so a
  servo plugs in with one drag instead of three wires. Nothing about the board's
  pins moved, so existing designs keep their wiring exactly as it was.
- **A servo lead cables to a servo header in one drag.** The servo-header tool now
  places a real 3-way connector rather than three loose pads, so dragging a
  servo's lead onto it wires Signal, V+ and GND together — the way a QWIIC cable
  already worked. It still looks like the familiar three-pin column, and its
  contacts are coloured by electrical role: amber signal, red V+, dark ground.
  Dragged on backwards it still lands the right way round, because a lead pairs by
  position, not by drag direction.
- **JST connectors have a family.** A JST housing is a range of pitches, not one
  part — SH 1.00, GH 1.25, ZH 1.50, PH 2.00, XH 2.50, VH 3.96 mm — and the pitch
  is what decides whether a lead physically seats. Pick the family in the
  connector's properties and the housing draws life-size for it; a lead between
  two different families is refused, naming both. Connectors authored before this
  are treated as PH, exactly how they drew before.
- **Declare a part's I²C addresses in the Part Editor.** A new **I²C** section in
  the inspector lists the addresses a part answers on — which is what lets the
  I²C-detect instrument offer that part when a scan finds it on a real bus. Until
  now the field existed in the schema but could only be hand-written into
  `parts.yml`, so the commonest breakout there is — an I²C sensor — could not be
  fully authored in the app. Type `0x76`, `76h` or a decimal; the editor shows the
  address it parsed back to you, names the device usually found there, and warns
  (without blocking) on addresses the I²C spec reserves or that another part in the
  library already claims.
- **Screw terminal blocks in the Part Editor.** Add → **Terminal block** places the
  familiar green block; set how many terminals it has in the inspector and it
  grows or shrinks to match, keeping the contacts you had already configured. Its
  terminals are ordinary pins — name them, give them a GPIO, a type and
  capabilities exactly like header pins — and because they belong to the block
  itself they travel with it and can't be scattered out of it.
- **<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>D</kbd> duplicates the selected item** in the
  Part Editor — the same action as the canvas toolbar's ⧉ button, for pins,
  shapes, labels, connectors and mounting holes.

### Fixed
- **Cable plugs sit the right way round, and their leads run as one bundle.** The
  plug drawn at each end of a lead was angled diagonally when the socket was a
  group of pins rather than a built-in connector, and the lead's conductors fanned
  apart instead of staying together: the contacts each worked out their own
  direction, so they disagreed. A plug now lies along the contacts it covers with
  the cable leaving one end — one rule for every connector type — and every
  conductor leaves through that same end, so a servo lead bundles like a QWIIC one.
  Plugs are also drawn at their real size now — a 3-way servo plug is 7.62 × 2.54 mm,
  one 0.1" cell per pin — so wiring several servos to a PCA9685 no longer piles
  overlapping plugs on top of each other.
- **A connector's housing follows its pins.** Move, align or rotate a group with a
  connector on it and the pads went where you put them while the housing stayed
  behind, drawn at the old spot and often facing the wrong way. The housing is now
  worked out from the pins it holds, so it can't drift from them — for every
  connector type, not just the one this showed up on.
- **A servo lead now cables to a servo header in one drag.** The SG90's three pins
  were grouped but the group had no connector on it, so there was nothing to drag
  a lead *from* — the header end was ready, the servo end wasn't. Its lead is now a
  proper 3-way connector, so dragging it onto a PCA9685 or Servo 2040 channel wires
  signal, power and ground together.
- **A converted connector still looks like a connector.** Turning a part's
  connectors into pin groups left its sockets drawn as bare pads. A QWIIC, Grove,
  JST or terminal housing is now drawn behind its pads, as it always was. A servo
  header deliberately isn't — its pins are the connector, and a block behind them
  just doubles it.
- **No more deprecation warnings when flashing an ESP board.** Newer versions of
  the flashing tool renamed their commands, printing two warnings on every
  otherwise-successful flash — and would have stopped accepting the old names
  altogether in a future release. Snakie now uses whichever spelling the installed
  version expects.
- **The connector contact list is far more compact.** Each contact took two
  labelled rows — name and type, then GPIO underneath — so a sixteen-way block ran
  to thirty-two rows of mostly empty space and the fields never lined up. Contacts
  are now one row each under a single header, in aligned columns.
- **Selecting a group highlights everything in it.** The group row lit up but its
  contents didn't — apart from one pin in the first group, which happened to be
  the selection's anchor. Every member of a selected group is now highlighted,
  including members of any nested groups inside it.
- **Dragging a selected group moves all of it.** With a group selected, dragging
  one of the highlighted parts moved only the part under the cursor — the
  selection looked like a unit and behaved like a pile. Dragging anything in the
  current selection now moves the whole selection together.
- **A group disappears when you delete the last thing in it.** Removing some servo
  headers left their groups listed in the Layers panel with nothing inside, and
  they couldn't be got rid of: clicking an empty group selects nothing, so pressing
  Delete on it appeared to do nothing at all. Groups are now cleared out the moment
  their last member goes, and any already stranded on a board are cleared when it's
  next opened.
- **Servo headers label themselves sensibly.** A row of headers near a side of the
  board threw every signal label out to that edge, stacked over each other,
  because the label followed the nearest edge without regard for which way the
  header runs. A servo trio is a vertical column, so its label now reads to the
  nearer top or bottom edge instead — never sideways. Boards made before this are
  re-aimed the same way when opened.
- **A servo header shows only its signal label again.** V+ and GND started
  printing alongside it, which on sixteen headers is thirty-two labels of noise
  over the names you actually read. They are hidden by default once more — as a
  display rule, so headers already on your board pick it up with nothing rewritten.
- **Castellated pads face the right way when you flip the board.** Turning a board
  over moved its castellations to the mirrored side but left them pointing the way
  they were authored, so their half-holes were cut on the wrong edge and ran back
  into the board instead of off it. A pad seen from the far side now mirrors its
  facing along with its position — including the hole cut out of the PCB beneath it.
- **A board's front and back photos are placed independently.** Adding a rear
  image gave it the front board's proportions, and moving, resizing or
  aspect-locking the back quietly changed the front instead — the change only
  showing up when you flipped over. Every image control now acts on the face
  you're looking at, including the background eraser, which was mapping clicks
  through the front photo's box while you worked on the back.
- **The firmware file picker only offers files your board can use.** It listed
  `.bin`, `.uf2` and `.hex` to everyone, so browsing for ESP firmware showed UF2
  files that could never work. It now offers just the one kind your board flashes
  with.
- **Flashing a `.uf2` to an ESP board is now refused.** esptool can only write a
  raw `.bin`. Handed a `.uf2` it wrote the container instead of the firmware —
  reporting success at every step, verifying the same wrong data, and leaving the
  board restarting in a loop with nothing to say why. The file you pick is now
  checked against how your board flashes, and a mismatch explains itself instead
  of flashing.
- **The board you pick keeps its flash offset.** Choosing a board set the right
  offset, and then the background scan for connected boards quietly set it back —
  it only knows the coarse board type, whose ESP default is the original ESP32's
  `0x1000`. On an ESP32-S3 that flashes to the wrong address, which succeeds and
  leaves the board dead. Your choice now wins over the scan, and changing the
  board type by hand drops the board selection rather than half-overriding it.
- **ESP32-S2 firmware flashes to the right address.** It was being written at
  `0x0`. Espressif moved the bootloader to `0x0` from the S3 onwards — the S2 keeps
  the original ESP32's `0x1000`.
- **The flashing log is big enough to read.** The output from the flashing tool
  showed about ten lines and collapsed to a couple early on — exactly when the
  connection messages appear — so you couldn't tell whether a flash was
  progressing. It now holds a minimum of ten lines and grows to about twenty.
- **Servo headers you add are selectable again.** The servo-header tool briefly
  made each header a single connector, which bought one-drag cabling at the cost
  of the pads: you could no longer click a signal pin, edit it, or find the header
  in the layers list. Each header is once more a trio of ordinary pins in a named
  group — and that group carries the connector, so a servo lead still plugs into
  all three at once. You get both.
- **Align, distribute and rotate now cover every kind of grouped item.** Selecting
  and dragging a group already treated connectors, LEDs, buttons and mounting
  holes as members; aligning or rotating one silently ignored them. A group made
  of any mix now aligns, distributes and rotates as one rigid unit — and a
  connector's own body rotation is turned a quarter with the group rather than
  being overwritten.
- **Connector contact labels sit at the board edge, like every other pin.** They
  were drawn by the connector renderer, which had its own copy of the pin-label
  logic and its own idea of where a label goes. Contacts now label through the
  same path as header pins, so they land at the board outline in the standard
  style — and a rotated housing no longer needs any special handling, because the
  labels are placed from the contacts' real positions rather than being spun round
  with the body. A contact with no pin number no longer draws an empty grey chip.
- **Delete removes a marquee selection.** Rubber-band a group of items and press
  Delete and nothing happened: the marquee's selection lives in the canvas while
  the Delete key was only looking at the single selected item, which a marquee
  clears. Delete now removes everything selected, and deleting a group whose
  primary item is a connector, LED, button or hole removes the whole group rather
  than just that one item. Locked items are still skipped.
- **Servo headers show only their signal label.** A servo / DuPont header's V+ and
  GND are the same two rails on every header, so a row of eight printed sixteen
  labels of noise over the signal names you actually read. Power and ground are
  now hidden by default on that connector kind — it's a display default rather
  than saved data, so headers already on a board pick it up and nothing is
  rewritten on disk. Other connector kinds are unchanged: a QWIIC's GND and 3V3
  are worth printing, because you wire to them.
- **Groups of connectors, LEDs, buttons or holes select and drag as one.** Only
  pins, shapes and labels counted as group members, so a group made of anything
  else resolved to nothing: clicking it in the Layers panel selected nothing on
  the canvas, and dragging a member moved just that member out of its group. Every
  groupable kind now counts, so the group highlights on click and moves as a rigid
  unit. (Align and distribute still act on pins, shapes and labels only.)
- **Servo header labels follow the nearest board edge.** Headers placed with the
  canvas's servo-header tool had a label direction preset on them, which pinned
  every signal label to the TOP of the board however far down the header sat. The
  preset is gone, so labels now read out toward the nearest edge; the pin
  inspector's rotate control still aims a label by hand when you want that.
  Headers placed before this fix are migrated on load, so existing boards pick the
  new behaviour up without being re-added; a direction you set by hand is left
  alone.
- **Connector contact labels line up with their contact.** Every connector's
  labels were anchored on the text baseline, which after rotation left them
  sitting beside the contact rather than on it. They are now centred on the
  contact they name, on QWIIC, Grove, JST and servo headers as well as terminal
  blocks.
- **A rotated connector's labels still point off the board.** A connector's silk
  labels swung round with its body, so a vertical servo header threw its signal
  label sideways onto the next header along instead of out toward the board edge.
  The outward direction is now worked out in board space and the text
  counter-rotated, so a label reads the same way and sits clear of its neighbours
  whichever way the housing is turned.
- **Connector labels follow the nearest board edge.** A row of servo headers along
  the bottom of a board drew its signal labels above the housing, throwing them
  back across the board instead of out past the edge. Contact labels now sit on
  whichever side of the connector is nearer the board edge and read away from it —
  the same convention the board's own pin labels already followed.
- **Duplicating a pin gives the copy a fresh name.** A duplicated pin kept the
  source's name, so a board could end up with two pins called `SCL` and a wire
  endpoint (`<part>.SCL`) that pointed at either of them. The copy is now
  suffixed — `SCL` → `SCL2` — which is what duplicating a connector already did
  to its contacts.
- **You can type more than one tag on a part.** The Part Editor's Tags field
  ignored the comma key: its contents were rebuilt from the parsed tag list on
  every keystroke, and a trailing comma parsed away to nothing — so the field
  re-rendered without it and a second tag was unreachable by typing (pasting a
  whole list was the only way in). Tags are now chips: type one and press
  <kbd>Enter</kbd> or <kbd>,</kbd> to add it, <kbd>Backspace</kbd> on an empty box
  or the ✕ to remove one. Pasting a comma-separated list still works, and a tag
  left half-typed is committed rather than lost when you click away.
- **Editing a part no longer discards its I²C addresses.** A part's
  `i2cAddresses` survived on disk but was dropped the moment the Part Editor
  normalised it, so opening a sensor and saving it silently unlinked it from the
  I²C-detect instrument — a scan would find the device and no longer offer the
  part that matched it.
- **A group whose members are connectors, LEDs, buttons or holes keeps its name.**
  The check for "is this group still in use?" only looked at pins, shapes and
  labels, so a named group made of anything else looked abandoned and was pruned
  on save. The group itself kept working (an unregistered id is reconstructed on
  load), but its name and its hidden/locked flags were lost.
- **The board picker shows its scrollbar.** macOS hides overlay scrollbars until
  you scroll, so a capped list of twenty-odd boards read as the whole list rather
  than a truncated one — you cannot discover a scrollbar you have to scroll to
  reveal. The menu now keeps a visible bar and a stable gutter.

## [0.41.0] - 2026-08-01

### Added
- **Per-part status marks in the Parts list.** The library header's **↻ N behind**
  and **⇧ Publish** told you something needed attention without saying WHICH part.
  Each part now carries its own mark: **↻** when it is behind the bundled version,
  and (in dev) a green **●** when it has been edited since seeding and so differs
  from what ships. Hovering either explains it, with both version numbers.


- **Arduino Nano ESP32** joins the Standard library — 30 pins, with a photo of both
  faces, so it flips in the catalogue and in the Part Editor.
- **Pimoroni Tiny 2350** gains its Qw/ST connector, so it can be cabled up like the
  other QWIIC boards rather than needing pin-by-pin wires.


- **A white breadboard background** (Settings → Appearance). A plain white sheet
  with no grid and no paper texture — for printing and screenshots. The ink flips
  with it: ground wires, part titles and net tags go dark, because the breadboard
  had until now been hardcoded as a dark surface and a ground wire would otherwise
  have been drawn white on white.


- **Hover a catalogue part to see its back.** In the full-screen parts catalogue, a
  part with a rear photo does the same coin spin as the Part Editor's flip button
  when you hover it, and turns back when you leave. Only parts that have a picture
  of the back flip — a rear face with no photo would spin to a blank board and read
  as a broken image — and a small FRONT/BACK badge says which side you are looking
  at. Touch is excluded (a tap would flip it and tick the checkbox, with no way
  back), and `prefers-reduced-motion` fades instead of spinning.


- **"Open demo project" in Learn (#483).** One click installs the servo arm into a
  folder you pick and lands you in **Electronics** — the circuit, the 3-D model and
  `sweep.py` are one project, which is the thing the 3-D demo alone could never
  show. It refuses to write over an existing `servo-arm` folder rather than
  merging into it.


- **Shareable tutorial links (#483).** The address bar now tracks where you are in
  a course — `#/learn/robotics/3` — so a link restores the same entry point, and
  back/forward move between lessons. Unknown ids are ignored rather than shown as
  an error, leaving the gallery usable.
- **A lesson can declare the workspace it is about (#483).** `view: robot` on a
  lesson switches to Build when it opens, so the URDF course lands in the 3-D view
  and the board-view lesson lands in Electronics instead of leaving the reader to
  find what the words describe. Absent ⇒ stay put.


- **A lesson no longer overwrites your work (#483).** Revisiting a lesson dropped
  its starter code straight over whatever you had written, and opened another copy
  of the buffer every time. It now reuses the lesson's own buffer, and asks before
  replacing changes you made — once per lesson, since re-prompting on every visit
  just trains people to click through dialogs.
- **The servo-arm demo is now the same robot in all three workspaces.** It shipped
  with `parts: []` and `connections: []` — it bound pins to joints but placed no
  board, servos or wires, so Electronics was empty and nothing suggested the views
  were connected. It now wires a Pico to two SG90s on GP0/GP1 (the exact pins its
  `servoJointMap` drives), shares a ground, and powers the servos from VBUS. The
  project also ships in packaged builds, which it previously did not.

## [0.40.0] - 2026-07-31

### Added
- **Magic smoke (#618).** An ERC **error** now pours smoke out of the breadboard —
  from the shorted **pins themselves**, with a plume per fault so several shorts
  smoke in several places. It starts with a violent two-second blow-out (a flash
  and an expanding cloud) and settles to a steady plume over a glowing ember. Errors only: smoke
  that meant "this is questionable" would stop meaning anything. It stops moving
  under `prefers-reduced-motion` (still marking the spot), and stays pointer-inert
  so you can grab the part you have just cooked.

- **Boards have a back (#636).** A part can now carry a **rear face** — its own
  photo, and pins, connectors and components marked `side: rear`. A **Flip to
  back** control sits under the board in the Part Editor and in the Parts Library
  preview, with a coin-spin that turns the board on its edge; the library only
  offers it when the part actually has a back. Mounting holes are shared and
  **mirror** on the rear, where they really are once you turn the board over. Pins
  on the far face carry a **REAR** badge in the pin list, and anything you add
  while the back is showing lands on the back.
- **`smd` pad shape** — a rectangular surface-mount pad with **no drill**. The
  default `square` pad punches a hole, so until now there was no way to draw the
  underside pad array a XIAO uses.
- **Reset a bundled part to the version the app ships (#643).** Editing a bundled
  part correctly stops the seeder from ever overwriting it — but that also meant it
  could never pick up later structural changes, and there was no way back short of
  deleting the folder by hand. The Parts Library now says so: a selected part shows
  **"Bundled version X available — yours is Y"** with a **Reset to bundled** button,
  and the Standard library header carries an **"N behind"** count that restores them
  all in one pass. The copy being replaced is moved to the library's `.backups`
  folder first — image and help file included — so nothing is lost.
- **Four Grove drivers in the Modules panel (#638).** `lsm6ds3` (the 6-axis IMU
  on Seeed's Grove module — a *different* part from the LSM6DSOX already listed,
  which rejects its `WHO_AM_I` of `0x69`), `grove_ultrasonic` (the one-wire
  ranger, which the HC-SR04 driver can't drive because it holds trigger and echo
  as separate fixed-direction pins), `tb6612` (the Grove I²C motor driver, which
  pairs with the teleop mixer via signed `[-1, 1]` powers), and the MY9221 LED
  bar referenced upstream.
- **Motor instrument (#638).** A dock panel for a two-channel DC motor driver:
  signed power bars for A and B, a linked **Throttle** with **Trim**, and
  **STOP** / **BRAKE** / **STANDBY**. Built for the two measurements that are
  miserable to get by editing a literal and re-running — the **deadband** (where
  a wheel actually starts turning) and the **trim** that makes a rover track
  straight. Powers are signed and normalised (`-1`…`1`), the same unit the teleop
  mixer uses, so the panel doesn't care what driver is on the other end. The bars
  show what the board *applied* (`SNK MOTOR <a> <b>`), not just what was asked —
  a driver left in standby accepts every command and turns nothing.
- **"Works with" — the drivers a part *can* use (#638).** A part can now list
  optional modules and what each one unlocks, shown in its Parts-panel detail with
  per-module install and an on-board indicator. Deliberately separate from the
  driver-install banner, which pushes the drivers a part cannot work *without*: a
  carrier like the XIAO Expansion Base is a menu of optional peripherals, and
  someone using only its Grove ports shouldn't be nagged into an OLED driver. The
  expansion base now says which of its six onboard features need a driver — only
  two do.
- **PCF8563 RTC + SD-card drivers.** The two genuine gaps on that board. The OLED
  and buzzer were already covered (`instruments.py` ships its own SSD1306) and the
  user button needs nothing. A catalog module may now declare **no instrument** —
  an RTC is a real installable dependency with no panel behind it, so those group
  under "Other drivers" instead of being filed under an unrelated instrument.

- **The project browser shows what's docked into what (#649).** A part seated in
  a carrier now renders indented beneath it, with a guide line — a XIAO appears
  under the XIAO Expansion Base rather than as a sibling three rows away. The
  microcontroller nests too, since it is the one that gets docked.
- **Clicking a browser row selects the component (#648).** It zoomed to the item
  but left it unselected, so the browser couldn't show what it had just navigated
  to. A row click now behaves like clicking the thing on the canvas: the row
  highlights, the selection ring draws, and a part gets its mini-toolbar.
- **The browser highlights the selected component (#648).** Selecting a part —
  **or the microcontroller**, which is now selectable too — highlights its browser
  row in the same amber the Part Editor's layers panel uses, and draws the
  selection ring on the canvas, so both hierarchies agree.
- **Part titles only show for the part you're looking at (#650).** On a populated
  board every name collided with the pin labels; titles now appear on the selected
  or hovered part only.
- **Notifications take up far less room (#621).** The "this file doesn't import…"
  notice is a fact about the OPEN FILE, so it now appears in the **Code** workspace
  only instead of above all three — Electronics and Build have no file to fix. The
  driver-install prompt collapses to a single line with the Install button still on
  it; the per-driver list is behind a caret, and appears automatically if an install
  fails.

- **One compact notification shape everywhere (#621).** The instrument-library,
  missing-import and driver-install prompts were three separate banners that each
  rendered their full prose as free-flowing text; any two at once ate a real slice
  of the window. They now share one `Notice` row: a **single clamped summary line
  with the action on it**, and the full explanation (or the per-driver file list)
  behind a caret. So a notice is one row tall whether it's naming a missing import
  or eleven driver files, and it stays clickable without expanding. Failures
  force their detail open, since that message is the only thing that explains
  what to do next.

- **Duplicate a connector in the Part Editor (#647).** Its mini-toolbar had only
  Rotate and Delete, so a second Grove/QWIIC port had to be built by hand. The
  copy's contacts are renamed (`SCL` → `SCL2`) because a wire endpoint is
  `<partId>.<PinName>` — two ports with identically-named contacts would make
  that endpoint ambiguous — and it starts ungrouped, so dragging the original
  doesn't drag its own duplicate around.

### Fixed
- **The Electronics MCU dropdown lists the same boards as the code workspace.** It
  derived its list from props whose hosts refreshed on different signals — the
  board pane read user boards once on mount and never again, and ignored the
  cross-window "parts changed" broadcast — so a board authored in the Part Editor
  appeared in the mini board view and was missing from the dropdown. Both now share
  one loader, so the two lists cannot diverge.

- **You can add a photo of a board's REAR face.** The back face shipped in #636
  with pins and a flip, but no working way to give it a picture: the upload wrote
  it, then the save dropped it, and the main process never wrote or re-read a rear
  image asset. The whole chain works now, and the Background controls act on the
  face you are looking at — previously the ＋ said "Replace" on an empty back, and
  its bin deleted the FRONT photo you could not even see.

- **The Part Editor no longer offers the Standard library as a save target (#633).**
  Writing there edits the seeder-managed copy and strands the part on an old schema
  (#643), so it is a developer target now. With one target left there is nothing to
  choose, so the picker shows **where the file lands** instead — a click opens the
  folder. (The web build's "window.api is unavailable" on save is a separate,
  larger piece: the browser has no parts store yet.)

- **Zoom to fit fills the screen.** Four things were each adding slack: the fit
  targeted the SVG's fixed 1180×720 viewBox, which `preserveAspectRatio="meet"`
  letterboxes inside the pane — so it filled the letterbox, not the screen, and no
  amount of trimming the pad could reclaim those bands; the pad was added to the
  content *before* scaling, so it was multiplied by the zoom (widening exactly when
  you were most zoomed in); the fit measured each part's hit box, which reserves
  space above it for a title only drawn when selected; and the pad was 60 units per
  side of a 720-unit-tall view. It now fits the whole stage, with a constant
  on-screen margin, measured against the drawn body.

- **A docked board moves with its carrier.** Dragging the XIAO Expansion Base left
  the seated XIAO behind until the mouse was released — a seated board has no
  position of its own, so it was laid out from the carrier's *committed* box and
  only caught up on drop. Riders now follow the live drag.
- **No more generic-then-photo redraw in Electronics.** Part photos are data URLs
  the browser decodes asynchronously, so every part painted as bare PCB + shapes
  for a frame before its image landed — on every visit, since leaving the workspace
  unmounts the pane. The photos are now decoded up front, once.

- **Cable plugs stay put.** A Grove/QWIIC plug took its angle from the position of
  whatever it was wired to, so every header swung round to face the other component
  — and swung again whenever that component moved. A plug is part of the socket it
  is pushed into: it now takes its orientation from its own connector's contacts,
  which already turn with the placed part, so only the lead between them moves.

- **`instruments.py` reaches the board again.** Its `__version__` is how the app
  decides whether a board's copy is stale — and it went unbumped through two
  changes, so every board silently kept the OLD library while the app reported it
  as up to date. That is why a fixed `watch(imu=…)` classifier never took effect
  and the IMU panel stayed empty with no error. Bumped to **0.10.0**, and a test
  now fails if the file changes without the version changing.

- **Placing a part that needs a driver now says so.** Adding the Grove IMU to a
  project prompted nothing, and running the code failed with a bare
  `ImportError: no module named 'lsm6ds3'` and no route to a fix. Both
  notifications key off `library.module` / `drivers`, which the Grove parts never
  declared. They do now — so the Board View offers the install, and the Code
  workspace says which import is missing.
- A part can require a driver from the **modules catalog** (`source: module:<id>`)
  instead of shipping a copy of the `.py` in its own folder — six Grove parts share
  four drivers. Those are probed **by import** rather than by path, since a
  `mip`-backed module lands wherever `mip` puts it and a guessed path would leave
  the prompt nagging for ever.

- **A bundled IMU driver can now actually be watched.** `inst.watch(imu=…)`
  duck-typed on `read_accel_gyro` / `read_accelerometer_gyro_data` / `read_accel`
  — none of which the bundled `lsm6ds3` **or** `mpu6050` expose. Both fell through
  every branch of the classifier and bound as *nothing*, so the IMU panel stayed
  empty with no error. It now also recognises the `accel()` naming those drivers
  use, and the Euler helper reads from it. The IMU panel's example no longer names
  ICM20948 as though the panel required that specific chip.

- **The Code workspace now notices parts removed in Electronics.** Deleting the
  SG90 left the editor still nagging *"this file doesn't import servo (needed by
  SG90 Micro Servo)"*. The `robot:didChange` relay deliberately skipped the window
  that saved — correct when the Board View was always a separate pop-out, but
  Electronics **embeds** it in the main window, so that window never heard its own
  edit. It now notifies every window, which is safe because each robot.yml reader
  already guards its reload against its own save. The same-window gap existed on
  the web build too (a `BroadcastChannel` never echoes to its sender) and is fixed
  the same way. The banner also re-reads when a part **library** changes, which it
  never did despite depending on one.

- **Octagonal pads were silently downgraded on every save/load.** The `parts.yml`
  parser and the Part Editor's normaliser kept separate lists of valid pad shapes,
  and the parser's was missing `octagonal` — so a servo/DuPont header lost its pad
  shape each round-trip. They share one list now.

## [0.39.0] - 2026-07-27

### Added
- **Footprints — author a carrier's socket from a real board.** In the Part
  Editor, **＋ Add footprint** stamps a reference microcontroller's *actual* pins
  (type-coloured round pads, with their GPIO / capabilities) into a carrier as a
  locked, movable block — so an expansion base carries the real socket a board
  plugs into, not an abstract rectangle. Footprints are a first-class **Layers**
  row with their own add / rename / rotate / delete, hovering a footprint reveals
  its pin names (placed left/right for columns, above/below for rows so a rotated
  block stays legible), and the bundled **Seeed XIAO Expansion Base** now ships
  with a XIAO footprint, so a XIAO docks into it out of the box.
- **Structural docking — if the pins fit, it fits.** A board seats into a carrier
  by matching its **pin layout** (order + type + position), not a footprint name,
  so any compatible board is interchangeable — a XIAO RP2040 and RP2350 share one
  socket. Dragging the MCU over a carrier rings the footprint's real outline + pin
  dots; on drop it snaps **onto** the footprint, rotated to match it — and it
  follows the footprint even when the carrier itself is rotated in the workspace.
- **Electrical bonding through a seat.** A seated microcontroller is electrically
  the carrier's footprint pins, so a wire to a Grove port or header on the carrier
  reaches the MCU's GPIO — through ERC, the DC solver and live probing.

### Changed
- **The microcontroller is drawn to scale** in the Electronics workspace,
  sized against the widest placed part so a large carrier no longer shrinks the
  MCU to a speck.

### Fixed
- The board picker in the Electronics workspace scrolls on smaller screens
  instead of running off the bottom.
- The bundled parts library refreshes stale `<userData>/parts` installs so
  footprint / mount metadata reaches copies seeded before those fields existed —
  without overwriting parts you've edited yourself.

## [0.38.0] - 2026-07-26

### Added
- **Grove and DuPont/servo connectors.** Part connectors gain two kinds alongside
  QWIIC and JST: **Grove** — Seeed's 4-way 2.0 mm keyed socket, drawn in its
  off-white shell at its real 11.8 × 6.6 mm footprint, with a **port type**
  (I²C / UART / digital / analog) that names it the way a Seeed board's silk does —
  and **DuPont**, a 0.1" male header block drawn one 2.54 mm cell per pin, for
  servo leads. Add either from the Part Editor's ＋ Add menu (**Grove port**,
  **Servo header**) prefilled with the kind's standard contacts, or switch an
  existing connector's kind in the inspector.
- **Connectors are oriented.** A connector's contact order is now meaningful —
  contact 1 is the end the housing's **pin-1 marker** sits at, drawn the way a PCB
  marks it — so a Grove port always reads signal · signal · VCC · GND and a servo
  header always reads Signal · V+ · GND. This is the groundwork for seating cables
  the right way round rather than merely joining them pin-to-pin.

- **Board stacking — plug a board into a carrier.** Drag a XIAO over a XIAO
  Expansion Base (or a Pico over a Pico Explorer) and its socket rings green;
  drop it and the board **seats**, drawn stacked on the carrier and moving with it
  from then on. Dragging it off takes it back out. A board declares the header
  `footprint` it plugs into (`xiao`, `pico`, …); a carrier declares `mounts` that
  accept that footprint. Mating is by name rather than geometry, so a XIAO RP2350
  and a XIAO RP2040 both seat in the same base, and a new carrier only has to name
  the family it accepts.
- **A seated board is electrically the carrier** at every pin they share by name —
  which is what a header socket does. So a module wired to a Grove port on the
  expansion base now resolves through to the real GPIO on the board plugged in
  above it, with no hand-wiring of the socket. `pinMap` covers carriers that rename
  pins, and a board that doesn't fit its mount is never bonded.
- **Seven new standard parts** for the Seeed Grove ecosystem: **XIAO Expansion
  Base** (the carrier — OLED, RTC, buzzer, SD, four Grove ports, and a XIAO
  socket), **Grove 6-Axis Accel & Gyro** (LSM6DS3), **Grove I²C Motor Driver**
  (TB6612FNG), **Grove Ultrasonic Ranger**, **Grove LED Bar**, **Grove Buzzer**
  and **Grove Button** — most with help pages covering the traps (the ultrasonic's
  single trigger/echo wire, the motor driver's command protocol, the LSM6DS3's
  `0x6A`/`0x6B` address split).

- **Cables look like cables.** A cabled wire now wears its **real conductor
  colour** in contact order — a Grove lead's yellow/white/red/black, a QWIIC
  lead's black/red/blue/yellow, a servo lead's orange/red/brown — so a cable reads
  as one identifiable lead instead of four net-coloured wires. Each end gets a
  **seated plug shell** facing its mate, so a connected cable ends in a housing
  rather than four wires fanning into pads.
- **Cables snap into sockets.** Drag off a connector and every socket the lead
  could go in rings green; drop anywhere on the socket — not on one 2 mm contact —
  and it seats, previewing solid before you release. Sockets that **don't** fit are
  refused and say why ("That's a Grove UART port — this one is Grove I2C", "A servo
  header lead doesn't fit a Grove socket"). Which contacts join is decided by the
  connector's contact order, never by which end you grabbed, so **a servo lead
  dragged on backwards still lands Signal→Signal, V+→V+, GND→GND**.
- Cables between two connectors are no longer I²C-only: a lead now joins whatever
  contacts the two sockets share, so Grove UART, digital and analog ports wire up
  properly instead of getting power and ground alone.

- **Pin labels on the mini board.** Hovering the mini board now reveals the full
  pinout — every pin's number, name, `GP<n>` and capability badges (`I2C1 SDA`,
  `PWM A`, `ADC2`) — so you can check you're on the right I²C pins without
  switching to the Electronics view. A **pin-labels toggle** in the mini board's
  zoom toolbar keeps them up while you read, and is remembered between sessions.
  Pins your code uses still show their variable name in preference to `GP<n>`.
  Only the toggle re-frames the board — a hover reveal leaves it exactly where it
  is, so the board never resizes under the pointer.

- **One layer hierarchy in the Part Editor.** The separate *Parts*, *Pins* and
  *Mounting holes* lists are now a single tree: groups at the top — which may
  **mix kinds**, so a Grove connector sits with its contacts and a servo header
  with its S/V/G trio — then a bucket per kind for whatever is ungrouped. Every
  item and every group carries its **own hide and lock**, resolved through the
  group ancestry, so hiding a group hides its members without clobbering their own
  state and un-hiding restores exactly what was showing before. The editor canvas
  honours both: hidden items don't draw, and a click falls through a hidden or
  locked item to whatever is underneath. Groups are **renameable in place** from
  the layers panel. The **selected row is filled with the brass accent** — the
  same signal the toolbar uses for the active tool — instead of being outlined.
  Clicking an item inside a group in the hierarchy **marks that item on the
  board**, so you can see which member you picked — grouped behaviour
  on the canvas is unchanged, a click there still grabs the whole group.

- **Servo 2040 gains its six sensor headers**, and its help explains why 18
  servos need PIO rather than hardware PWM (GP16/GP17 share PWM channels with
  GP0/GP1, so servo 17 would mirror servo 1). The **XIAO Expansion Base** is
  rebuilt from a photo of the real board, with pins on the actual pads.

### Fixed
- **Pin labels read upside down on a part rotated 180°** in the Electronics
  workspace. Boxed labels countered the body's scale but never its rotation. Left
  and right pins now flip upright in place; top/bottom pins land at 90°/270° and
  are left alone, which reads fine on its side.
- **A part layer switched off could never be switched back on.** Merging the
  layers panel dropped the per-layer show/hide toggles, but `layerVisibility` is
  persisted in every `parts.yml` and still gates rendering — so anything added to
  a hidden layer silently didn't appear. The toggle now lives on the bucket rows.
- **Capability chips sat off the pin line on top/bottom pins.** The `PWM A` /
  `SDA` / `SCL` badges on a vertically-rotated pin were drawn ~3.5px off centre —
  left of the pin on bottom pins, right of it on top ones — so they didn't line up
  with the pin, its label, or each other.
- **Renaming a group that had no registry entry did nothing.** Groups can exist
  purely as an id on their items — the servo2040's 18 servo headers are authored
  that way — and the rename mapped over the registry, silently dropping the new
  name for exactly those groups.
- **Editor hover help ran off the screen.** A long signature or docstring sized
  the hover widget past the edge of the editor pane, leaving most of it
  unreadable. The hover is now capped to the pane's own width and its content
  wraps — including signatures and fenced code, which Monaco renders as
  non-wrapping `pre` and which were what actually pushed it off. A tall wrapped
  hover scrolls instead of running off the bottom.
- A connector's **silk label placement** (its dragged offset and rotation) was
  dropped when a part was saved: `parts.yml` rebuilt connectors field-by-field and
  omitted both, so the label snapped back to its default position on reload.
- A part whose only electrical interface is a **connector** — every Grove and
  QWIIC plug-in module — could not be saved: validation demanded at least one
  header pin. Connector contacts now count.

## [0.37.0] - 2026-07-25

### Added
- **Part Editor grouping (epic #627).** Select multiple parts/shapes and **group**
  them (nesting supported); a group then **moves, rotates, deletes, aligns and
  distributes as one rigid unit** instead of scattering its members (#628–#632). The
  **Layers panel** shows groups as a collapsible hierarchy, servo-header trios group +
  rotate as a unit, and the multi-select toolbar carries **Rotate + Delete** even for
  an informal selection. A grouped selection is drawn as a single **outline** on the
  canvas and reflected in the Pins hierarchy.
- **Nudge + precise placement.** Arrow keys **nudge** the selected item/group (#632);
  **Shift-drag axis-locks** to the dominant axis with a rail guide; a **two-finger
  drag pans** the canvas.
- **Lockable Background layer.** The board's background photo is a **lockable layer**
  (open/closed padlock) so a **marquee selects whole groups** without grabbing the
  backdrop.
- **Sortable Pins list.** A **board-# column** plus **clickable column headers**
  (added order / board # / type / GPIO) with asc/desc arrows.
- **Swap the microcontroller and keep your wiring.** Changing the MCU **re-maps every
  wire by GPIO** (power/ground by rail/type), drops only the wires that can't be
  mapped, and **confirms before dropping any**. Works from the mini-board too — it
  hops to the Electronics view to confirm when wires would be lost, otherwise stays
  put.
- **QWIIC / STEMMA QT connectors.** Connectors are **rotatable** with a select toolbar
  (rotate + delete), their pins are **real wire terminals** in the netlist and
  **wireable dots** on the board, and dragging **one connector onto another wires all
  four lines (SDA/SCL/GND/PWR) as a single bundled cable** that selects and deletes as
  a unit. Hovering an MCU now labels each contact (**SDA/SCL/GND/PWR**) and shows each
  pin's **GP<gpio>** so you know what to reference in code.
- **Parts catalog.** A **library filter** to switch libraries (no more duplicate parts
  showing across libraries), and **bigger product-photo cards** (#613) with a clean
  white image area.
- **Standard library refresh.** Reworked board artwork + real product photos across the
  standard parts (Pico W / Pico 2 W, ESP32 DevKit, XIAO RP2040, SG90, LiPo batteries,
  MX1508, N20 motor, …) and a new **HC-SR04 ultrasonic** sensor.

### Changed
- **3-D anaglyph glasses off by default in the Build view.** The stereoscopic view is
  now **opt-in per session** — the Build view opens flat and the on/off state is no
  longer persisted (the glasses *type* and *depth* still persist).
- **Full-screen parts catalog cards show a big product photo.** Each card is now a
  vertical layout with a **full-width image** on top (was a 56px thumbnail beside the
  text) and **no default border** — the teal border/checkmark still marks a selected
  card.

### Fixed
- **Driver install out-of-space.** A failed install now says the board is **out of
  space** (instead of a raw `OSError: 28`), and a **pre-flight check** warns with the
  exact KB needed vs free before it starts.
- **Connector rotation** is applied in the **board view** too, not just the Part
  Editor.
- The lock icon reads clearly as **open vs closed** (it pivots at the leg like the
  Font Awesome lock-open glyph), and the Background layer row drops a redundant tag.

## [0.36.0] - 2026-07-23

### Added
- **Circuit Sim — the Board View now understands electricity (epic #597).** Wiring
  parts on the Breadboard builds a live **netlist**, and a family of tools read it:
  - **Electrical Rules Check (#601).** A live badge + panel that flags wiring
    mistakes — power shorted to ground, two genuinely-different rails bridged, an LED
    with no series resistor, an I²C bus with no pull-ups — each with a plain-English
    "why it matters." A **"Show me"** button (and a clickable net id) spotlights the
    offending net on the board: its wires glow yellow, the rest grey out, the node id
    is labelled; any click dismisses it.
  - **DC solver (#603).** An off-thread modified-nodal-analysis engine that solves
    node voltages + branch currents from the netlist.
  - **Node-voltage overlay + current flow (#604).** Colours each wire by its solved
    voltage (blue ground → red rail → violet negative), shows the reading in a
    colour-matched pill **on** the wire, and animates current as travelling dashes
    (speed + direction from the current). Says *why* it's blank (floating / no
    ground) instead of a silent no-op.
  - **Floating multimeter (#620).** A draggable DMM over the board — tap a pad for
    its voltage, a wire for its voltage **and** current (the old current clamp is
    folded in). Reuses the instrument meter's look but reads the solver, and keeps
    its own state separate from the Code-workspace instrument.
  - **Electrical models for parts (#600, #605, #606).** Parts declare behaviour —
    `source`, `resistor`, `led`, `diode`, `switch`, `consumer`, `potentiometer`,
    `regulator`, `passive` — and the standard loads/supplies are modelled (servo,
    motor and ultrasonic consumers; battery / PSU sources; a potentiometer). An
    **interactive potentiometer** re-solves the circuit as you drag its wiper, and an
    **on-board regulator** (e.g. the Pico's 3V3) makes a board's regulated pins
    actually source current, drawn from its input rail.
  - **Electrical section in the Part Editor (#600).** Author a part's electrical
    model in-app — a model dropdown reveals just that model's fields, and terminals /
    rails are picked from the part's own pins — instead of hand-editing `parts.yml`.
  - **Nets tab in the Connections panel (#601).** Lists every net in the model (id,
    rail, solved voltage, and the pins joined on it); each row jumps to the board
    highlight, and the Connections tab's Net column is now a clickable net-id chip
    that does the same.
- **Part Editor — dense boards & headers.** Servo/DuPont **header groups** (octagonal
  S/V/G pads placed, moved and deleted as one unit, drawn at a fixed physical size;
  the Servo 2040's 54 servo pads collapse into 18 header units), an always-visible
  colour-coded **Type column** in the pin list, **movable + rotatable** LED and
  connector labels, real-size neopixels, and pin pads/labels that scale to the actual
  pin **density** (in both the editor and the Board View). Breadboard zoom raised to
  600%.
- **3-D glasses view for the Build workspace (epic #521).** A glasses-icon toggle
  (in the Build toolbar's nav-zone and the mini-viewer, right of Home) renders the
  model stereoscopically — **red/cyan** or **red/green** anaglyph, or **side-by-side**
  — with a **depth slider** (eye separation) to dial the effect up or down. The
  choice + depth persist. Enabling it switches to perspective (parallax needs it);
  it wraps the existing render with no scene rebuild. (True RealD/polarized cinema
  glasses need a polarized display and aren't reproducible on a normal monitor.)
- **Full-screen parts catalog with multi-select (#613).**
- **"Already in my model" for a duplicated servo.** Dropping a servo into the
  Electronics view appends a loose 3-D copy of its mesh — redundant when that servo
  is already a joint in your URDF. The Build panel's Servos section now shows a
  "remove duplicate 3-D copy" action on such a servo (matched to its loose link);
  removing it leaves the servo bound to its existing joint via the picker right
  there, so the electronics servo maps onto the modelled one instead of duplicating.

### Fixed
- **Circuit Sim solver robustness.** A floating node no longer blanks the whole
  overlay (a tiny Gmin leak keeps the matrix solvable); a floating load reads ~0 V
  instead of a ±1e8 garbage value; the solve anchors on the **main** ground rail
  rather than an isolated GND pin (which floated the circuit symmetrically); and the
  board's own electrical model (its regulator) is fed into the solver so its rails
  come alive.
- **ERC no longer cries wolf on generic supplies (#601).** "Different power rails
  shorted" now fires only for KNOWN, different voltages (3V3 ↔ 5V) — a battery's
  `V+`, a device's `VCC` and a `5V` label sharing a node are the same supply, not a
  short.
- **Multimeter wire taps register** (the visible wire no longer swallows the tap),
  and a single tap shows both voltage and current (#620).
- **Interactive Breadboard wires.** Wires are selectable + deletable, stretch
  elastically 1:1 with the cursor (only on a drag, no jump) and wobble back on
  release; a wire's end can be dragged onto another pin, and one dragged off and not
  re-attached is deleted.
- **Part Editor** selects the nearest pin under the cursor (not its right-hand
  neighbour), and labels stay at the board edge when density-scaled.
- **Imported HDR photos no longer look washed out.** iPhone photos are often HDR
  (Display P3 with a PQ transfer + gain map), which renders flat / desaturated in
  Snakie's SDR board UI next to a plain-sRGB image. Importing a part image now
  flattens it to SDR sRGB (tone-mapping the HDR down, gamut-mapping P3 → sRGB), so
  it displays consistently; already-SDR images pass through unchanged.
- **Saving a part with no help no longer logs an ENOENT error** — removing an
  absent `help.md` is treated as success (the file is already gone), rather than
  reporting a scary (but harmless) `unlink` failure on every save.
- **Mounting holes are a clean cutout** — the light plating ring that read as a
  white border is gone; a hole now shows only the punched-through cutout (a ring
  appears solely when the hole is selected in the Part Editor).
- **Build 3-D view frames home on entry, not FRONT.** Switching into the Build
  workspace framed the model from the default front camera instead of the isometric
  home (zoom-to-fit) view: the first framing ran before the async meshes had loaded
  (empty bounding box), bailed to front, yet still marked itself "done" so the
  post-mesh re-frame just restored that front view. Framing is now only marked done
  when it actually frames a real model, so it homes once the meshes settle.
- **Build hierarchy sections no longer overlap / cut off.** The dock's header, mass
  total and footer could shrink and collide with a tall Chain/Servos/Poses tree; the
  chrome is now fixed (`flex: 0 0 auto`) so the tree is the sole scroller and every
  section is reachable.
- **Help / Report Bug panels open in the Electronics + Build workspaces.** These
  "solo" workspaces gate their left panel on a store flag, so the top-right Help
  button, the new-part help toast, and the Report Bug shelf button set the view but
  never revealed the panel (only the ActivityBar's own Help button, which flips the
  flag, worked). They now reveal the panel like everywhere else.

### Changed
- **Retired the Node-graph board view.** The ERC, node-voltage overlay and LIVE
  readings now live on the Breadboard, which shows every part (the node graph only
  showed the board).

## [0.35.1] - 2026-07-21

### Fixed
- **Console no longer blanks on a workspace switch (epic #573).** The Code panel
  group now stays mounted for every workspace — Electronics/Build render as an
  overlay on top of it — so returning to Code keeps the same terminal instance
  (scrollback + device stream intact) instead of remounting a blank console that
  needed a disconnect/reconnect to show REPL output again.
- **3-D view defaults to the isometric home view, not front.** On the first frame
  the model's bounding box could measure empty (geometry not laid out yet, notably
  under Electron), leaving the camera at its default front position; framing now
  retries until the box is ready.

### Changed
- **Electronics parts Library opens pinned by default**, consistent with the
  Browser and Build hierarchy panels.

## [0.35.0] - 2026-07-21

### Added
- **Soft Shell cards (epic #573).** The Files panel, editor, console and
  instrument dock now float as rounded cards on the parchment workspace (soft
  shadow, radius, a parchment gap between them) — matching the design handoff.
- **One board across every view (epic #573 Soft Shell).** The microcontroller
  selected in the mini-board (Code workspace) and the Board View (Electronics) now
  stay in sync — `robot.yml`'s `board` is the shared source of truth: the mini
  board reads and writes it (for the open project), the Board View adopts a pick
  made anywhere and keeps the localStorage fallback in step. Picking a board in
  either place updates both.
- **Mini-viewer pop-outs switch workspaces (epic #573).** The mini-board's pop-out
  now opens the **Electronics** workspace and the mini-3-D's opens **Build** —
  in-app, instead of the standalone Board View window.
- **Chat toggle in the console header (epic #573).** The AI chat pane (Code
  workspace, desktop) gets a **Chat** button in the console header — the opener
  that went missing when the global toolbar toggles were retired (#592).

### Fixed
- **Better Code defaults (epic #573).** The file panel opens at a comfortable
  ~272px (was clamped ~30% too wide) and the console opens taller (~45%) so a
  couple of REPL lines are clearly visible — the user recognises the console for
  what it is. Existing layouts are migrated (envelope v3).
- **No more demo-arm flash (epic #573).** Switching into the 3-D view no longer
  briefly shows the bundled demo arm before the project's model loads — it shows a
  short loading state, then the real model (demo arm only when there's no project
  model).
- **Build toolbar stays put (epic #573).** Hiding the URDF hierarchy no longer
  hides the build toolbar (add primitive/joint, measure, undo/redo) — its tools
  act on the viewport, not the tree.

### Changed
- **Focused workspace layouts — Code · Electronics · Build (epic #573 Soft
  Shell).** Each workspace now shows only what it's for, matching the design
  handoff:
  - **Code** — files + editor + console, with the mini-viewer / instrument dock
    on the right (the dock is Code-only now).
  - **Electronics** — the Board View (canvas + parts library) fills the whole
    area in its own dedicated layout: no code editor, console, instrument dock or
    mini viewer. The code panels are structurally absent, so no stale/persisted
    layout can resurface them.
  - **Build** — the URDF / 3-D pose editor is full-screen, likewise in its own
    dedicated layout: no code, no board view, no instrument dock.
  - In **Electronics** and **Build**, a tutorial / help lesson opened elsewhere
    stays open in a slim panel beside the main surface across mode switches;
    otherwise the sidebar is hidden (only the Learn/Help lessons open it there).
  - The **workspace switcher** is centred and more prominent in the toolbar
    (always keeping a margin from Run/Reset), the old **reset-layout** and
    **pop-out Board View** toolbar buttons are removed, and the mini-viewer's
    Board/3D toggle is centred with the instrument dock flush beneath it.
  - The Code **console** opens taller by default (40%) so the REPL is usable at a
    glance. Layout envelope bumped to **v2**: existing users keep their Code
    layout but Electronics + Build reset to the new presets.

### Added
- **Dock mini viewer with Board/3D toggle (#595, epic #573 Soft Shell).** The
  Code workspace gets a MiniViewer card at the top of the instrument dock: a
  gold-active **Board / 3D** segmented toggle over the app's real mini-board and
  mini-3-D renders, plus an expand ⤢ that jumps to the matching full workspace
  (Board → Electronics, 3D → Build). The choice persists across sessions.
- **Part-level ground-contact authoring (#569, epic #535 §2).** A part definition
  can now carry `contacts` — the foot/wheel points (mm, part frame) where it
  touches the floor — authored once in the Part Editor's Details ▸ Ground contacts
  so they travel with the part across projects. Round-trips through `parts.yml`
  (malformed points dropped) and feeds the balance support-polygon (#557/#558)
  when the part is placed. The follow-up to #557, which shipped the robot-level
  per-link contacts.

### Changed
- **Per-panel collapse controls (#592, epic #573 Soft Shell).** The four global toolbar toggle knobs (Files / Shell / Chat / Instruments) are gone — each panel collapses from its OWN header chevron, and a collapsed panel becomes its own reopen affordance: the Console leaves a slim reopen bar and the instrument dock a thin “Instruments” rail, so nothing is ever stranded. The Files panel keeps its activity-bar toggle.

### Changed
- **Soft Shell close-out: Data Lab retired (#581, epic #573).** The never-surfaced
  Data Lab workspace is removed — the switcher is exactly Code · Electronics ·
  Build, and its instrument bench lives on in the Code/Build docks. A stale
  persisted session that was in Data Lab (or the older `lab`/`data`) now lands on
  Code instead of an unreachable layout with no active segment. Completes the
  Soft Shell redesign epic; the three workspaces were audited cohesive in both
  the light and dark skins.

### Added
- **Reusable collapsible-panel primitive (#577, epic #573).** A shared
  `CollapsiblePanel` (Soft Shell styled) so every panel owns its own collapse
  control — a chevron in its own header, with an optional badge and header
  actions, and a `keepMounted` mode for panels whose contents must survive a
  collapse (a terminal's scrollback, a live plotter). Waves 3 adopt it across the
  Code / Electronics / Build workspaces.

### Changed
- **Build (Robot) workspace restyled to Soft Shell (#580, epic #573).** The 3-D
  viewport chrome, overlay toolbar and zoom cluster, the CHAIN / URDF hierarchy
  tree (now built on the shared `CollapsiblePanel`), the Pose Studio dock
  (keyframe timeline, mirror/export, stability heat-strip) and the Properties
  dialog (per-link mass + ground-contact editors) all take the warm parchment +
  green/gold palette in both skins. Every recent tool is preserved — Bone Mode,
  Exploded view, IK goal, the Balance / CoM + support-polygon overlay, the measure
  tool, the stability strip and the mass/contacts editors — and the live three.js
  scene and overlay behaviour are unchanged.
- **Electronics (Board View) workspace restyled to Soft Shell (#579, epic #573).**
  The board sub-toolbar, blueprint grid, floating Browser panel, zoom + Connections
  overlays and the parts Library panel now use the Soft Shell tokens (`--panel`/
  `--card` surfaces, `--blueprint`/`--bpline`/`--bptext` board mat, gold segmented
  tabs + Help pill, `--pin-*` dots) and the Library's section groups adopt the
  shared `CollapsiblePanel`. The live board render, wiring, driver auto-detect and
  parts-library install are unchanged — only the surrounding chrome was restyled.
- **Code workspace restyled to Soft Shell (#578, epic #573).** The editor tab
  bar, the Console/shell (a parchment `--panel` frame cradling the near-black
  terminal, warmed Console/Problems toggle) and the file trees now speak the Soft
  Shell palette — parchment `--panel`/`--card`/`--editor` surfaces, `--shellbd`/
  `--line` borders, `--head`/`--txt3` text, a gold unsaved-tab dot, a green editor
  active-tab accent, and a green flash-usage gauge. The live renders (Monaco,
  xterm terminal, serial plotter) are untouched — only their card chrome; the
  plotter now sits in a `--card` sub-card with its dark phosphor scope intact. The
  dark theme, previously left on the old semantic tokens, is carried onto Soft
  Shell surfaces too (via token fallbacks).
- **Chrome now speaks the Soft Shell UI font (#576, epic #573).** The toolbar,
  left icon rail, status bar, panel headers and tabs use **Plus Jakarta Sans**
  (`--font-ui`) in both themes, replacing the old Helvetica chrome font — pairing
  with IBM Plex Mono in the editor/console (#574). The rail (Files/Packages/Inspect
  + Report/Learn/Help/Settings, dark with a gold active tile) and status bar
  already matched the Soft Shell layout.
- **Workspaces are now Code · Electronics · Build (#575, epic #573 Soft Shell).**
  The top-toolbar switcher surfaces three workspaces: **Electronics** promotes the
  Board View to a first-class segment (wire components beside your code), and
  **Build** is the former Robot workspace (renamed so it won't collide with the
  coming electronics simulator). The switcher takes the Soft Shell look — a soft
  parchment track with a gold-gradient active segment in Plus Jakarta Sans. Data
  Lab stays hidden for now; its fate is decided in the epic's close-out.

## [0.34.0] - 2026-07-21

### Added
- **Motion Studio stability strip (#559, epic #535 §3).** The Keyframes timeline
  gains a **balance** heat-strip: each frame of the clip is sampled and coloured
  green / amber / red by whether the centre-of-mass projection stays over the
  support polygon (#558) at that pose — so a sequence that tips is obvious *before*
  you flash it to hardware. Honest scoping in the tooltip: this is *static*
  stability, and a dynamic gait (trot, run) can be statically unstable and still
  walk, so amber/red is a heads-up, not an error. The strip only appears once
  links have masses; it recomputes on timeline, contact or mass edits, never per
  frame. (Per-frame CSV export + the ground-path draw are follow-ups.)
- **Centre-of-mass + support-polygon overlay (#558, epic #535 §2).** The headline
  of the mass epic: a new ⚖ Balance toggle in Robot View drops a marker on the
  robot's live centre of mass, a plumb line down to the ground, and the support
  polygon — the convex hull of the grounded contact points (#557). It colours by
  static stability: green while the CoM projection sits inside the polygon, amber
  near the edge, red once it leaves and the robot would tip, with the clearance in
  mm on a HUD pill. Everything recomputes each frame, so it tracks joint sliders,
  Motion Studio playback and IK drags; a lifted foot leaves the polygon. Composes
  with Bone Mode. Pure geometry (`robot-support.ts`: 2-D hull, point-in-polygon,
  stability) kept separate from the three.js overlay and unit-tested.
- **Ground-contact tagging (#557, epic #535 §2).** A link's Properties gain a
  Ground Contacts section: mark the points where a part (a foot or wheel) touches
  the floor, so the support-polygon check (coming in #558) has vertices to hull.
  "Add contact point" drops one at the link's lowest point automatically; each is
  editable by x/y/z (mm) and removable. Points are stored per link in `robot.yml`
  (`contacts`, link-local metres) and transform with the pose, so a lifted foot
  moves with it. New pure `robot-contacts.ts` (world-transform + immutable edits).
  Part-level authoring on the parts library is a follow-up (it needs the
  link→part mapping URDF links don't yet carry).
- **Centre-of-mass computation service (#556, epic #535 §2).** New
  `robot-com.ts`: the robot's total mass and mass-weighted centre of mass at its
  current pose. Split so the maths is pure and unit-tested (`centreOfMass` —
  weighted average of point masses; `readLinkMasses` — per-link mass + local CoM
  from the URDF `<inertial>`) with a thin three.js layer (`robotWorldCoM`) that
  transforms each link's local CoM by its live `matrixWorld`, so it's cheap to
  recompute every frame as joints move. The shared engine the CoM +
  support-polygon overlay, the stability strip and the balance parameters all
  build on. No visible UI yet — that's the overlay (#558).
- **Total mass readout (#555 / #567, epic #535 §1).** The Build panel shows the
  robot's total mass in a compact bar above the footer (a `+` when some links are
  still un-weighed, so the total reads as a lower bound). Per-link mass is edited
  in each item's Properties dialog — the hierarchy stays a list of physical items
  (#567).
- **Per-link mass in the robot inspector (#555, epic #535 §1).** A link's
  Properties now has a Mass section: pick a print material (PLA/PETG/ABS/resin)
  and an infill %, and Snakie estimates the mass from the mesh volume live; a
  measured weight you type in beats the estimate, and a chip shows which source
  is active. Non-watertight meshes are flagged as rough. The value is written to
  the URDF `<inertial>` (#553); the estimate settings persist in `robot.yml`
  (`linkMass`) so the estimate stays reproducible. Library-part mass is modelled
  but not yet wired — URDF links carry no source-part id, so that lookup is a
  follow-up. (The total-mass readout + sortable breakdown table land next.)
- **Parts carry a real mass (#554, epic #535 §1).** Part definitions gain a
  `mass_g` field (grams) plus optional `com_xyz` (centre of mass, mm) for
  lopsided parts, round-tripped through `parts.yml`. The heaviest robot parts —
  servos, motors, batteries, boards — aren't printed, so their weight can't be
  estimated from mesh volume; now they carry a measured figure. The bundled
  standard library ships real masses for the SG90 (9 g), HC-SR04 (8.5 g) and the
  Pico family (3 g); parts whose mass varies too much to pin are left unset and
  fall back to a volume estimate.
- **URDF `<inertial>` read/write round-trip (#553, epic #535 §1).** Snakie's URDF
  layer can now read and write per-link mass + centre-of-mass as standard URDF
  `<inertial>` tags (`readInertial`/`setInertial`/`removeInertial`), so mass data
  lives in the spec rather than a private format. Written in the same scoped
  string-surgery style as the existing geometry editors, so a mass edit never
  disturbs a link's visual or a sibling tag, and a set-then-remove restores the
  file byte-for-byte (by `urdfHash`). The inertia tensor is deferred — a
  placeholder identity is written; mass + CoM are what static stability needs.
  Cross-checked against a standards XML DOM parser so the regex layer can't drift
  from what `urdf-loader` reads when it builds the 3-D scene.
- **Mesh volume + true centroid for mass estimation (#552, epic #535 §1).** New
  pure module `robot-mass-geometry.ts` computing a mesh's volume and its
  *volumetric* centroid by the divergence theorem, plus a watertight check.
  Volume × a material density preset (PLA/PETG/ABS/resin) × an infill factor
  gives the estimated grams a printed link weighs. Meshes with holes have no
  well-defined interior, so the estimate degrades deliberately — mesh → convex
  hull → bounding box — and reports which method it used so the UI can label an
  estimate honestly rather than quietly showing a wrong number. Note this is
  *not* the bounding-box "centroid" the exploded view uses, which is visibly
  wrong for asymmetric parts like a servo with a horn.

## [0.33.1] - 2026-07-18

### Fixed
- **UI icons no longer vanish on Linux (#549).** Raspberry Pi OS ships no
  colour-emoji font, so DejaVu Sans is the fallback and every glyph in the
  U+1F300+ plane rendered as a blank box — most visibly the 🦴 Bone Mode and
  💥 exploded-view buttons added in 0.33.0. Those glyphs are now SVG line icons
  in a new `ui-icons.tsx` (same conventions as `help-icons.tsx`: 24×24 viewBox,
  `currentColor`, `aria-hidden` since each call site already carries its own
  `title`/`aria-label`). Covers the Robot View toolbar (exploded view, save
  explosion video, Bone Mode, IK goal, Capture Pose, the measure readout), the
  status-bar and tutorial tip bulbs, Part Editor lock/unlock and delete, the
  build checklist header, the "Open…" buttons, Help Panel doc links (reusing
  the existing book icons), the shell's "Send to chat", SAM's SPEAK button and
  the build toolbar's tube primitive. Glyphs DejaVu *does* cover (✓ ✕ ⚙ ⚠ ★ ▦ ●
  and the arrows) are deliberately left as text — they already render fine.
  Learn-panel course cards are covered too: courses still declare a thumbnail
  `emoji:` in their `course.yml`, but it now resolves through a small
  emoji→icon map, falling back to the raw glyph for an unmapped value so
  authored courses keep working. Also the build checklist's completion message
  and the Robot View snap tooltip's "locked" label — the latter needed
  `setBuildDim`'s `text` widened from `string` to `ReactNode` so the label can
  carry an inline padlock icon.

## [0.33.0] - 2026-07-18

### Added
- **Interactive IK goal gizmo + Capture Pose in Robot View (#540, epic #533 §5).**
  A new 🎯 toggle drops a draggable end-effector goal on the selected chain;
  dragging it runs the shared planar solver (#538) live, poses the model in
  real time, and — when a board is connected with servo bindings — streams the
  solved angles over the same channel the puppet controls use (best-effort, a
  no-op with no board). The goal handle recolours by status (reached / blocked
  by limits / out of reach) and a translucent point cloud shades the chain's
  reachable workspace so you can see why a goal can't be reached. 📸 Capture
  Pose saves the current IK-solved posture as a Motion Studio pose. Composes
  with Bone Mode (shared skeleton + live tick). Scope: planar arm/leg chains
  (joints on a shared/parallel axis) — a non-planar chain is solved as its
  best in-plane projection and flagged, not faked as full 3-D IK.
- **`snakie_ik.py` — on-device IK runtime (#539, epic #533 §4).** New
  MicroPython module `micropython/snakie_ik.py` that mirrors the shared
  TypeScript solver step-for-step and passes the SAME 35 language-neutral
  vectors (`test/fixtures/ik-vectors.json`), so a goal posed in the browser and
  a goal posed in code on a Pico produce identical joint angles. Provides a pure
  planar `solve_ik` (law-of-cosines for 1/2-bone chains, FABRIK + CCD + analytic
  two-group fallback + perturbed-seed retry for 3+ bones, joint-limit clamping,
  `reached` / `out_of_reach` / `blocked_by_limits` status) plus a `Skeleton`
  helper: `Skeleton.load("skeleton.json")` parses the #537 schema into bones,
  limits and servo bindings, `solve(chain, target_xyz)` turns a named joint
  chain into angles, and `apply(angles)` drives the bound servos through the
  `snakie_motion` rig (degrading gracefully when none is present). Runs
  unmodified on CPython (all hardware behind `snakie_motion`/`instruments`'
  `machine` guard) and uses only `math`/`json`, so it's Pico-friendly.
- **Community parts install fallback when `git` isn't available (Web W3,
  #284, epic #267).** Installing/updating a library from the Community Parts
  registry normally does a shallow `git clone`; Snakie now probes once
  whether `git` is on `PATH` and, if not, transparently falls back to
  downloading the repo as a GitHub tarball
  (`codeload.github.com/.../tar.gz/HEAD`, always the current default branch)
  and extracting it straight into the library folder instead of failing.
  Same manifest reconciliation either way, so update checks behave
  identically regardless of which path installed a library. Desktop installs
  are unaffected wherever `git` is present (the common case).
- **Robot build checklist in the Learn panel (#436).** A completion checklist
  at the top of the Learn gallery walks a maker through building a robot
  end-to-end: pick a board, add a servo, import an STL, create a joint, bind a
  servo to it, save poses, write the app, and run it on the simulator. Six
  steps tick themselves live from project state (robot.yml, the linked URDF
  and the parts library); "write your robot app" and "run it on the simulator"
  latch on when observed (an open servo-driving `.py`; a Simulated-device
  connection) with a manual checkbox fallback, remembered per project.
- **Shared IK solver library (#538, epic #533 §3).** New pure-TypeScript
  planar inverse-kinematics module `src/shared/ik/` (no Three.js/DOM/Electron
  deps): an exact law-of-cosines 2-bone solver that picks between both elbow
  configurations (limits first, then closest to the current pose), a FABRIK
  solver for 3+ bone chains with CCD refinement, an analytic two-group
  fallback and a perturbed-seed retry for the classic slow-convergence
  singularities, joint-limit clamping throughout (poses never fold through a
  limit), and a status that distinguishes `reached` / `out_of_reach` /
  `blocked_by_limits`. Ships 35 language-neutral test vectors in
  `test/fixtures/ik-vectors.json` (format documented in
  `src/shared/ik/README.md`) that the future MicroPython `snakie_ik.py`
  (#539) must also pass, plus a vitest suite running every vector and
  seeded property-style edge cases.
- **skeleton.json — auto-generated device-side skeleton (#537, epic #533 §2).**
  Saving the project URDF (or robot.yml — servo bindings live there) now
  regenerates `<project>/skeleton.json` automatically: per joint its name, type
  (revolute/continuous/prismatic/fixed), parent/child link, origin, bone length
  (mm, joint-origin → joint-origin), axis, min/max limits from the URDF
  `<limit>` (deg / mm), and the bound servo (pin + calibration) where the
  project maps one — plus an extensible per-link section (masses land there in
  #535). JSON so MicroPython parses it natively; the embedded `urdf_hash` +
  `schema_version` let Snakie warn "skeleton out of date — sync?" at connect
  time when the board's copy is stale, and file sync (#178) pushes it like any
  project file. The URDF stays the single source of truth — skeleton.json is
  derived, never hand-edited.
- **Bone Mode in Robot View (#536, epic #533 §1).** A 🦴 toggle on the zoom
  toolbar ghosts the robot (solid grey at ~80% transparency) and overlays its
  skeleton: coloured joint-to-joint bones labelled with their length in mm,
  never occluded by the mesh; a compass at every revolute joint (arc from min
  to max limit, needle at the live angle, readout that shifts green → amber →
  red approaching a limit); a linear ruler gauge for prismatic joints; and a
  friendly error when joint names aren't unique. The overlay tracks sliders,
  Motion Studio playback and live servo telemetry frame-by-frame.
- **Discovery tips in the status bar (#434).** When the status bar has nothing
  real to say, it now shows a rotating 💡 tip about a Snakie feature — fading
  in/out over a second, changing every 5–10 minutes, and always giving way to
  actual warnings and status messages. Some tips link to docs.snakie.org
  articles (opened in your browser). The list lives in a plain YAML file so
  it's easy to extend, and a **Settings → Appearance** toggle turns tips off.
- **ESP32/ESP8266 firmware flashing in the browser (Web W3, #284, epic #267).**
  Outside the Electron desktop app — e.g. a future web build — the Flash
  MicroPython firmware dialog now flashes ESP32/ESP8266 boards entirely
  client-side over the **Web Serial API** via Espressif's official
  [`esptool-js`](https://github.com/espressif/esptool-js), with no local
  process or `esptool` install required: pick a local `.bin` file, click
  Flash, choose the board's serial port when the browser prompts, and watch
  the same live log + progress bar the desktop flasher shows. This lands
  first (of a 3-part split for #284) since it needs no other web-track work;
  the desktop Electron flashing path (esptool shell-out, UF2/DAPLink drive
  copy) is unchanged. A browser-native firmware catalog download isn't
  available yet, so the catalog tab is hidden outside Electron (Local file
  only) — RP2040/micro:bit browser flashing follows below.
- **micro:bit and Pico (RP2040) firmware flashing in the browser (Web W3,
  #284, epic #267).** The second part of the browser flashing work: a
  micro:bit now flashes over **WebUSB/DAPLink** via ARM's
  [`dapjs`](https://github.com/ARMmbed/dapjs) — the same approach the
  MakeCode editor uses — with a one-click **"Copy to drive instead"**
  fallback (and automatic fallback when the browser has no WebUSB) for
  boards/browsers where WebUSB DAPLink doesn't respond. A Pico's BOOTSEL
  bootloader has no WebUSB interface at all, so it always uses that same
  guided drive-copy flow: Snakie tells you to hold BOOTSEL (or just plug in a
  micro:bit), then uses the **File System Access API**'s save-file picker to
  write the firmware straight onto whichever mounted drive you pick — no
  auto-detected mass-storage path required. Chrome/Edge only for both the
  WebUSB and File System Access paths; the desktop Electron flashing path is
  unchanged.
- **Desktop-only chrome hidden outside Electron (Web W3, #284, epic #267).**
  The Source Control and Plugins views — both need a real filesystem and a
  spawned local process, neither available in a browser tab — are now hidden
  from the activity bar and, as a defensive fallback, show a short "desktop
  app only" notice instead of a broken panel if somehow selected. Backed by a
  new shared `isElectron()`/`hasWebSerial()`/`hasWebUSB()`/
  `hasFileSystemAccess()` capability-detection module, reused by the ESP
  browser-flashing work and by the micro:bit/Pico web flashing above.
- **Board View works by touch — iPad-friendly wiring (part of #525).** On a
  touchscreen, tapping the board or a part now reveals its pin capability
  chips (they stay up until you tap elsewhere — touch has no hover), wires can
  be dragged from pin to pin by finger (with a finger-sized grab radius, and
  one that no longer shrinks when the board pane is narrow), and a two-finger
  pinch zooms the canvas about the gesture (a second finger safely cancels any
  in-flight drag). One-finger pan, part dragging and tap-to-select were
  already pointer-based and keep working; mouse behaviour is unchanged.
- **Board View on the web app — pops out into its own browser window.** The
  toolbar's board icon (previously desktop-only) now works on app.snakie.org:
  `board.html` ships as a second web entry and a `BroadcastChannel` relay
  replaces the Electron IPC layer, streaming the active file, board selection,
  instrument launches and robot.yml changes between the windows. Toggle, Esc
  and re-adopt-after-reload semantics match the desktop.

### Fixed
- **CODE→ROBOT workspace switch no longer throws on the web app (#528).** The
  layout store always keeps four horizontal panel shares (files, centre,
  board, chat) but the chat pane doesn't exist on the web build, so applying a
  workspace pushed a stray fourth value into a three-panel group —
  react-resizable-panels rejected it (`Invalid 3 panel layout`) and dragged
  sizes were never recorded on the web. Layouts are now mapped to exactly the
  rendered panels in both directions (apply + record).
- **"New robot" / "Open Folder" now work on iPad (part of #525).** iPadOS
  Safari has no folder picker (`showDirectoryPicker`), so the web fs backend
  never installed and both buttons silently did nothing. Where the pickers are
  missing but OPFS is usable (feature-detected incl. `createWritable`), the
  same fs api is now backed by an origin-private `Projects/` folder in browser
  storage: Open Folder adopts it with no dialog, it re-adopts silently on every
  visit, and the robot.yml layer rides along — so New robot creates and links a
  real `robot.urdf` that survives reloads.
- **All catalog modules install on the web app (#522).** The six bundled module
  stubs (`hcsr04`, `mpu6050`, `neopixel_ws2812`, `rotary`, `buzzer`, `teleop`)
  are now inlined into the web build — they used to fail with *"isn't bundled
  in the web build yet"* because only part-driver sources were carried.

## [0.32.0] - 2026-07-15

### Added
- **Package manager: on-board packages, uninstall, upgrades and an import scanner
  (#131).** The Packages panel now reads the board's real `/lib` — every installed
  package is listed with its version (read from the file, never imported, so
  drivers can't twitch hardware), an **Uninstall** button, and an **Upgrade**
  offer when the registry has a newer version. **⌕ Scan imports** walks the
  project's `.py` files and lists any import that nothing satisfies — not
  firmware built-ins, not on the board, not your own modules — with one-click
  installs. Works on the desktop, Web Serial hardware and the simulator alike.
  The ON BOARD list also refreshes when anything *else* installs to the board —
  a driver banner, the instruments-library update, another window — and that
  broadcast now works on the web app too (it was a silent no-op there).
- **The Modules panel installs drivers for real on the web app (#513).** Every
  install used to fail into a Retry button (the web backend was a stub).
  Bundled drivers now write straight to the board's `/lib`; mip-sourced modules
  run mip on the board itself (works on network-capable hardware over Web
  Serial, and fails with an honest explanation on the simulator). When the board
  has no mip (the simulator), single-file GitHub modules are fetched **by the
  browser** instead and written to `/lib` — so ssd1306/sh1106 install on the sim
  too.

### Fixed
- **Exploded-view polish (#499).** The orbit is speed-ramped (eases out of the
  start, glides into the finish) and the zoom-to-fit legs are eased too — one
  smooth camera gesture instead of mechanical constant-rate moves. Also fixed
  the web bug-report screenshot occasionally catching the 3-D canvas blank
  (capture now waits for the compositor to deliver real frames).
- **Data-loss protections (#504, #505, #514).** Renaming a file to an existing
  name no longer silently destroys the other file (desktop + web; case-only
  renames still work). A malformed `robot.yml` is backed up to `robot.yml.bak`
  before the app could ever save over it. Edits typed while a save is in flight
  stay marked *Unsaved* (they used to be silently marked clean), and Ctrl+S
  failures now surface an error instead of vanishing.
- **Web saves can't land in the wrong file anymore (#511, #512).** Files picked
  from outside the project are now tracked by a unique token instead of their
  bare filename — picking a second file with the same name no longer redirects
  the first tab's saves into it, and Open Folder no longer disconnects
  previously-picked files. "Download to computer" uses a per-file save picker
  instead of a folder picker that silently re-rooted the whole web workspace.
- **The Git panel works from repo subfolders (#506).** Staging/discarding used
  root-relative paths against the opened subfolder — the service now rebinds to
  the discovered repository root.
- **Check for Updates no longer offers downgrades (#507).** Any version
  *difference* used to count as "newer"; a real numeric compare (with
  pre-release handling) means only genuinely newer releases prompt.
- **Simulator robustness (#500, #501).** A sim worker that fails to boot now
  fails the connection cleanly instead of pretending to connect with a dead
  REPL (desktop resolved the error as success; the web had no error path at
  all, wedging "connecting" forever). Keystrokes/Run that race a Stop-restart
  are queued instead of dropped — they used to hang forever and silently turn
  every later Stop into a full simulator reset.

## [0.31.0] - 2026-07-15

### Added
- **Bug reporting works on the web app (#513).** The Report Bug panel on
  app.snakie.org now posts real reports to the feedback service (the same
  endpoint, message format and size caps as the desktop app), and its
  diagnostics line shows the web build's version + browser instead of
  "Snakie undefined · undefined undefined". The post-only app key is baked in
  at deploy time; the endpoint is rate-limited and Cloudflare-fronted. The
  "Attach screenshot" button works too — it uses the browser's screen-capture
  picker (grabbing one frame of the tab) in place of the desktop window capture.

## [0.30.0] - 2026-07-13

### Added
- **Exploded view in the 3-D Robot View (#499).** A new 💥 control on the zoom
  toolbar separates the robot's parts outward from the assembly centre — a slider
  drives the separation, ▶ plays an eased out-and-back explosion animation (with an
  optional full-orbit camera move that ends where it started, and a single smooth
  zoom-to-fit so nothing jitters), and 🎬 records the animation straight off the
  canvas to a **proper progressive mp4** (WebCodecs + mp4-muxer, faststart moov —
  opens in QuickTime/Finder), falling back to an **animated GIF** — the one
  format that renders on macOS, Windows, Linux AND the web — where H.264 encoding
  isn't available (Electron), with a codec-probed .webm as last resort. GIF frames
  rasterise through a 2D canvas (correct colours on every pixel format — no more
  red-as-blue). The GIF is now rendered **deterministically frame-by-frame** at
  perfectly uniform ~33 fps steps (GIF's real ceiling — browsers clamp faster
  delays to 10 fps) with one shared palette, so playback is buttery instead of
  sampling-judder. Every recording carries a small *"Made with
  https://app.snakie.org"* watermark bottom-left. Parts travel **straight
  world-space lines along their original joint normals** (falling back to the joint's
  origin direction, then centre-out) — nested links compensate for their moving
  parents so nothing drifts diagonally, and the base stays anchored. Separation is
  **depth-weighted** — parts nearest the root move least, parts at the end of the
  hierarchy move most — so chains that share a direction still pull apart. A
  build-time **overlap solve** nudges any parts that would clash at the final
  position further along their own lines until everything is clear. The camera
  backs off to a zoom-to-fit computed from the **actual fully-exploded bounds**
  (and re-fits when you release the slider), so parts never leave the shot.
- **Course splash lists its lessons.** Opening a course in the Learn panel now shows
  the lesson titles (each one clickable to jump straight to it) above the Start button.
- **Wires are labelled with their variable name in the board view (#498).** Each
  connection's variable name is drawn over its wire, so a wired-up board reads at a
  glance.
- **The Help panel shows the app version** (`Snakie vX.Y.Z`) at its foot — handy to
  include in a bug screenshot. The web app reports the build version too.
- **Link any URDF to the project from the Robot dock.** The mini 3-D viewer's "Open…"
  button now also LINKS the picked `.urdf` as the project robot (repoints `robot.yml`'s
  `urdf`) when it lives in the open folder — an easy way to point the current code +
  breadboard at a specific robot model.

### Changed
- **The web app hides desktop-only controls.** The pop-out Board View button and the
  LLM chat (its toggle button + the chat pane) are hidden on app.snakie.org — pop-out
  windows and the chat backend aren't available in the browser, so those buttons did
  nothing there.
- **"New robot" confirms before replacing a linked robot.** If the project already has
  a robot linked, creating a new one now asks first (the previous file stays on disk).
- **robot.yml surfaces the linked URDF at the top.** The `robot:` block — with `urdf:`
  as its first field — is now written near the top of `robot.yml` (above the parts /
  connections lists), so the linked model file is easy to find and edit.

### Fixed
- **The mini 3-D viewer updates when you link a robot, and now tells you what happened.**
  Opening/creating a robot from the dock used to force full-screen focus mode, which
  *unmounted* the mini viewer — so it looked like the robot never changed (it still
  showed the demo arm until you left focus). Open/New now link + update the mini viewer
  in place (use "⤢ Pop out" for full-screen), and a status-bar message reports the
  outcome — *Linked "X"*, *Opened "X" (outside the project — not linked)*, *Created "X"* —
  so the linking, otherwise invisible, is clear. On the **web app**, "Open…" returns
  just a filename (a File System Access pick with no folder path), which defeated the
  in-project check so nothing ever linked — the linker now recognises a picked file
  that matches a file in the open project and links it project-relative. (Also hardened
  the in-project path check for Windows drive-letter casing.)
- **The local file tree refreshes after creating a new robot (#491).** Creating a new
  robot writes the `.urdf` + `robot.yml`, and the Files list now updates to show them
  immediately (it also refreshes on any local file save) instead of needing a manual
  Refresh.
- **The "New robot" button is readable in light mode.** On the mini 3-D Robot dock its
  CTA label was white on the light parchment background (a specificity clash dropped
  its accent fill) — it now has a solid dark-brass fill so the label reads.
- **External links work on the web app.** "Full documentation at docs.snakie.org" (and
  other external links) did nothing on app.snakie.org — the browser has no Electron
  `openExternal`, so they now open in a new tab.

## [0.29.0] - 2026-07-12

### Changed
- **Tutorials now live in a dedicated "Learn" side panel.** The 📚 Learn button
  moved from the toolbar into the left activity-bar shelf (just above Help). Clicking
  it opens the Learn panel, which hosts the whole tutorial experience inline — the
  course gallery, the course splash, and each lesson's walkthrough (Back / Next, the
  position dots and the 💡 tip) — replacing the old floating dialog + full-window
  overlay.
- **Tutorial text uses a friendly, legible sans (Nunito Sans).** The learning
  system's prose now reads in a bundled open-source sans instead of the app's retro
  monospace — clearer for beginners, and code blocks stand out because only the code
  stays monospace. Line-spacing bumped for readability. (The rest of the app keeps
  its monospace identity.)
- **The web app shows its version.** app.snakie.org now displays the build version
  in the status bar, injected from `package.json` at build time (the web build has
  no Electron `app.getVersion()`).

### Fixed
- **Switching editor tabs no longer stops a running program.** With a board/live
  view polling the device, changing the active file changed the pin count, which
  re-armed the poll and fired an immediate raw-mode `exec()` probe — and that
  interrupts a program you're running. The live poll now re-arms only when it turns
  on/off or crosses empty↔non-empty, reading the latest pins on its normal tick, so
  a tab switch never pre-empts a run (BoardGraph + InstrumentHost).
- **Run no longer silently does nothing on the web app.** If no device was connected
  (e.g. a page reload had dropped the simulator), pressing Run did nothing but leave a
  tooltip. Run now auto-connects the simulator first so it always works; a real board
  you've already connected still takes precedence.
- **Tutorial lesson titles aren't shown twice.** Each lesson repeated its title (a
  header plus the lesson's own Markdown heading); the redundant header is gone.
- **Tutorials (📚 Learn) UI is readable in light mode.** The Projects gallery and
  floating tutorial dialog referenced CSS variables that don't exist in the theme
  (`--fg`, `--panel`, `--hover`), so they fell back to dark-only literals — in the
  light (skeuomorph) skin that put near-white text on the parchment background. They
  now use the real theme tokens (`--text`, `--bg-elevated`, `--accent-ink`,
  `--accent-contrast`), so they read correctly in both skins.
- **Swept the whole renderer for the same undefined-token bug.** The context menu,
  upload/robot controls and the Problems panel referenced tokens that were never
  defined (`--color-*`, `--muted`, `--warning`) and so silently rendered a wrong-theme
  fallback; they now point at the real theme tokens. Added a unit test that fails if
  any `var(--token)` reference isn't a defined token (or an explicitly-blessed
  override hook), so this class of light/dark parity bug can't ship silently again.
- **Source Control panel text is readable again.** The muted text on the green-felt
  Source Control panel was a low-contrast sage grey; it's now a near-white that
  reads clearly on the green in both the dark and skeuomorph themes.
- **Web Serial: the port dropdown now shows the connected board, and unplugging is
  handled gracefully (#465).** After picking a real USB board it was still showing
  "Simulated device (offline)" (the just-granted port wasn't in the list yet, so the
  dropdown fell back to the first entry) — it now refreshes and shows the board's
  name. And physically unplugging the board is detected: the connection drops to
  *disconnected* and the console prints a "board disconnected" notice instead of
  hanging on a dead port.

## [0.28.0] - 2026-07-12

### Added
- **Learn Snakie — guided tutorials in the app (#479).** A new **📚 Learn** button
  opens a MakeCode-style **Projects gallery** of tutorial courses. A floating
  tutorial dialog walks you through each lesson with **Back / Next**, position
  **dots** and a **💡 tip**; opening a lesson drops its starter code straight into
  the editor so you can press **Run**. Ships **three courses × 10 lessons** — *First
  Steps with MicroPython*, *Build a Robot on the Breadboard*, and *Build a Robot in
  3-D*. Courses are plain `course.yml` + Markdown, bundled into the app (web + desktop).

### Added
- **Export a clean URDF from the Robot View (#315).** An **Export URDF** button (in
  the build panel, beside Import STL) writes a tidy, consistently-indented copy of
  the robot's URDF into the project's `urdf/` folder — a clean artifact to share or
  version. It re-loads unchanged in the viewer (same tags, just formatted). Closes
  out epic #309 Phase 5.

### Added
- **Connect a real board over Web Serial, in the browser (#465).** On a Chromium
  browser (Chrome, Edge, a Chromebook), app.snakie.org can now talk to a real
  Pico / ESP over USB — the REPL, Run/Stop, the device file tree, module installs
  and the instruments all work over Web Serial, right alongside the offline
  simulator. Pick a board with the new **＋ Connect a USB board** entry (filtered
  to known board/bridge chips); already-granted boards show up in the port list.
  The raw-REPL protocol is shared with the desktop, so a board behaves identically.

### Added
- **The web app is now an installable PWA that works offline (#464).** app.snakie.org
  can be installed to the ChromeOS shelf / your dock (name, icons, standalone window),
  and a Workbox service worker precaches the whole app shell — including the MicroPython
  WASM — so after the first visit it keeps working with no network. Completes Phase W1.

## [0.27.0] - 2026-07-12

### Fixed
- **The offline simulator no longer freezes on a `while True:` loop.** Running a
  program with a perpetual loop (e.g. the Buddy Jr pose demo) locked up the whole
  app and spewed `OSError` in the console, because the interpreter ran on the main
  thread and a loop that only yields via `time.sleep` starves the event loop. The
  sim now runs the MicroPython interpreter in a worker thread (like the web build),
  so the app stays responsive, a running program's output/telemetry streams live,
  and **Stop** reliably halts even a tight loop (it restarts the interpreter, so
  the RAM filesystem resets — exactly like a reconnect).
- **Web: installing a part's driver now works (#475).** On the web, installing a
  part driver from the banner (e.g. sg90 → `servo.py`) failed with "Could not read
  driver file" because the driver source wasn't available in the browser. The
  bundled driver files are now inlined at build time and served to the installer,
  so `import servo` works after one click.

### Added
- **The Standard Parts library ships with the web app (#475).** On the web, placed
  parts (servos, sensors, boards) had no library to resolve against, so a wired-up
  servo in the board view rendered as just its title. The build now inlines the
  bundled `snakie-standard` library (part geometry as JSON, images as served
  assets), so `parts.listLibraries` returns real definitions and the board draws
  parts as authored. Read-only — authoring/registry writes stay desktop-only.
- **The web app remembers your folder across reloads (#476).** The picked folder's
  handle is stored in IndexedDB; on the next visit it's rehydrated automatically
  when the browser still grants access, and otherwise the Files panel offers a
  one-click **Reopen &lt;folder&gt;** (browsers require a click to re-grant access).

## [0.26.0] - 2026-07-12

### Added
- **Snakie runs in the browser at [app.snakie.org](https://app.snakie.org) — epic #267.**
  The same editor, now a zero-install web app (great for Chromebooks and classrooms):
  - The **MicroPython simulator runs in a Web Worker** (#467, #469), so a `while True:`
    loop churns off the UI thread and **Stop** reboots it — the tab never freezes.
  - A **simulated `machine` module** (#472) means `from machine import Pin` — the first
    line of most lessons — works on the sim (the WASM port ships none); `Pin`, `PWM`,
    `ADC`, `I2C`/`SPI`/`UART`, `Timer` and friends behave plausibly.
  - The **instruments library auto-loads** (#473): `import instruments` /
    `from snakie import Servo` just work, and the "Install library" banner is functional.
  - **Open, edit and save real local files** via the File System Access API (#470) —
    genuine on-disk persistence, no server.
  - **Instrument telemetry animates** on the web sim (#471) — scope, meter, plotter, IMU
    and radar move without hardware. The app **auto-connects** to the simulated device
    on load, so typing a program and pressing **Run** works out of the box.
- **Robot mode works on the web (#267).** `window.api.robot` has a real browser backend:
  `robot.yml` loads and saves through the open folder using the same shared YAML pipeline
  as the desktop — so servo↔joint bindings, poses, the timeline and the project-URDF link
  all round-trip. Open a robot project folder, open its `.urdf`, and the 3-D robot renders
  with its STL meshes; run a servo program on the simulator and `SNK SERVO` telemetry
  animates the joints. Import STL works (browser file picker → `meshes/`); with no folder
  open, `robot.yml` persists to browser storage.
- **Auto-publish to app.snakie.org** (#468): every push to `master` rebuilds the web app
  and deploys it.

### Fixed
- **Files-panel "New file" is no longer dead without a folder.** With no folder open it
  now creates an untitled buffer (same as the toolbar), instead of a disabled button.
- **URDF mesh refs with `./` or `../` now load on the web** (path segments are
  normalised before walking the picked folder's handles; `..` clamps at the root).
- **Honest fallbacks when a backend is missing:** a stubbed robot save now reports
  "save failed" instead of a false "saved ✓", and a missing motion plugin shows the
  benign "install Python to sync poses" label instead of a spurious
  "managed block broken" warning.

## [0.25.2] - 2026-07-11

### Fixed
- **Popped-out instruments no longer open blank.** Undocking the Wi-Fi scanner (or the Bluetooth,
  Buzzer, Display, SAM or Range instruments) into its own window showed an empty window: those
  panels read the editor workspace with a hook that *throws* when there's no provider — and a
  detached OS window has none, so the render crashed. They now read the workspace safely (the
  workspace-only extras, like "insert a demo file", are simply inert in a detached window), so the
  pop-out renders normally.

## [0.25.1] - 2026-07-11

### Fixed
- **Binding a servo now takes the joint's real range, so the 3-D model doesn't clamp (#459).**
  A new servo↔joint binding used to default the joint range to a flat `0…180`, ignoring the
  joint's actual limits. On a joint limited to, say, `±90°` that made the on-screen model **stop
  halfway** — the physical servo swept fully but the 3-D joint hit its limit and clamped for half
  the travel. New bindings now seed the joint range from the joint's URDF `<limit>` (degrees for a
  rotating joint, mm for a sliding one) in **both** the Board View and Robot View pickers. Existing
  bindings are unchanged; fix one by setting its **Joint range** in the servo dialog.

## [0.25.0] - 2026-07-11

### Added
- **`snakie` — a friendly hardware module.** Board code can now `from snakie import Servo, Buzzer,
  Led, Pin, PWM` — the *hardware* classes, under a clear, collision-proof name (a vendor `servo`
  module, e.g. Pimoroni's frozen one, can't shadow it). It's a thin re-export of the on-device
  runtime, so `snakie.Servo` *is* `instruments.Servo`; the measurement tools (scope/meter/plotter)
  stay in `instruments`. Snakie installs `/lib/snakie.py` alongside `instruments.py` when you install
  or update the board library, so `from snakie import …` just works.
- **Poses instrument — a live servo test bench.** A new dock instrument reads your rig's
  servo↔joint map and saved poses from `robot.yml` and gives two quick ways to move the servos:
  **pose buttons** glide every bound servo smoothly into a saved pose (eased, applying each servo's
  calibration), and **per-servo sliders** nudge one servo by hand. Both drive the on-screen 3-D
  model **live with no program running** (via an in-app servo-drive channel) *and* stream a
  `SNKCMD servos …` line to the board, so a running program follows too. It lights up automatically
  once a servo is bound, reloads when you bind a servo or save a pose in either editor, and guides
  you when nothing is bound yet.
- **Bind a servo to a 3-D joint — from either view.** Wire a **servo** on the breadboard and choose
  which URDF **joint** it moves; a running program's servo writes then drive the matching joint in
  the 3-D Robot View live. Bind it two ways: from the **Board View** (a servo's inspector gains a
  "drives joint" picker) or from the **URDF editor** (the Robot View's **Servos** list now shows
  every breadboard servo — its label, the GPIO its signal is wired to, and a joint picker; unwired
  servos are flagged). Both write the one pin↔joint map in `robot.yml`, so the two views stay in
  step, and the existing telemetry pipe drives the model with no extra setup.
- **Motion Studio — puppet controls (#403, #416).** A Controls panel in the Robot View lets you
  build a named **slider** from two or more saved poses. Dragging it smoothly blends between the
  ordered poses and drives the live 3-D model in real time — one slider can sweep the eyes, morph
  a smile→frown, or play a stride. Arm **Live** (board connected + a servo bound) and the same drag
  streams to the physical servos too. Create a control by naming it and picking its poses in order;
  rename or delete controls, and pose renames/deletes cascade through them safely. Completes the
  Motion Studio epic (runtime · round-trip · pose authoring · sequences · controls).
- **Motion Studio — pose-step sequencer / walk cycles (#403, #415).** A new sequencer at the
  bottom of the Robot View authors motion as an ordered list of **saved poses** — stand → lift
  → step → plant — each with its own **duration** and **easing**, plus a **loop** toggle, instead
  of a grid of per-joint keyframes (the keyframe timeline stays, unchanged). Play/pause, stop and
  scrub against the 3-D model; add/reorder/remove steps inline. With a board connected and a servo
  bound, a **Live** toggle streams each frame to the hardware so the physical robot mirrors the
  preview (disconnect drops back to preview-only). Export writes the sequence into the managed
  `SNAKIE_SEQUENCES` block (#413) — timed to match the `snakie_motion` runtime so hardware plays
  exactly what you previewed.
- **Motion Studio — Capture Pose, duplicate, and partial poses (#403, #414).** The Robot View
  pose editor becomes a proper authoring surface. **Capture Pose** snapshots the current live
  posture into a named pose — whether you posed it with the sliders **or** a running program's
  servos are driving the model (`SNK SERVO` telemetry back-drives the joints, and a **Live ●**
  hint shows when they are). **Duplicate** copies a pose under a unique "*name* copy" without
  touching the original. And poses can now be **partial**: tick only the joints a pose should
  capture (e.g. a face-only wave) and the rest are left exactly where they are when you recall
  it. The pose library keeps its rename / delete / preview. `NamedPose[]` stays the single
  source the managed-block round-trip (#413) reads.
- **Motion Studio — an exported `.py` round-trips its poses & servo map (#403, #413).** The
  Robot View's exported motion file now carries Snakie's pose library, sequences and servo map
  in **guarded, versioned managed blocks** (`# --- snakie:poses v1 ---` … `:end`), written as
  `literal_eval`-safe assignments. Re-exporting rewrites **only** those blocks — your own code
  and the `FRAMES` runtime are byte-preserved. Opening a `.py` that carries them reads the poses
  and servos back (via the Python host's AST reader; no code is executed) and **merges** them
  into the live Robot View — additive by pose name / pin. A hand-edit that breaks a block pauses
  the sync and warns instead of clobbering it; a newer-schema block is left untouched; with no
  Python the round-trip is skipped gracefully. Foundation plumbing for the Motion Studio epic —
  the pose/sequence/puppet editors land in later issues.
- **Parts Library — a part can carry a 3-D mesh that drops into the Robot View (#399).** A
  library part can now link an **STL** (a relative `mesh:` filename in its folder, with
  `meshUnits: mm`/`m` or a `meshScale`) the way it already carries an image, driver and help
  doc. When you drag a mesh-linked part onto a design, its part is added to `robot.yml` as
  before **and** its STL is copied into the project's URDF `meshes/` folder and dropped into
  the 3-D **Robot View** as a loose part — staggered beside the base, ready to place and join,
  with no manual import. If the project has no URDF yet, a blank one is created and linked.
  The bundled **SG90 servo** ships a `model.stl` as the first mesh-linked part. Parts without a
  mesh drop exactly as before.
  View (above the instrument dock in Robot mode) gains a small **pose dropdown** (top-right,
  beside the Home button) when the robot has saved poses. Pick one and the docked model
  **eases smoothly** to that pose — a quick preview without opening the full pose tool. It's
  view-only (never writes `robot.yml`), lists only poses that fit the displayed model, and
  hides when there are none.
- **Robot View — keep a robot's meshes with the project (#399).** When a `.urdf` points at
  STL/DAE meshes that live **outside** the project folder (an absolute path, or one that
  escapes via `..`), Robot View now shows a **"Copy N mesh(es) into project"** offer. Accepting
  copies each file into the project's `meshes/` folder (collision-safe — never overwrites) and
  rewrites the URDF to the in-project path, in **one undo step**, so the robot is self-contained
  and safe to move, zip, or commit. In-folder and `package://` refs are left alone. Fixes meshes
  silently going missing when a project is shared or relocated.
- **Robot View — colour an individual part (#399).** The link Properties panel gains a
  **Colour** control — the same colour well + one-click "used colours" swatches as the Part
  Editor — right beside **Size (mm)**. It works for **primitive** parts (box/cylinder/sphere)
  **and imported STL meshes**, so a multi-part robot no longer has to be a flat grey blob —
  colour it to match your real hardware. Pick a colour and only that part recolours, live;
  every other part keeps its colour. The colour is stored in the model's URDF `<material>`,
  so it round-trips on reload and is covered by undo/redo. (Selecting a part still tints it
  blue, but now over its own colour, so the change is visible while it's selected. DAE/Collada
  meshes keep their own baked-in materials, so they show the "grab a face in 3-D" note
  instead.)
- **Robot View — a hinge rotates about the mated normal, Fusion-style (#399).** A new
  Rotation/Linear joint now takes its **axis from the two faces you mated** — it turns (or
  slides) about the normal through the joint, the same axis its Roll uses — instead of a
  guessed `Z`. So a servo horn spins on its mounting face without you hunting for the right
  axis. (You can still override the axis in the joint editor.)
- **Robot View — Add Joint previews the mate live (#399).** As soon as you pick the
  second point, the child snaps onto the parent **in the 3-D view** — so you see the
  result and can tell whether it needs a roll **before** pressing Add. Changing the type,
  offset or roll updates the preview live; **Cancel** puts everything back exactly as it
  was. (Debounced so it stays smooth on mesh-heavy robots.)
- **Robot View — an explicit kinematic Chain view + a parent picker (#354).** The build
  panel now shows the robot as an indented **Chain** — `Base → Shoulder → Arm → Servo` —
  so the parent→child structure is always visible (a part nested under the wrong parent
  is obvious at a glance), with the connecting joint type on each row and a **⚠ loose**
  tag for parts not yet in the chain. Editing a part now has an **"Attaches to"** dropdown:
  pick its parent explicitly from the existing structure instead of relying on 3-D
  pick-order. Re-parenting **keeps the part exactly where it is** (world pose preserved) and
  can't form a loop — so you can build a chain reliably, and repair a tangled one (move the
  arm under the shoulder, the servo under the arm) without deleting and re-mating. The 3-D
  Add Joint tool stays, now purely for geometry (where parts meet + orientation).

### Changed
- **`Servo` accepts a PWM you made yourself.** The bundled SG90 driver's `Servo(...)` now takes a
  GPIO number, a `Pin`, **or** an already-made `PWM` — so `base_pwm = PWM(Pin(0)); base = Servo(base_pwm)`
  works and the code reads `pin → PWM → Servo → joint`, mirroring how a servo connects to the model.
  A bare pin is still wrapped for you; a PWM is used (and shared) as-is.
- **Exported motion is plain-MicroPython pin → variable setup.** The Robot View's exported motion
  code now sets each servo up as a pure `<joint>_servo = PWM(Pin(n))` followed by
  `<joint> = Servo(<joint>_servo, pin=n)` — servos are named by the joint they drive, so the code
  reads like the rig. It runs on hardware *and* in the Snakie simulator (a `try/except` import falls
  back to CPython-safe stubs), and the `pin=` keeps each servo emitting `SNK SERVO`, so running the
  exported code still moves the 3-D model. `instruments.Servo(pwm)` now sets the 50 Hz servo
  frequency on a hand-built PWM.
- **Simpler workspace switcher + softer blueprint grid.** The workspace switcher now shows just
  **Code · Robot** — the Board and Data Lab entries are hidden (the Board View is still reachable via
  its pop-out window and the Robot workspace; deeper cleanup tracked in #447). The blueprint
  breadboard's graph-paper grid lines are a touch softer so they read as a backdrop.
- **Fainter blueprint grid (#452).** The blueprint breadboard's graph-paper lines are now ~50%
  more transparent again, so they sit further back as a subtle backdrop behind the parts.
- **Robot View — joints are first-class in the Build hierarchy.** Each connecting joint now has its
  own row directly above the link it drives, showing a **type glyph** (a lock for fixed, a rotation
  arrow for a hinge, a spoked wheel for continuous, a slider for prismatic), the **joint name** (so
  it matches the Servos list and the pose editor), and its **type badge**. **Rename a joint** by
  right-clicking its row or from the joint dialog's new **Name** field — the rename cascades through
  the servo bindings, poses, timeline, mirror pairs and per-joint settings. Link rows also carry a
  **mesh-vs-cube** glyph.
- **Robot View — clearer, self-sizing Build hierarchy.** The panel now **sizes to its longest row**
  (name + indentation) and truncates anything past **a third of the screen**, and it only grows down
  to the top of the bottom-left help hint — the **Open** / **+ STL / DAE** buttons no longer sit
  over it; the list scrolls instead.
- **Robot View — Motion Studio tools share one collapsible dock (#403).** The keyframe timeline,
  pose sequencer and puppet controls no longer stack as three full-width bars crowding the bottom
  of the screen. They're now **tabs in a single dock** — pick **Keyframes / Sequence / Controls**,
  and a chevron collapses the whole dock to just its tab strip so the 3-D stage goes full-height.
  The dock remembers your last tab and open/closed state, and a tab shows a dot when that surface
  already has content, so a populated-but-hidden tool advertises itself.
- **In-app Help links to the full online docs (#418).** The Help panel now has a
  **"Full documentation at docs.snakie.org"** link in its contents view and after every
  article, so you can jump to the complete, searchable docs in your browser.
- **Robot View — poses ease smoothly everywhere (#399).** Selecting a saved pose now
  **eases** the robot from its current position to the new one (≈0.4 s) instead of snapping —
  not just in the docked mini viewer but also in the full pose tool's Poses list and the
  pose dialog's **Recall**. Re-picking mid-transition re-targets smoothly.
- **Robot View — clearer snap targets when joining parts (#399).** Adding a joint now draws
  each snap candidate with a **role-distinct glyph** (corner = square, edge = diamond, centre =
  dot, hole = ring) instead of identical dots, emphasises the one you're about to land on, and
  shows a live **"snap ✓ hole centre / corner / edge …"** tooltip at the cursor *before* you
  click. The hit tolerance is now a single set of tuned constants shared by hover and click, so
  what lights up under the cursor is exactly what a click lands on — and holes still magnetise
  within a generous radius so they're easy to hit. **Hold Shift to lock** the highlighted snap
  (Fusion-style), then slide the cursor over the hole and click — so you can land on the centre
  of a face whose middle is empty (e.g. a servo cut-out) without the target following the cursor.
- **Robot View — the Build (Chain) dock is a little wider (#399).** Bumped from `15.5rem`
  to `17.5rem` (capped `min(18rem, 42vw)`) so long STL-derived link names like
  `left_shoulder_bracket_v3` read in full in the Chain tree instead of being cut off by the
  ellipsis. It still floats over the 3-D stage and never claims more than a modest slice on
  narrow windows.
- **Robot View — the pose sidebar is retired; posing moves to a popup (#312).** The
  old right-hand pose panel duplicated the build panel (assembly, servos, poses). It's
  gone: **pose the robot in a popup** — the build panel's **Poses → ＋ New pose** (or
  clicking a pose) opens an editor with a **full-width slider per joint** (its own row,
  no longer squashed beside the joint name) and a **directly-editable value** so you can
  type an exact angle; drag to pose, name it, **Save**. Servos got a **＋ Bind a servo**
  in the build panel, and the save-status / measure readouts moved to small floating
  pills. The Timeline still animates.
- **Robot View — a cleaner, Fusion-style build hierarchy (#354).** The panel is
  **wider** so long STL names have room, and it drops its solid slab — each line now
  sits on its own **subtle off-white card** so it reads over the 3-D canvas. Per-row
  clutter is gone: the base is marked with an **anchor** (not a star), and **Rename /
  Make base / Delete** moved to a **right-click menu** (renaming a part updates it
  everywhere it's referenced). Mesh rows show a compact `stl`/`dae` tag instead of
  repeating the filename.

### Added
- **Robot View — Join tool: a roll angle on every joint type (#354).** The Add Joint
  dialog now has a **roll (°)** field alongside the X/Y/Z offset — for **Static** joints
  too — that spins the child about the joint's normal axis while keeping the mated faces
  flush, so you can orient a bracket/part however you like at the connection.
- **Robot View — edit an existing joint's offset + roll, live (#354).** Clicking a
  joint in the build panel's **Joints** list now shows an **Offset (X/Y/Z, mm)** and a
  **Roll (°)** control in the joint editor — for **Static** joints too, not just when
  first adding them. Both apply **immediately** as you type or nudge the spinner (no
  Enter needed), and the **roll is an absolute value that's remembered** — reopen the
  joint and it still reads the angle you set (instead of snapping back to 0), so you can
  fine-tune it or return it to 0 yourself. Nudge a connection into place or spin a part
  about its normal without deleting and re-joining.
- **Robot View — import parts, pick a base, articulate them into a chain (#354).**
  Imported STLs no longer stack on top of the first part at the origin. Each import
  now attaches to the base with a **movable joint** at a **staggered** position, so it
  lands beside the base as its **own** part — drag it to place, then use **Add Joint**
  to articulate the kinematic chain. You **pick which part is the base** (right-click →
  **Make base** — the anchor everything hangs off, remembered in `robot.yml`). Every
  part is independently selectable + movable (a part with no joint of its own would
  collapse into the base's scene node and co-select — so each gets its own joint).
- **Robot View — the build hierarchy hides empty sections.** Blocks / Meshes / Joints
  / Servos / Poses only appear when they actually have something in them, so the tree
  stays focused on what your robot has.
- **Robot View — Join tool: SHIFT-lock snapping + an on-surface target (#354).**
  While picking a joint point, an accurate **target** is drawn on the surface (a
  circle + X/Y/Z axis triad; a **cross-hair** over a hole / loop centre) so you can
  see exactly where it will land. Sliding the cursor onto a hole used to lose the
  snap (there's no surface at the centre to hover) — now **hold Shift** to lock the
  snaps in place and click the hole centre.
- **Robot View — rotation joints get min/max + a default angle (#354).** When you
  choose **Rotation** in the Add Joint dialog, min / max angle limits and a default
  angle (degrees) appear; **Add** writes the joint's `<limit>` and saves the default
  to the robot's default pose. The joint is then movable — drag it in the pose
  panel to preview the swing, and it loads at the default angle.
- **Robot View — Join tool fades the first-picked block (#354).** After you pick a
  point on the first block, that block goes semi-transparent (Fusion-style) so it's
  obviously chosen — and can't be picked as the second component. It restores when
  the joint is added or cancelled.
- **Robot View — Join tool mates faces by their normals + on-face markers (#354).**
  Picking a point now captures the **face normal**, drawn as a **circle laid flat on
  the face** with an **X/Y/Z axis triad** (blue = parent, green = child) — it sits in
  3-D on the surface instead of facing the camera, so it reads accurately from any
  angle. The joint is oriented from those **local** face normals: the child rotates
  so its face meets the parent's flush (its normal anti-parallel to the parent's) and
  the two picked points coincide.
- **Robot View — delete a joint (#354).** Clicking a joint in the **Joints** branch
  already opened its editor (type / axis / limits); it now also has a **Delete**
  button that removes the joint and re-attaches the block to the base, keeping its
  current position so it doesn't jump.
- **Robot View — Join tool: smart parent/child + multi-joint chains (#354).** You
  no longer have to pick the two blocks in the "right" order — if the chosen order
  would form a loop but the reverse wouldn't, the tool **swaps** parent and child
  for you. Building a chain of joints works (each new joint keeps the earlier ones);
  note that a joined child snaps to meet its parent, so it visibly moves.
- **Robot View — Join tool snaps to hole centres (#354).** When you pick a joint
  point on an imported mesh (STL), the tool detects **hole centres** on the clicked
  face — an STL is just triangles, so it finds the coplanar rim-edge loops, and a
  roughly-circular loop's centre becomes a snap point (plus the face outline centre
  and midpoints of long edges as alignment guides). Hover reveals the snaps.
- **Robot View — Join tool (#354).** A new **Add Joint** button on the build
  toolbar opens a floating dialog, then you **click a point on each block in 3-D**
  to connect them: Component 1 (parent) then Component 2 (child), each snapping to a
  face corner / edge / centre. Choose the joint type (**Static / Rotation / Linear**)
  and an optional X/Y/Z offset, then **Add** — the child snaps so its picked point
  meets the parent's, is re-parented under it, and the new joint appears in the
  **Joints** branch. Refuses a connection that would form a loop.
- **Robot View — open a different robot (.urdf).** The docked mini viewer gains an
  **📂 Open…** button (alongside New robot / Pop out) and the pose tool's Build
  panel gains one too, so you can pick and open another robot model via the native
  file dialog — including when the view is popped out full-screen.
- **Robot View — hierarchy is now a node tree with context dialogs (#353).** The
  Build panel groups the model into collapsible branches — **Blocks**, **Meshes**,
  **Joints**, **Servos** and **Poses** — each with a count. Clicking a node opens
  a Fusion-style floating dialog on the right tailored to it: a **joint** shows its
  type/axis/limits/mimic; a **servo** shows its joint mapping, servo/joint ranges,
  invert and a delete; a **pose** shows rename, **Recall** and delete; a
  **block/mesh** (edit pencil) shows size + joint. Block/joint edits apply live and
  **Cancel** reverts them; servo/pose edits are held until **OK**.
- **Robot View — Fusion-style Properties dialog (#352).** Clicking a block's
  **edit pencil** now opens a floating, **draggable** properties dialog on the
  right (size + joint) instead of expanding the hierarchy row. Edits apply live to
  the 3-D preview; **OK** keeps them, **Cancel** discards them (the URDF is
  snapshotted on open and restored on cancel) — both close the dialog. Delete
  moved onto the hierarchy row.
- **Robot View — animated camera moves.** Clicking a nav-cube face/edge/corner,
  focusing a block from the hierarchy, **Home** and **Fit** now **glide** the
  camera to the destination (eased ~0.3s) instead of jumping, so you can see where
  the view came from and went to. Grabbing the viewport cancels the glide. The
  zoom **%** now also tracks scroll-zoom in **perspective** mode (dolly distance),
  and focusing one block no longer clips the others.
- **Robot View — themed background + a richer navigation cube.** The 3-D viewer
  background now follows the theme (**white** in light, **black** in dark). The
  ViewCube is **brass**, always drawn in **perspective** (independent of the view's
  projection), sits tight in the top-right, shows **X/Y/Z axes** (red/green/blue
  with labels) along its base, and uses a pointer cursor so corner picks aren't
  hidden by the hand cursor.
- **Robot View — orthographic / perspective toggle.** A dropdown beneath the
  navigation cube switches the camera between **Orthographic** (default, no
  distortion — best for building) and **Perspective** (a natural, lens-like view).
  Switching re-frames the model; zoom / orbit / snap all work in both.
- **Robot View — undo / redo for builder actions (#338).** Every builder edit
  (add / push-pull / move / delete / joint change / mesh import / re-root) is now
  an undo step: **⌘Z / Ctrl+Z** to undo, **⇧⌘Z / Ctrl+Y** to redo, plus undo/redo
  buttons on the build toolbar. A drag is a single step; undoing a delete restores
  the block + its sub-tree; the camera doesn't jump. (History is per-file.)
- **Robot View — timeline: duplicate keyframes + mirror-invert toggle (#332).**
  The motion timeline gains a **⧉ Duplicate** control (copies the selected
  keyframe — or the whole pose at the playhead — to a free slot, growing the clip
  if it lands past the end, never overwriting an existing key), and a per-pair
  **mirror-invert** checkbox so a reversed-axis left↔right joint mirrors correctly
  in one click (persists to `robot.yml`).
- **Robot View — navigation cube.** A large CAD-style **ViewCube** at the
  top-right of the 3-D viewer, mirroring the camera as you orbit and lit from the
  lower-front so it reads as a solid block. **Click a face, edge or corner** (26
  orientations) to snap the view, **drag the cube** to orbit, and the region under
  the pointer highlights with a brass overlay (a plate on a face, a bar on an edge,
  a cube on a corner). A **Home** button (revealed on hover) resets to the default
  isometric view. Runs in its own canvas so it never fights the viewer's orbit/zoom.
- **Robot View — new blocks & meshes arrive at the origin, not stuck to the
  selection.** Adding a block or importing an STL/DAE now drops it at the
  **workspace origin** (attached to the base), **selects it**, and **reframes** so
  it's actually in view — instead of auto-joining it to the selected part with an
  offset (a placement that can't be guessed). Selecting a block in the Build list
  highlights it in 3-D, meshes included (re-applied once an async mesh loads).
- **Robot View — zoom controls + a consistent pin.** The 3-D viewer gains the
  usual floating **zoom cluster** bottom-right (−, a live **%** readout, +, and a
  **zoom-to-fit** button), styled identically to the node-graph control;
  **double-click the %** toggles 100% ↔ fit. The Build panel's pin button now uses
  the app's standard **pushpin** icon (outline when loose, filled when pinned) and
  accent colour, instead of a one-off gold star.
- **Robot View — "Make base" + base protection (#309 builder).** A URDF hangs off
  its **base** link, so deleting the base used to leave an empty, unusable file.
  Now the base **can't be deleted** (its ✕ is disabled with a hint, and it shows a
  "★ This is the base" badge), and every other block gains a **★ Make base** button
  that re-roots the whole model onto it — reversing the joint chain up to the old
  base (origins inverted exactly, off-path sub-trees left untouched). So you can
  bless a new base mid-build and then delete the old one. Fixed joints re-root
  perfectly; a movable joint that happens to sit on the reversed path keeps its
  axis/limits (best effort).
- **Robot View — joint editor: hinges, sliders, wheels + mimic (#315, epic #309
  Phase 5).** Editing a block in the Build panel now also sets **how it moves**
  relative to its parent: pick **Fixed / Hinge / Slider / Wheel** (URDF
  fixed / revolute / prismatic / continuous), choose the **axis** (X / Y / Z) and
  set **limits** (degrees for a hinge, mm for a slider). A **Copies** dropdown
  makes the joint **mimic** another with a gear ratio (× multiplier + offset) —
  e.g. a gripper's two fingers, or a geared pair. Every change rewrites the URDF
  and shows up **live** in the pose tool and the motion timeline, so you can
  build a 2-link arm from blocks, make the elbow a hinge and pose it straight
  away. Completes the #315 builder scope (primitives + push/pull + move + joints).
- **Robot View — builder tools: a toolbar + move-with-snap (#335, epic #309
  Phase 5).** The block builder gains a floating **tool toolbar** (top-centre of
  the stage): **Pick** (select), **Push & pull** (resize a face), **Move** a
  block, and **Join** (coming soon). The new **Move** tool slides a block around
  with a live mm read-out and a 5 mm grid (hold **Shift** for 1 mm); hover a face
  and Fusion-style **snap handles** appear on its corners, edge-midpoints and
  centre, so you can drop a block with its face point landing exactly on another
  block's corner / edge / centre (the read-out shows **snap ✓**). Moves rewrite
  the block's fixed-joint origin in the linked URDF, and the camera never jumps.
- **Robot View — kid-friendly block builder (#315a, epic #309 Phase 5).** Build a
  robot from blocks: a floating, transparent, pinnable **Build** panel on the left
  (like the breadboard's library dock) lists your components with a per-item edit
  pencil (view by default). **＋ Box / Tube / Ball** adds a primitive that sticks
  to the selected part (a fixed joint — no jargon). Grab a **face and pull** to
  resize it — Fusion-style, with the **live measurement** shown and the opposite
  face held put — or type exact mm. Edits save straight into the linked project
  URDF, and the camera never jumps. (Revolute/prismatic joints + a mimic editor
  are the follow-up #315b.)
- **Robot View — motion timeline → MicroPython (#314, epic #309 Phase 4).** A
  keyframe timeline docks under the pose tool: a track per joint, **play / loop /
  scrub** with **linear or ease-in-out** easing, snapshot the pose as a keyframe
  or **import a saved pose**, and **mirror** a track onto its left↔right partner
  (**Mirror ½** offsets half a cycle — a walk). **Export .py** bakes the eased
  motion into runnable MicroPython that drives the servos from the servo↔joint
  map — the *same* clip plays in the simulator and on a board. Persists in
  `robot.yml` (`timeline` + `mirror`). Try `examples/biped/`. The generated code
  is proven runnable by an end-to-end test that executes it on the real
  MicroPython interpreter and checks the servo stream.
- **New blank robot (.urdf) from Robot mode.** The docked mini-viewer gains a
  **＋ New robot** button (highlighted when there's no robot yet) that creates a
  minimal starter `.urdf` (one `base_link`) and opens it in the pose tool — a
  real file in the project folder (so STL import + persistence work immediately),
  or an untitled buffer when no folder is open. Import meshes from the Assembly
  panel to build it up.
- **Robot View — servo↔joint binding & code-driven simulation (#313, epic #309
  Phase 3).** The keystone: a running MicroPython program's servo writes now
  animate the 3-D robot, **headless** (no board — it runs in the simulator).
  Bind a servo pin to a URDF joint in the pose tool's new **Servos** panel, with
  angle-range calibration (servo 0–180° ↔ joint min–max, plus invert); the map
  persists in `robot.yml` (`servoJointMap`). `inst.servo_on(pin).angle(...)`
  emits pin-keyed telemetry that drives the bound joint in real time — try
  `examples/servo-arm/` (open `arm.urdf`, Run `sweep.py`). Works tethered too
  (same telemetry path on a real board).
- **Robot View — pop-out, assembly panel & one-click STL import (#324, epic
  #309).** The docked mini 3-D viewer gains a **⤢ Pop out** button that opens the
  robot full-screen (Code mode) with the pose tool. The full-screen view now
  shows an **Assembly** panel — every link + the STL/mesh file it uses — and a
  **+ STL** button: pick a mesh and it's copied into the robot's KRF
  `urdf/meshes/` folder (collision-safe) and wired into the `.urdf` as a new link
  + fixed joint, so it appears in the model and the assembly immediately.
- **Robot View — Pose tool (#312, epic #309 Phase 2).** Opening a `.urdf`
  full-screen now gives a **pose tool**: a joint sidebar with a slider per joint
  (degrees for revolute, mm for prismatic) that moves the robot live, respecting
  the URDF limits. `<mimic>` joints follow their master (multiplier + offset),
  shown read-only. Edit a joint's min/max inline; save & recall **named poses**;
  and a **measure tool** reports the point-to-point distance between two clicks.
  Limit overrides + poses persist to `robot.yml` (KRF), and the docked Robot-mode
  panel gains an **⤢ Pose** button to open the robot full-screen. Also fixes the
  `robot.yml` (de)serialiser to round-trip the KRF `robot:` section.
- **Robot View — STL & DAE meshes (#319, epic #309).** Robot View now renders
  real robots: a URDF's `.stl` / `.dae` (Collada) meshes load straight from the
  project folder — no web server. Relative (`meshes/link.stl`) and `package://`
  paths both resolve against the URDF's folder, the URDF `<material>` colour is
  applied to meshes that carry none, and the camera reframes once they arrive. A
  mesh that can't load degrades to a small placeholder + a panel note (the rest
  of the robot still shows) instead of a blank model or a crash. Try
  `examples/mesh-demo/mesh-demo.urdf`. The mesh loaders stay code-split in the
  Robot View chunk.
- **Robot workspace mode (#320, epic #309).** A new **Robot** tab joins Code ·
  Board · Data Lab: files collapsed, your code on the left (~⅓), the Board View
  in the middle, and on the right a **mini 3-D Robot panel over the instrument
  dock** — code, wiring, the robot and live instruments in one glance. The 3-D
  view now defaults to an **isometric** (orthographic) camera, and the docked
  panel finds the project's URDF via the KRF `robot.yml` (falling back to the
  bundled demo arm). The 3-D engine stays code-split (only loads in Robot mode).

- **Robot View — 3D URDF viewer (#311, epic #309 Phase 1).** Opening a `.urdf`
  file now shows the robot model in a three.js scene with orbit / pan / zoom.
  URDF primitives render with no external meshes (the bundled
  `examples/demo-arm.urdf` is zero-setup), the camera auto-frames the model on a
  ground grid, and a malformed URDF shows a graceful error instead of a blank
  panel. The 3D engine is code-split, so it only loads when you open a robot.
  Built on the KRF format (#310); the pose tool, servo↔joint binding and motion
  timeline follow.

### Changed
- **Robot View — Join tool: the snap target is now directly clickable (#354).** The
  on-surface cross-hair showed exactly where a joint would land — but a click still
  measured its own pixel distance and often dropped a raw surface point instead, so
  the hole centre you were aiming at was frustratingly un-clickable. A click now
  lands on **exactly the snap the cross-hair is showing** (what-you-see-is-what-you
  -get), and the cross-hair **stays put as you move onto a hole** without needing to
  hold Shift (Shift still force-locks for large holes). A side effect: on a
  primitive block a joint pick always snaps to the nearest face handle
  (corner/edge/centre) — the exact point the target marker previews.
- **Robot View — a clearer selection highlight.** The selected block was outlined
  with a brass wireframe of every edge, which read as a see-through cage. It's now
  tinted **light blue**, keeping the material's shading (so the sides still shade
  rather than going flat). Clicking a part in the build hierarchy highlights it, and
  only **one** part is ever highlighted — even when parts are joined into a chain.
- **Robot View — Join tool: on-surface, colour-coded pick markers (#354).** The
  pick guides now read as painted onto the face: the **hover target** is a
  translucent **blue** disc, every **snap point** is a small translucent disc laid
  flat on the surface, and the committed picks are filled discs — **green** for
  component 1, **blue** for component 2 — each with a bright ring + axis triad, drawn
  on top so they're always visible.
- **Robot View — default view is the perspective "home" corner.** The viewer now
  opens in **perspective**, framed from the cube's **top-right-front corner**
  (+X/+Y/+Z), zoomed to fit — and that's exactly where the **Home** button returns.
- **Robot View — blueprint-style ground grid.** The grid is now much **lighter**
  and theme-aware (subtle on both white and black backgrounds), with **major +
  minor** subdivision lines, plus **red-X / blue-Z origin lines** through the
  centre. It re-colours live when the theme changes.
- **Robot View polish.** The **build menu defaults to pinned-open**; the
  navigation cube is **brighter brass** with its X/Y/Z labels **occluded** by the
  cube (no longer showing through); and the ortho/perspective dropdown collapses to
  just its ▾ arrow, revealed (like the Home button) only when the pointer is over
  the top-right nav zone.
- **Robot View — clearer measure tool.** Measuring now draws a **dashed line**
  between the two picked points with the distance shown in a **floating pill on
  the model** (mm / m), so you read it in context. Clears on re-measure or when
  the tool is turned off.
- **Robot View builder — tidier toolbar + panel.** The **add Box / Tube / Ball**
  buttons and the **Measure** tool moved onto the floating build toolbar (with the
  select / push-pull / move / join tools and undo/redo). The left panel keeps the
  hierarchy; **★ Make base** is now a one-click star on each block's row (no longer
  hidden in edit mode). The collapsed **Build** tab is squared off and reads
  top-to-bottom. Accent text in the builder (headings, the STL filename) uses a
  **darker brass** (`--accent-ink`) so it's readable on the parchment theme, and
  the toolbar's active-tool highlight is a neutral fill instead of hard-to-see gold.
- **Robot pop-out now keeps you in Robot mode.** Instead of switching to Code
  mode, popping the robot out (or creating a new one) enters a transient *focus*:
  it hides the board, instruments and console so the URDF fills the editor, and
  restores your Robot layout the moment you switch modes, re-click the Robot tab,
  or reopen any panel. Nothing about Robot mode is permanently changed.

### Fixed
- **Servo "drives joint" picker works in the in-window board pane.** In the main window's
  breadboard view, clicking a servo always showed "GPn · no joints" even when the linked rig had
  joints — because that pane never loaded the URDF's joint names (only the pop-out Board *window*
  did). It now reads the linked `.urdf`'s joints like the pop-out, so you can bind a servo to a
  joint from either place. The picker also keeps showing a servo's current joint even if that
  joint was renamed/removed from the URDF (an orphan binding), instead of silently blanking —
  matching the URDF editor's servo list.
- **Robot View — the 3-D view keeps its camera when you switch editor tabs (#399).**
  Flipping to another file tab and back used to reset the robot to the default framing,
  losing your orbit. Two causes: orbiting/panning wasn't recorded (only the zoom/home/fit
  buttons were), and the view fully unmounts when you leave its tab. Now every camera move
  is remembered per-file in a cache that survives the unmount, so you come back to exactly
  the view you left.
- **Robot View — editing a joint's Roll turns it about the mating normal, not the
  wrong axis (#354).** The Roll field on an existing joint spun the part about the joint's
  local Z, which usually isn't the axis the two faces are joined on — so the part rotated
  the wrong way. Roll now turns about the **mating normal** (the same axis the Add-Joint
  mate used), which is captured + remembered per joint (it can't be recovered from a
  finished joint afterward). Joints mated before this update fall back to the old axis —
  **re-run Add Joint on them once** to capture their normal.
- **Robot View — the Join tool is now predictable: you control the hierarchy (#354).**
  The tool used to *guess* which of the two picked parts was the parent, using descendant
  count — so joining a part that already had something attached (e.g. an arm with a servo)
  would wrongly make **it** the parent and flip your chain, and you could never build
  `base → shoulder → arm → servo`. Now **Component 1 is the parent (the anchor that stays
  put) and Component 2 is the child (it attaches onto Component 1)** — the tool only
  auto-swaps to prevent a loop, and never re-homes the base. A **⇅ swap** button in the
  Add Joint dialog flips parent ↔ child if you picked them the wrong way round, and the
  labels/hints spell out which part moves. Build a chain by picking parent-then-child.
- **Robot View — removing a joint no longer fuses the freed part into the base (#354).**
  Deleting a joint used to leave its part *rootless*, and the loader collapses every
  rootless part into the base's single scene node — so the base and every freed part
  **highlighted together** and you couldn't pick just one to re-join it (which also made
  a follow-up joint look "ignored"). Deleting a joint now **re-attaches the part to the
  base as a loose part**, nudged to a clear spot beside the base (like a fresh import)
  so it's off its old parent and easy to pick — its sub-assembly relocates with it — and
  each part stays independently selectable so you can articulate a new chain from it.
- **Robot View — adding a joint no longer blanks the view (#354).** After a joint was
  added the selected block's highlight was re-applied during the scene rebuild, but the
  helper it needed was declared *later* in the same setup — a temporal-dead-zone crash
  that blanked the whole Robot View (intermittent, since it only fired once the block's
  mesh had finished loading — which is why "the 3rd joint vanished"). The helper is now
  declared before it's used, so chaining any number of joints is solid.
- **Robot View — the Add Joint dialog's buttons are always clickable (#354).** The
  properties dialog sat *below* the zoom controls, so when it grew tall enough to reach
  the bottom-right the zoom toolbar covered its **Add** button — clicks landed on "Zoom
  to fit" and the joint was silently not added (looked like the 3rd joint "vanished").
  The dialog now floats above the 3-D chrome and caps its height so the footer stays
  reachable.
- **Robot View — the mini 3-D viewer zooms to fit the robot on load (#320).** The dock
  viewer starts on the demo arm and swaps to your project robot once it resolves, but it
  kept the demo arm's camera — so your robot loaded tiny and off-centre. It now re-frames
  when the robot changes, filling the mini view.
- **Robot View — Join tool: holes are easier to grab (#354).** Snapping a joint point
  onto a hole was fiddly — an edge that was a touch closer would win, so the cross-hair
  flicked off the hole as you moved to click. A **hole / loop centre now sticks** when
  the cursor is within a generous radius (it wins over a marginally-closer edge), so the
  cross-hair stays on the hole and the click lands there.
- **Robot View — Join tool: the hinge pivots at the joint, not the part's middle (#354).**
  A rotation joint rotated the child about its *own centre* instead of the point you
  picked, so a hinge ended up "halfway along the part". The joint origin now sits **on
  the mating point**, and the child is re-origined onto its picked point (its mesh — and
  any parts hanging off it — stay exactly put), so a hinge swings about the joint.
- **Robot View — Join tool: the second block is now always selectable (#354).**
  After picking Component 1 it fades — but the faded mesh still hit-tested, so when it
  sat in front of the camera it stole every click and Component 2 "went dark and
  wouldn't select". The picker now **excludes the already-picked block** from the ray
  (and the selection highlight no longer draws a black outline that made the block
  look dark), so you can always click the other part.
- **Robot View — Join tool: only the first block fades.** Picking Component 1 faded
  the whole robot, because its material is usually shared (everything uses "steel");
  the fade now swaps in a transparent clone for just that block's mesh, so every
  other object stays solid and pickable as Component 2.
- **Robot View — the properties / Add-Joint dialog drags in place.** It jumped down
  and right on the first drag because the pointer's viewport coordinates were applied
  as `left`/`top` relative to the 3-D stage; the drag now converts by the stage offset.
- **Robot View — Pop-out opens in the home view.** Popping the robot out full-screen
  reused a preserved camera, so it wasn't fit/oriented; it now re-frames to home
  (as if you clicked the Home button) when it goes full-screen.
- **Robot View — deleting a joint now actually removes it (#354).** Delete used to
  re-attach the block to the base, which is a no-op for a joint that's already off
  the base — so those joints (e.g. the two fixed joints in a fresh robot) couldn't
  be removed. Delete now strips the joint outright; the block becomes free-standing
  and stays where it was (its position is baked into its visual origin so it doesn't
  jump).
- **Robot View — nav + mini-viewer polish.** The projection dropdown under the
  navigation cube no longer vanishes when you reach for it (it sat just outside the
  nav zone's hover box, so moving the pointer down dropped the hover; the zone now
  extends to contain it, and the target is a touch larger). The docked mini-viewer's
  **New robot** / **Pop out** buttons are readable in the light skin (they hard-coded
  a dark fill, so the dark label was dark-on-dark) and now use theme tokens. The mini
  viewer also gains a **Home** button (top-right) that flies back to the fitted
  default view.
- **Robot View — hierarchy dialog follow-ups (#353).** Renaming a pose onto an
  existing pose's name no longer silently destroys that pose (the rename is refused
  with an inline warning). The servo dialog's number fields hold raw text while you
  type, so you can clear a field or type a leading `-` (a negative joint range)
  without it snapping to 0. Switching hierarchy nodes mid-edit keeps the previous
  block's live edits (Fusion-style, still ⌘Z-undoable) and each node's **Cancel**
  now only reverts that node's own edits.
- **Robot View — a batch of navigation / layout fixes.** The **Home** button now
  responds to clicks (it sat under the cube canvas — it's raised above it and only
  captures clicks while the nav zone is hovered, so the cube corner stays pickable)
  and orients to the **top-left-front** corner. The first **Fit / 100%** no longer
  clips the model (the near plane was bracketed off the *far* end of the glide;
  it now uses the nearer end). The Properties dialog opens **comfortably below the
  nav cube** instead of behind it. In the Build hierarchy, the ☆/✎/✕ icons moved to
  the **left of the block name** so they no longer overlap long titles, and the
  panel now **sizes to its contents** (scrolling if needed) so it no longer covers
  the Help hint in the bottom-left.
- **Robot View — the Move tool now moves imported meshes.** It bailed on any link
  without primitive geometry, so STL/DAE parts couldn't be dragged; meshes now
  move (grabbing the hit point; primitives still get the face snap points). The
  Build hierarchy text is also a little larger (matching the breadboard browser).
- **Robot View readouts are readable in light mode.** The 3-D viewer's info/hint
  HUD (also the docked mini-viewer's text) used a dark pill, so its text was
  dark-on-dark on the parchment theme; it now uses a parchment pill with brass
  emphasis in light mode.
- **Robot View — imported meshes no longer render massive / clipped.** STLs
  authored in millimetres loaded 1000× too big (a huge mesh pushed the camera past
  the fixed far-plane, so only a "letterbox" sliver rendered). Imports now measure
  the mesh and normalise the scale (mm→m via `<mesh scale>`); the camera's near/far
  planes are also bracketed dynamically around the framed model so nothing clips at
  any size/offset.
- **Robot View — clicking a block in the hierarchy zooms to fit it**, and the
  navigation cube: **lighter brass**, 25% smaller, **longer X/Y/Z axes**, a
  **primary-button-only** guard (right/middle click no longer snaps the view), and
  a `pointercancel`/`lostpointercapture` reset so a stolen drag can't leave it
  orbiting on hover. A manual camera move (zoom / fit / home / focus / cube) is now
  preserved when async meshes finish loading (previously the settle re-frame wiped it).
- **Local Files refresh now updates expanded sub-folders too.** The refresh button
  re-read only the root listing, so files added/removed inside an already-expanded
  sub-folder didn't show up. Refresh now signals every expanded folder to re-read
  its children.
- **Robot View accent text is readable on the parchment theme.** The Robot-View
  panels hard-coded a light gold (`#c8a24a`) for highlight/active text, which
  didn't darken for the skeuomorph (parchment) theme — gold-on-cream was hard to
  read. They now use the theme-aware `var(--accent)` brass token (dark-brass on
  parchment, gold on dark), like the rest of the app. (3-D selection outlines /
  snap handles stay gold — the canvas is always dark.)
- **Files panel now always reopens from the toolbar button / activity icon.** A
  workspace switch (or the Robot pop-out) could leave the panel visually
  collapsed while the store thought it was open, so the next toggle click called
  collapse() and it stayed shut. The toggle now reads the panel's actual state
  and the switch syncs both ways, so it's self-healing.
- **Robot pose/servo panel is now legible in the light skin.** The panel used an
  undefined colour token, so it rendered dark-on-dark in the parchment theme; it
  now uses the theme surface tokens (parchment ⇄ charcoal) like the file panel.

## [0.24.0] - 2026-07-08

### Added
- **Data View — inspect logged CSV/TXT data as a table (epic #272).** Opening a
  `.csv` / `.tsv` file now shows a spreadsheet-like viewer instead of raw text.
  It auto-detects the delimiter (comma / tab / semicolon / whitespace) and header
  row, infers each column's type (number / timestamp / text), and tolerates the
  mess real device logs carry — ragged rows, blank lines and a torn final row
  (board unplugged mid-write) are handled, never fatal — with a "ragged" count
  and null markers for dropped readings. Rendering is **virtualised**, so a
  24-hour log (~86k rows) scrolls smoothly (#274). Click a header to **sort**
  (type-aware; nulls last), open a **filter** row (min–max ranges / text
  contains-equals, composable, with an "N of M rows" count + Clear), and a
  **summary strip** profiles each column and recomputes against the filtered
  set (#275). A **Columns** side panel (DuckDB Column Explorer style) profiles
  every column — histograms + min/max/mean/median for numbers, top values for
  text, and the null/gap % — glance-then-expand, recomputing live (#276).
- **Data Logger instrument — a vintage dot-matrix printer (#242).** Hit
  **RECORD** and every numeric `SNK` reading (meter, plot, distance, IMU,
  environment…) is captured with a timestamp and "printed" onto tractor-feed
  paper: a strip-chart per series plus periodic printed value rows in a dotty
  printhead style. **TEAR OFF** downloads the session as a spreadsheet-ready
  wide CSV (`time_s` + one column per series) and starts a fresh sheet. Works
  fully offline against the Simulated device, so a hardware-free classroom gets
  real data logging — a £4 Pico doing a £100 classroom logger's job.
- **Workspace layouts (epic #259).** A toolbar switcher restyles the whole shell
  in one click; each workspace remembers its own sidebar view, panel sizes,
  collapse states and instrument-dock visibility. Switching never remounts, so
  the editor, console scrollback and running instruments all survive. A **↺
  reset** restores the active workspace to its preset. All layout state moved
  into one versioned, corruption-safe store that migrates your existing layout
  on first run.
- **Open the Oscilloscope / Multimeter any time — with in-instrument help
  (#256).** The scope and meter no longer stay locked out until your program
  declares a PWM/ADC pin: toggle them on and, with no source yet, they show a
  built-in "how to use me" panel (a runnable `inst.watch(scope=pwm)` snippet +
  a Learn-more link), adopting the file's pin or live `SNK` telemetry the moment
  one appears. The **Barometer, IMU and Range** instruments explain themselves
  the same way (#258).
- **Reopen your files on launch, with crash-safe recovery (#266).** Snakie now
  remembers the open local files (and the active tab) and reopens them next
  time, alongside the working folder (#177). A crash-guard protects startup: if
  a file broke the app last launch it opens clean and drops that session so it
  can't loop — no keystroke or admin needed, which matters on a locked-down
  school machine.
- **Seven new Getting Started help articles (#231)** covering Files & sync,
  Flash MicroPython firmware, Install packages (mip), Problems & validation,
  Version control (Git), AI chat & autocomplete, and Keeping Snakie up to date;
  plus **mini-help for every standard-library part** (#213) — all 16 parts now
  ship a `help.md` (pinout + wiring + a runnable MicroPython snippet).
- **Pimoroni Motor 2040 + Servo 2040 in the Standard parts library (#224).**

### Changed
- **Three focused modes: Code · Board · Data Lab (#268).** The four-workspace
  switcher slims to three — *Lab* and *Data* merged into **Data Lab**; existing
  layouts migrate automatically. **Board mode now gives the board every pixel**:
  the parts **library** is an Obsidian-style pinnable overlay, the **connections
  table** collapses to a pinnable bottom bar, the floating **components browser**
  starts collapsed, and redundant chrome (the drag grip, the BOARD VIEW title,
  the New-board / boards-folder buttons, the dock's mini board) is hidden while
  the board is embedded. Part mini-help routes to the main **Help Library** (one
  help surface). The **Board toolbar knob pops the board out** into its own
  window (and closing it returns Board as a mode). Instrument dock defaults per
  mode: **closed** in Board + Code, **open** in Data Lab.
- **The breadboard is now graph paper.** The wiring background scales and pans
  WITH the parts like paper they're placed on: the smallest square is the real
  **2.54 mm** pin pitch (pads land on grid lines), 1-inch major lines anchor the
  view, and a finer grid fades in as you zoom (#297); it fills the whole stage
  and replaces the old static blueprint/schematic grids (#298). **Blueprint is
  the default background** and carries a subtle **procedural paper texture** —
  a fractal-noise mottle (SVG `feTurbulence`, no image) that pans/scales with the
  grid (#300, #301) — and the grid lines pick up that paper fibre so they wobble
  a hair like ink on paper instead of being machine-perfect (#307). The
  schematic view is a clean, grid-free sheet (#302).
- **Board View toolbar: snap-to-grid, a clickable zoom readout, cleaner
  framing (#299).** A **magnet** toggle snaps a dragged part's top-left pin to
  the nearest 2.54 mm intersection (remembered across sessions). The zoom
  percentage is a button toggling 100% / fit-all. Opening the components browser
  no longer jumps the zoom (only picking a component zooms to fit it).
- **Image/PDF/SVG exports match what's on screen and include everything.** They
  bake in the on-screen sheet colour (blueprint blue / schematic sheet), draw
  the grid + paper (and its wobble) to the edges, and always save the
  **zoom-to-fit** view so every placed item is included, uncropped (#302, #303,
  #304, #308).

### Fixed
- **Failures are no longer silently swallowed (#225).** A shared `reportError`
  helper replaces the `.catch(() => {})` sites that made failures invisible — it
  logs with a `[context]` tag and surfaces user-visible actions in the status
  bar, so the board never merely *appears* unresponsive.
- **Device-event broadcast survives a window closing mid-stream (#226).** Every
  send to the main / instrument / console / Board View windows is now guarded, so
  one window closing mid-broadcast can't stop the stream reaching the others.
- **Board-mode Help button opens the Help panel (#271)** — it expands the
  collapsed sidebar first — and the panel's minimum width was doubled.
- **Export no longer crops parts (#305)** — the frame now accounts for each
  translated part group's transform.
- **Session restore survives fast relaunches / dev HMR reloads (#266, #306)** —
  the crash-guard disarms on the next painted frame instead of after 4 s, so a
  quick reload can't strand its marker and wipe the session.

## [0.23.2] - 2026-07-04

### Fixed
- **Part Editor: the label colour picker is no longer squished.** In a text
  label's inspector the colour well + used-colour swatches were crammed into a
  narrow fourth column beside x / y / size, collapsing into a tiny bunched
  strip. The colour picker now sits on its own full-width row (like the board's
  Background colour), so the well and favourite-colour swatches lay out properly.

## [0.23.1] - 2026-07-03

### Fixed
- **In-app bug reports work in packaged builds (#206).** The shared feedback app
  key is now baked into release builds at build time (from a `SNAKIE_FEEDBACK_KEY`
  CI secret) and used as the `X-Snakie-Key` fallback, so installed apps can post
  bug reports without a logged-in session — previously the key was only read from
  a runtime env var, which packaged apps never had, so every report came back
  "not authorised". A runtime `SNAKIE_FEEDBACK_KEY` still overrides the baked key
  for development and self-hosting.

## [0.23.0] - 2026-07-03

### Added
- **Barometer gains a thermometer + humidity dial (#216).** The Barometer
  instrument now stands the aneroid dial beside a skeuomorphic mercury-in-glass
  **thermometer** (−10…50 °C, mounted on a dark backing strip that reads in any
  theme) and tucks a **much smaller hygrometer dial** into the footer — a 270°
  humidity gauge with a blue "DRY" arc and a red "DAMP" arc marking the extremes.
  The simulated device now also streams `SNK ENV` telemetry, so the dial,
  thermometer and hygrometer all animate on the virtual board.
- **Context help for standard MicroPython code.** Right-click → "Help for
  symbol" now covers the language itself, not just hardware modules: keywords
  (`if`/`while`/`def`/`class`/`try`/`import` …), value types (`int`, `str`,
  `list`, `dict`, `bytes` …) and everyday built-ins (`len`, `range`,
  `enumerate` …) open seven new mini-help reference articles — Control flow,
  Functions, Values & types, Built-ins, Classes, Errors & exceptions, and
  Imports & modules.
- **Device files refresh after installs.** Installing a part driver (either
  missing-library banner), the instruments library, or a mip package now
  re-lists the connected board's file tree automatically — the new files in
  `/lib` appear without clicking Refresh, in every window.
- **One-click install from the missing-library banner.** When the editor
  reports the connected board is missing a library your parts need, the banner's
  **Install** button now also covers parts that ship **bundled driver files**
  (SG90 / BME280 / ICM20948 …) — copying them straight onto the device, exactly
  like the instruments-library "Download & install". Previously only mip-URL
  libraries were installable from there. (Also: importing a driver directly no
  longer hides the missing-on-board nag just because a matching instrument looks
  in-use, and the simulated device's `exec` now really runs code, so probes work
  on the sim.)
- **Interactive I²C scanner (#214).** Found addresses in the I²C-detect grid are
  clickable: an inspector names the known devices for that address and offers an
  **ADD** button for any installed library part declaring it (new `i2cAddresses`
  part field; BME280 + ICM20948 declare theirs) — adding the part to the project
  and popping the breadboard.
- **Compass in the IMU instrument (#215).** A rotating 16-wind rose card under a
  fixed lubber line, with a `309° NW`-style readout driven by the magnetometer
  heading (the calibrated yaw).
- **Barometer instrument (#216).** Temperature / pressure / humidity as an
  antique aneroid barometer — brass bezel, 950–1050 hPa scale, RAIN · CHANGE ·
  FAIR legend — fed by `SNK ENV` telemetry; `inst.watch(weather=bme)` binds a
  BME280-style sensor automatically (instruments library 0.9.0).
- **Schematic buses (#217).** I²C/SPI wires in the Schematic view draw as short
  named bus tags (»I2C0«, »SPI1«) at both ends instead of routed noodles.
- **Animated I²C scan (#218).** Scan results play back as a cursor sweep across
  the grid, with a water-ripple "ping" on each found address.
- **Device-files management (#219).** Ctrl/Cmd + Shift multi-selection, drag
  files/folders into folders (a device-side move), a hover ✕ delete on every
  row, and "Delete N items" from the context menu. Deleting a folder now removes
  its contents recursively (previously directories couldn't be deleted at all).
- **Right-click context help (#221).** "Help for symbol (Snakie)" in the editor
  context menu opens the mini help for the word under the cursor — an installed
  part's bundled help (e.g. `bme280`) or a language-reference topic (Pin, PWM,
  I2C, sleep, …).

### Fixed
- **Device-files Refresh refreshes folders (#220).** Refresh re-lists every
  loaded folder — not just the root — keeping your expansion state.

## [0.22.0] - 2026-07-03

### Added
- **Watch an IMU → live 3-D attitude (instruments library 0.8.0).** `inst.watch(
  imu=my_imu)` now recognises a 6-/9-DoF IMU driver (any object with
  `read_accel_gyro` / `read_accel`+`read_gyro`, e.g. the ICM20948 part driver),
  lights up the **IMU** instrument, and `inst.update()` streams its orientation —
  roll/pitch from the accelerometer tilt, yaw from the magnetometer — so the
  attitude view "just works" with no trig in user code, exactly like a watched
  PWM drives the Oscilloscope.

### Fixed
- **Board part edits refresh live in other windows.** Authoring a board in the
  Part Editor (e.g. adding Qwiic I²C pins) now updates the main window's board
  list + the I²C-detect pin dropdowns immediately, instead of needing an app
  reload. `parts:savePart`/`deletePart`/`createLibrary`/`deleteLibrary`/
  `installLibrary` broadcast a `parts:didChange` to the other windows, and
  `useBoards` re-reads on it (and on the same-window parts-changed event).

### Added
- **Breadboard background setting + parchment library panel.** The Board View's
  library dock now uses the same warm **parchment** (`--bg`) as the local Files
  tree, so it reads as a matching sidebar. A new **Settings → Appearance →
  Breadboard background** control switches the wiring canvas between the default
  **Dark** workbench mat and a classic **Blueprint** (blue paper + light grid) —
  streamed live to the open Board View window. The Dark/Blueprint mat applies to
  the **Breadboard** view only; the **Schematic** view keeps a plain sheet that
  follows the skin — a white sheet with dark-on-white symbols in the light theme,
  the dark mat in the dark theme — since a blueprint doesn't suit a schematic.
- **BME280 + ICM20948 I²C sensor parts (Standard library).** Two new Pimoroni
  breakouts join the Standard parts library, each shipping a part footprint
  (I²C header), a bundled pure-MicroPython driver installed to `lib/` on placement,
  and mini-help with a runnable example: **BME280** (temperature / pressure /
  humidity, `from bme280 import BME280`) and **ICM20948** (9-DoF IMU — accel +
  gyro + magnetometer, `from icm20948 import ICM20948`).
- **Help button on a part's breadboard toolbar (#207).** Selecting a placed part
  in the Board View wiring canvas now shows a **?** Help button on its mini-toolbar
  when that part ships bundled mini-help — clicking it opens the Board View help
  drawer scrolled to and expanded on that part's article. Parts with no help don't
  show the button.
- **Drag parts onto the breadboard (#159).** Parts in the Board View's library
  dock are now draggable straight onto the wiring canvas — the canvas frames the
  drop zone while you drag, and the part lands centred under the cursor (with a
  saved canvas position) instead of the default auto-layout slot. Clicking a part
  still previews it; the existing "Add to project" button is unchanged. Dropping a
  part reuses the same placement path, so the driver-install offer + help toast
  still fire.
- **Per-part help: kevsrobots.com guide + open-example (#207).** A part's bundled
  `help.md` can now carry YAML front matter (`kevsrobots:` guide URL, `example:`
  tab name). When its article opens in the Help panel (from the "In This Project"
  section), a **📖 Full guide on kevsrobots.com →** link and an **⧉ Open example in
  editor** button appear above the article — the latter drops the article's first
  Python block into a new editor tab. Authored for the SG90 servo + Potentiometer.
- **Mini-map toggle in Settings (#210).** Settings → Editor now has a **Show the
  editor mini-map** switch (on by default) that shows/hides Monaco's mini-map live.
- **Flash-usage gauge in the device files panel (#211).** A slim used/total bar
  pinned at the bottom of the Device Files panel shows how full the board's flash
  is (`os.statvfs`), turning amber past 75% and red past 90%. Hidden when the board
  can't report it.
- **Potentiometer instrument + part (#212).** A new **Potentiometer** instrument
  reads a pot's wiper (an ADC voltage on the telemetry stream) as **0–100 %** on a
  skeuomorphic **B.S. First Grade** moving-coil ammeter, with a rotary knob
  mirroring the turned position and a % / volts readout. A new **Potentiometer**
  part (VCC · OUT · GND) joins the standard library with mini-help, and a watched
  ADC (`inst.watch(pot=adc)`) lights the meter up automatically.
- **Bind real objects to instruments — `inst.watch()` (prototype).** Register a
  live MicroPython object and the IDE offers the right instrument BY TYPE, via
  duck-typed introspection — no matter whose code created it. `inst.watch(pwm=pwm,
  pot=adc)` emits a `SNK BIND <name> <kind>` descriptor (PWM → Oscilloscope +
  Servo, ADC → Multimeter, I²C → scanner, Pin → LED/Button) and `inst.update()`
  streams each object's state on the existing telemetry, so a watched PWM lights
  up the scope/servo in the dock and drives them live. Control flows back
  (`SNKCMD watch <name> duty|freq|angle|value …`). (Library 0.7.0.)
- **ST7789 SPI TFTs in the Display instrument.** The Display panel now drives
  **SPI ST7789 colour TFTs** alongside the existing I²C SSD1306/LCD. The **SIZE**
  picker gains four ST7789 variants (**240×240**, 240×320, 135×240, 170×320);
  choosing one swaps the wiring to the SPI pins — **SCK · SDA(MOSI) · DC · RST ·
  CS** (RST **and** CS can each be **tied** — e.g. the Pimoroni Pico
  Explorer/Display has no reset GPIO and a hard-wired backlight) — with an RP2040
  SPI-pair invalid-pin warning, a `screen spi …` retarget over the control channel,
  and a bundled on-device `ST7789` driver (`inst.start(screen_sck=…,
  screen_mosi=…, screen_dc=…, screen_rst=…, screen_cs=…)`) that renders
  **band-by-band** (a small reusable strip, so it never needs a ~150 KB full-screen
  framebuffer that fails to allocate on a Pico). Mirror + Push work over both buses;
  a **Run ST7789 demo** fallback (`examples/st7789_demo.py`) wires the panel's pins.
  (Library 0.6.1.)
- **Manual pin-label placement (Part Editor).** Drag a pin's label annotation
  (number box + label + capability chips) to a hand-placed spot — e.g. clear of the
  board outline — to declutter dense boards. It's persisted per pin as `labelOffset`
  in `parts.yml`, reflected in the Board View + Mini Board too, and a **Reset label
  position** button in the pin inspector returns it to the default.
- **Breadboard hover reveals pin capabilities.** In the board view, hovering a
  placed microcontroller now shows **every** pin's capability chips — positioned to
  the pin's left/right/top/bottom like the Part Editor (`SDA`, `SPI1 SCK`, `ADC2`,
  `PWM A`, …) — fading in from the board centre outward, and clearing the pin names.
  Hovering a specific pin dims the other pins' chips to 40% so its own stand out;
  everything disappears when you mouse off the part.
- **Connectors — QWIIC / STEMMA QT / JST (Part Editor).** A new **Connectors**
  layer adds a **QWIIC** / STEMMA QT socket (a 4-pin JST-SH I2C connector,
  prefilled GND · 3V3 · SDA · SCL) or a generic **JST** header. Its contacts are
  **full pins**, so you assign each a **GP##** (+ the I2C bus for SDA/SCL) and the
  usual type/role in the inspector. It's drawn on the board as a JST housing with a
  `QWIIC · SDA GP4 · SCL GP5` label, is draggable, and persists in `parts.yml`
  under `connectors`.
- **Onboard LEDs, RGB & NeoPixels (Part Editor).** A new **Onboard LEDs** layer
  (in the top panel, right above the inspector) lets you add an indicator with
  **＋ LED**, then pick a **type** and assign GPIO(s): **LED** (one GPIO, e.g. the
  Pico's GP25), **RGB** (R/G/B on three GPIOs, e.g. the Tiny 2350's GP18/19/20),
  or **NeoPixel** (a WS2812 on a DATA GPIO + an optional power-enable GPIO, e.g.
  the Seeed XIAO RP2350's GP22 + GP23). Each is drawn on the board as a glowing
  glyph with a `LED · GP25` / `RGB · GP18 GP19 GP20` / `NeoPixel · GP22 · PWR GP23`
  label, is draggable, and persists in `parts.yml` under `onboardLeds`.
- **Pin signal designations, bus numbers + GP## labels (Part Editor).** When a
  pin's capability is ticked, controls let you designate its **signal** — **I2C** →
  SDA/SCL, **SPI** → RX/CSn/SCK/TX, **UART** → TX/RX, **PWM** → the A/B channel —
  and its **bus / channel number** — **I2C**/**SPI**/**UART** bus id and the **ADC**
  channel. The capability chip shows both (e.g. `I2C0 SDA`, `SPI1 SCK`, `ADC2`,
  `PWM A`). The pin's **GP##** GPIO is drawn next to it when the silk label differs
  from the GPIO. Persisted in `parts.yml` under each pin's `signals` / `buses`.
- **Rotate a pin from its mini-toolbar.** Selecting a pin in the Part Editor now
  shows a **Rotate 90°** button in its floating mini-toolbar (next to Duplicate),
  so you can spin a pin — its silk label and, on castellated pads, the outward
  half-hole — without opening the inspector.
- **Pin capabilities show next to the label.** A pin's ticked capabilities now
  appear as persistent colour-coded chips beside its label — in the fixed order
  **PWM, ADC, SPI, I2C, UART**, using the shared capability palette — instead of
  only on hover, so a board's signals are readable at a glance.

### Changed
- **Clearer breadboard wire routing.** A wire between two pins that face away from
  each other (e.g. two 5V pins on opposite sides of their boards) no longer
  U-turns back over itself — it now bows up/over or down/under so it's clear where
  it starts and ends.
- **Pin capability controls stack one row per capability.** The bus + signal
  fields for each ticked capability now sit on their own row (instead of one
  crowded line), so the labels and dropdowns no longer clash.
- **Bigger, sharper castellated pads.** Castellated pads render a touch larger at
  the real ~2.5 × 1.7 mm aspect, with **sharp corners on the board-edge (castellated)
  end** and a rounded inner end.
- **Two themes: Light & Dark.** The default textured skin is now called **Light**
  and the old flat light theme has been removed (any saved "light" preference maps
  to the new Light). The theme picker moved off the toolbar into **Settings →
  Appearance**.
- **Settings moved to the shelf.** The Settings gear left the toolbar for a
  **Settings** item on the activity bar (below Help), styled like the other shelf
  icons; it opens Settings on the new Appearance tab.
- **Part Editor's Pins list is sorted.** It now orders pins by board number
  (numbered pins first, ascending) and falls back to label text (numeric-aware,
  so `GP2` sorts before `GP10`) for pins without a number.
- **Line spacing is always adjustable.** The Settings line-spacing slider is no
  longer disabled when notebook paper is turned off (it's also the editor line
  height).
- **Zero-padded board pin numbers.** Single-digit pin numbers are drawn as `01`,
  `02`, … on the breadboard, Board View and Mini Board View, so pin columns and
  their capability chips line up.

### Fixed
- **Removing a part clears its "your code doesn't import …" nag.** The main
  window's parts-import banner only re-read `robot.yml` on connect / file-open /
  folder change — not when the Board View window added/removed a part. It now
  refreshes on a cross-window robot-changed signal, so removing e.g. the SG90
  drops its import prompt immediately.
- **The board-library UPDATE prompt now actually fires (version was misparsed).**
  `parseLibVersion` matched the first `__version__ = "…"` in the source — which was
  the `"X.Y.Z"` example inside the doc comment above the real assignment. So every
  copy (board + bundled) read as `X.Y.Z`, always "equal" → the "Update library"
  banner never appeared for an out-of-date board. Anchor the match to the start of
  a line so the real `__version__ = "0.7.0"` wins.
- **Out-of-date board library is now detected without the Instrument Dock open.**
  The "Update library" check + banner were gated on the Instrument Dock being on
  screen, so a stale `instruments.py` went unflagged while you edited/ran code with
  the dock closed. The probe now runs as soon as a board connects (it backs any
  `import instruments` program) and the banner shows whenever the board's library
  is missing/outdated, re-offering on each reconnect.
- **A part driven through its instrument no longer nags for its driver.** A placed
  part used via its INSTRUMENT (e.g. `servo_showcase.py` → `inst.start(servo_pin=0)`)
  no longer shows "this file doesn't import servo" / "the board is missing servo" —
  the driver import + file are only needed when you use the driver library.
- **Popped-out console is no longer blank.** When you pop the console into its own
  window it now redraws the existing scrollback instead of starting empty — the
  docked console's output is handed to the detached window and replayed through
  the same telemetry filter (so `SNK` telemetry stays hidden and colours are
  kept) before it follows the live stream.
- **Part Editor's save notice no longer nudges the UI.** The "Saved …" / error
  notification now floats as a toast over the top of the editor instead of
  taking layout space, so the canvas and panels stay put when it appears.
- **Readable pin labels in the Light theme.** The Part Editor's pin label text and
  board numbers now render near-black on its light canvas (they were tuned as
  light-grey for the dark theme). This is scoped to the Part Editor — the Board
  View and Mini Board View are intentionally dark in every theme, so they keep
  their light labels + dark number chips.
- **Readable instrument-dock labels.** The dock's title, the Inputs/Outputs group
  captions and the inactive toggle icons were a very dark grey on the near-black
  dock (low-contrast in both themes); they're now a lighter grey.
- **Readable accent text.** The SAM instrument's "Open demo" link and the
  bug-report "sent" confirmation used a low-contrast brass; they now use the
  editor text / success-green colours so they read in both themes.
- **Bug-report screenshot keeps its aspect ratio.** Enlarging a multi-window
  screenshot no longer squashes it vertically — the preview keeps the true aspect
  (and scrolls if tall), matching the thumbnail.

## [0.21.0] - 2026-07-01

### Added
- **Pop the console out into its own window.** A pop-out button appears at the
  console's top-right on hover and detaches the bottom REPL into its own native,
  resizable OS window — kept live (the device stream is relayed to it) and fully
  interactive. Close the window or click **Redock** to bring it back; the docked
  console keeps its scrollback intact throughout.

### Changed
- **Decluttered console header.** Removed the "Shell" title (frees space on small
  screens; the actions fill the row) and sized the **Clear** button to match the
  Connect/Disconnect control.

## [0.20.3] - 2026-07-01

### Changed
- **Richer bug reports (#206).** A report now captures **every open Snakie
  window** — the main window plus the Board View and any undocked instrument
  windows — composited into one screenshot, and the thumbnail is
  **click-to-enlarge** so you can review it (for anything sensitive) before
  sending. Reports also auto-attach **environment diagnostics** (Snakie version,
  platform/OS, connected board, date & time) and, only if you opt in, the
  **recent console output** — previewable first in a small scrollable dialog.
  The privacy confirmation now covers the console output too.

### Fixed
- **Console terminal no longer overlaps the skeuomorphic screen.** The black
  xterm is clipped to the recessed console screen, so resizing never spills it
  over the bezel or rounded corners.

## [0.20.2] - 2026-07-01

### Changed
- **Bug report screenshot: thumbnail, Snakie-only, and a privacy confirmation
  (#206).** Attaching a screenshot now shows a **thumbnail** with a "Snakie window
  captured" confirmation (plus Retake/Remove), and the copy makes clear it
  captures **only the Snakie window** — never your whole screen or other apps. A
  **required checkbox** now confirms the report (screenshot + pasted text/code)
  contains no personal or sensitive information before it can be sent.

## [0.20.1] - 2026-07-01

### Changed
- **Bug reporter is now a non-modal left panel (#206).** "Report Bug" opens a
  docked left-sidebar view (above Help) instead of a modal, so the editor and
  console/REPL stay fully interactive — you can copy error output or code straight
  into the report while it's open. Reports can now land without a kevsrobots.com
  login: the app sends an `X-Snakie-Key` (`SNAKIE_FEEDBACK_KEY`) for the server's
  anonymous, key-gated `_SNAKIE_` feedback path.

## [0.20.0] - 2026-07-01

### Added
- **Part Editor: author on-board buttons (#130).** Add push-buttons (BOOT/RESET/…)
  with a new "Push-button" tool and a "Buttons" layer panel: place, drag (grid-snap
  + smart-alignment), label and delete them, with full undo/redo. They render as a
  tactile-switch glyph in the Part Editor and the Board Views. This completes the
  #130 Part Editor checklist (buttons were the only remaining item).
- **In-app bug reporting (#206).** A "Report Bug" button in the activity bar (above
  Help) opens a form — title, description, optional email, and an attach-a-screenshot
  button that captures the app window — and submits to kevsrobots.com's feedback API,
  tagged `_SNAKIE_`. It runs in the main process past the CSP and fails gracefully.
  (The endpoint authenticates the reporter, so landing reports needs a provisioned
  `SNAKIE_FEEDBACK_TOKEN` — or an anonymous `_SNAKIE_` path — added server-side.)
- **Part-level update indicator (#155).** When a part's library has a newer
  version available, an update badge now also appears next to the affected parts
  (not just the library header); clicking it updates the library — and so the
  part — to the latest version.
- **Resizable mini board / instrument-deck split.** Drag the handle beneath the
  mini board view to give it more or less room versus the instrument deck below
  (double-click the handle to reset). The split is per-session — it always opens
  at the current default size and isn't persisted.

### Fixed
- **Re-showing an undocked instrument returns it to the dock.** After undocking a
  singleton instrument into its own OS window (#205) — the Plotter or any of the
  panels (gamepad, scanners, LED, buzzer, …) — hiding then re-showing it via its
  dock-header icon brought it back windowed (or made it vanish) because its
  undocked state wasn't reset. Toggling a singleton back on now re-docks it, the
  same way the oscilloscope/multimeter already did.

## [0.19.0] - 2026-06-30

### Added
- **Undocked instruments are true OS windows (#205).** Undocking an instrument now
  opens it in its own native, **resizable** OS window (the Board View / Find
  precedent) instead of an in-app floating overlay — so you can move it to another
  monitor, and the **Plotter** (and the scope/meter) reflow as you resize the
  window. The detached instrument stays live: the device telemetry stream is
  relayed to every instrument window. Closing the window (native ✕ or the in-window
  Dock key) re-docks the instrument. The **Plotter is now undockable** too.
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

[Unreleased]: https://github.com/kevinmcaleer/Snakie/compare/v0.46.0...HEAD
[0.46.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.44.0...v0.46.0
[0.44.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.43.0...v0.44.0
[0.43.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.42.0...v0.43.0
[0.42.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.41.0...v0.42.0
[0.41.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.40.0...v0.41.0
[0.40.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.39.0...v0.40.0
[0.39.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.38.0...v0.39.0
[0.38.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.37.0...v0.38.0
[0.37.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.36.0...v0.37.0
[0.36.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.35.1...v0.36.0
[0.35.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.35.0...v0.35.1
[0.35.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.34.0...v0.35.0
[0.34.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.33.1...v0.34.0
[0.33.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.33.0...v0.33.1
[0.33.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.29.0...v0.30.0
[0.29.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.27.0...v0.28.0
[0.27.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.25.2...v0.26.0
[0.25.2]: https://github.com/kevinmcaleer/Snakie/compare/v0.25.1...v0.25.2
[0.25.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.25.0...v0.25.1
[0.25.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.23.2...v0.24.0
[0.23.2]: https://github.com/kevinmcaleer/Snakie/compare/v0.23.1...v0.23.2
[0.23.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.23.0...v0.23.1
[0.23.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.20.3...v0.21.0
[0.20.3]: https://github.com/kevinmcaleer/Snakie/compare/v0.20.2...v0.20.3
[0.20.2]: https://github.com/kevinmcaleer/Snakie/compare/v0.20.1...v0.20.2
[0.20.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.18.1...v0.19.0
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
