# Blocks in Snakie — a guide for teachers

Snakie has a **Blocks** workspace: drag-and-drop programming, the way Scratch
works, for a real Raspberry Pi Pico.

The difference — and the reason it exists — is the pane next door. As a child
snaps blocks together, Snakie writes the MicroPython beside them, line by line,
and that Python is the program. Not a preview, not an export: the actual file
that runs.

This page is about how to use that in a lesson. It assumes no programming.

---

## The short version

1. Open Snakie, press **Blocks**.
2. Press **Draw a square**.
3. Press **Run**.

That works on any laptop or Chromebook with no hardware plugged in, because
Snakie has a MicroPython simulator built in. A classroom with no Picos can do
every blocks lesson in the course.

---

## What's on the screen

| | |
| --- | --- |
| **Left** | the canvas — the blocks, and the toolbox they come from |
| **Right** | the Python those blocks wrote, updating as they drag |
| **Bottom** | the console — what the program prints, and any errors |
| **Far right** | the instruments — the turtle's drawing, a plotter, a multimeter |

**The divider between them is the control.** Drag it all the way one way for
blocks only, all the way the other for code only — and there is a **white dot**
beneath it, halfway along, marking the stop where you get both.

### The two panes are the lesson

It is worth saying out loud to a class at least once: *the thing on the right is
what the thing on the left means*. Children who are told to look at it do. The
single most useful instruction in a blocks lesson is **"change that number and
watch what happens on the right"**.

**Hover a block** and the lines it wrote light up in the Python. **Click a line**
and its block is selected on the canvas. Right-click a block and choose
**Show me the Python** to see just that block's lines on their own.

---

## The toolbox

| Category | What's in it |
| --- | --- |
| **Turtle** | a pen that draws on screen — needs no hardware |
| **Hardware** | LEDs, buttons, PWM, servos, buzzers, analogue readings |
| **Instruments** | send readings to Snakie's oscilloscope, plotter, multimeter… |
| **My parts** | blocks for the parts on *your* breadboard — one drawer each |
| **Wait** | the two pause blocks, in a category of their own |
| **Control** | forever, repeat, if, for each, break |
| **Logic · Maths · Text · Lists** | the everyday building blocks |
| **Variables · Functions** | naming things, and naming groups of steps |
| **Plugins** | blocks a Python plugin added (desktop only) |
| **Python** | grey blocks holding code you type yourself |

**Turtle comes first** deliberately. It is the only category that needs nothing
plugged in, and drawing a square is a better first ten minutes than wiring an
LED.

### Pins are dropdowns, not numbers

A hardware block's pin is a menu of the pins *your board actually has*, filtered
to the ones that can do that job — so the analogue-reading block only offers
pins that can measure a voltage. This heads off the commonest silent failure in
a first electronics lesson.

If two blocks are set to the same pin, both get a **warning badge**. It is a
warning, not an error: sharing a pin is sometimes exactly right, and the app
cannot tell. The badge means *look at this*, which is all anyone knows.

### The toolbox follows your breadboard

Wire a part up in **Electronics** and its blocks are waiting for you in
**Blocks**, in a drawer with its name on it — with the pins it is actually
joined to already filled in. Nothing to install, nothing to configure; unwire it
and the drawer goes away again.

Where the part's maker wrote blocks for it, those are what you get: a BME280
offers *temperature*, *pressure* and *humidity*. Where nobody did, Snakie works
three out from the driver the part declares — the sensor itself, a way to give
it a command, and a way to read a value from it. Those ones carry the name of
the driver's class in a box you can edit, because Snakie is guessing it from the
module name and would rather guess where you can see it. The part's help page
has the real name.

Dragging a part's block out also offers to install that part's driver onto the
board, if it isn't there yet — the same one-click install the Electronics view
offers, at the moment you are actually about to need it.

*For makers and teachers:* adding blocks to a part means dropping a `blocks.yml`
into its folder, and a plugin can contribute blocks too. See
[writing-plugins.md](writing-plugins.md#ship-blocks-with-your-plugin-1017).

### Types, and the name a function is allowed to change

Two blocks in **Variables** are there for the two places a first program usually
turns grey.

**turn (…) into [a whole number (int) ▾]** is casting: `int('10')` is the number
ten, `str(count)` is text you can join onto a message, `float(reading)` keeps the
decimals. The dropdown names the Python — `int`, `float`, `str`, `bool`, plus
list and tuple — because *as a whole number* on its own sounds like rounding, and
it isn't: `int(3.7)` is 3, while the Maths drawer's **round** gives 4.

**use the whole program's (score)** writes `global score`. It is the answer to
the commonest puzzle in a first program with functions in it: a function sets
`score`, and outside the function nothing changed. Python made a new name the
moment the function wrote to it; this line says *no, I mean that one*. Drop it in
at the top of the function, pick the variable, and assignment inside the function
changes the real thing.

### When the block you need doesn't exist yet

At the bottom of the toolbox is a category called **Python**, and the blocks in
it are grey because they *are* code: one line of Python, written into the program
exactly as it is typed.

| Block | What it does |
| --- | --- |
| **statement** | one line of Python, in the stack |
| **value** | a piece of Python that works out a value, in a socket |
| **import** | makes a module available — the line appears at the *top* |
| **call** | `call [method] on (object) with (…)`, for any driver at all |
| **attribute** | reads or changes something on an object |

Click into one and a real code editor opens, with the same autocomplete the main
editor has. Type `machine.` and the list appears.

This is the part that means **nothing is ever impossible** in the Blocks
workspace. A sensor nobody has written blocks for, a module off a web page, a
line from a tutorial — all of it works, today, without waiting for anyone.

**One line per block**, and code that needs indenting goes *inside* a Control
block — the same way Python indents it. Paste several lines at once and you get
one block per line.

Snakie checks what is typed and puts a sentence on the block when something is
wrong (*"This round bracket ( is never closed."*). It is advice, not a veto: the
code is generated either way, because these blocks exist so that nothing is ever
refused.

*Lesson 6 of the course is built around this.*

---

## Running a program

**Run** is the same Run as everywhere else in Snakie. With no board connected it
starts the simulator; with a Pico plugged in it uses the Pico. There is no
separate "run blocks" button because it is not a separate thing.

### When something goes wrong

The console shows the real error, exactly as the board reports it — nothing is
hidden, because that text is what they are learning to read. **And the block that
caused it gets a badge**, with a plain-English sentence on it:

> **Something was divided by zero.**
>
> ZeroDivisionError: divide by zero

Press **Stop** to clear it.

If the error says a library is missing, Snakie offers a one-click install at the
top of the window. A child cannot be expected to diagnose `ImportError`.

---

## Moving to Python

There is no button for this, and that is deliberate. A button saying *you have
learned enough now* cannot know that, and a child can press it in their first
minute.

Instead, **both panes are editable**. The blocks write the Python; typing in the
Python rewrites the blocks. They are two views of one program, so a learner
drifts from dragging to typing at whatever pace they drift, and nothing marks
the crossing.

What that means in a lesson:

- a child who wants to change a number can change it in whichever pane they are
  looking at;
- a child who wants to write a line no block does can just write it;
- nobody has to decide anything, or be told they are ready.

Drag the divider towards the code as they lean that way. Most classes end up
leaving it near the middle for a long time.

### What happens underneath

The `.py` file is the program. The blocks are remembered in a comment at the
bottom so they reopen where they were left — but if that comment goes stale, or
is missing entirely, Snakie works the blocks out from the code. Nothing is lost
either way, which is why none of this needs a warning.

### Signs it is happening

- they start predicting the Python before looking at it;
- they get annoyed that a block cannot do something they can describe;
- they stop dragging the divider back.

---

## The course

**Learn ▸ Blocks to Python** is seven lessons:

1. **Make a light blink** — forever, toggle, wait
2. **Read a button** — if, and why pull-up resistors mean `not`
3. **Play a tune** — repeat, frequency and duration
4. **Draw a square** — the turtle, and 360 ÷ the number of sides
5. **Read a sensor** — value blocks, and watching a number move
6. **When the block you need doesn't exist yet** — the grey blocks, and a dice
7. **The same program, in Python** — typing in the other pane

Each lesson opens with its program already assembled, because a beginner's first
minute should be something that works and which they then take apart. The last
one opens with the divider at the code end and the blocks a sliver away.

---

## Saving and sharing

**A blocks program is an ordinary `.py` file.** The blocks live in a comment at
the bottom, which Python ignores, so the file:

- runs on a Pico copied straight onto it;
- survives email, USB sticks, Google Drive and copy-paste;
- can be committed to git and diffed;
- opens in any text editor.

One file, no project folder, nothing proprietary. This matters more in a
classroom than it sounds: no export step, and a child's program still works on
the machine at home.

---

## Common questions

**Do I need Picos?** No. Everything except physically wiring things up runs in
the simulator, on any machine that runs Snakie, including Chromebooks through the
browser at `app.snakie.org`.

**Is the Python real, or simplified for children?** Real. It is the same code a
Snakie tutorial would teach them to type, with the same imports and the same
library. That is the entire design.

**Can they go back to blocks after typing in the code?** Yes, always. The blocks
follow the code — that is what makes the two panes two views rather than a source
and a copy. Snakie can also work blocks out from a `.py` it never wrote, so a
file from a lesson sheet or a web page opens in blocks like any other.

**What if a file has blocks from a newer Snakie?** It refuses to open on the
canvas rather than opening a version of it with pieces missing, and offers to
show you the Python instead. This is deliberate: an editor that silently drops
what it does not understand will eventually save that over someone's work.

**What about screen readers and keyboard-only use?** Blockly's keyboard
navigation and screen-reader support are built in. Every block's right-click
**Help** opens an article inside Snakie rather than a web page, so it works
offline and behind a school firewall.
