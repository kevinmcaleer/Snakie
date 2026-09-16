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

The **Blocks · Split · Python** control above the canvas changes which side is
big. It does not convert anything; it is a pair of curtains.

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

## Graduating to Python

This is what the whole thing is for.

**Graduate to Python** turns the blocks file into an ordinary `.py`. It is
one-way — going back would mean turning Python into blocks, which Snakie does not
do — so it is made *safe* instead of reversible: **the blocks are saved beside
the file** as `name.blocks.py`, which opens on the canvas exactly as before.

The moment is celebrated rather than warned about:

> **You wrote 47 lines of Python.**

That is true, and they can scroll up and check it. There is nothing to undo and
nothing to be careful about, so the dialog does not pretend otherwise.

Typing in the read-only Python pane asks the same question, which is the point:
a learner reaching for the keyboard on that side has just told you they are
ready.

### When to do it

There is no right lesson number. Some children ask in week one; some are happy
for a term. Two signs worth watching for:

- they start predicting the Python before looking at it;
- they get annoyed that a block cannot do something they can describe.

The last lesson of the **Blocks to Python** course is built for this moment.

---

## The course

**Learn ▸ Blocks to Python** is six lessons:

1. **Make a light blink** — forever, toggle, wait
2. **Read a button** — if, and why pull-up resistors mean `not`
3. **Play a tune** — repeat, frequency and duration
4. **Draw a square** — the turtle, and 360 ÷ the number of sides
5. **Read a sensor** — value blocks, and watching a number move
6. **The same program, in Python** — the handover

Each lesson opens with its program already assembled, because a beginner's first
minute should be something that works and which they then take apart. The last
one opens Python-first with the blocks peeking beside it.

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

**Can they go back to blocks after graduating?** Not that file — but the blocks
were saved beside it, so nothing is lost and they can keep both.

**What if a file has blocks from a newer Snakie?** It refuses to open on the
canvas rather than opening a version of it with pieces missing, and offers to
show you the Python instead. This is deliberate: an editor that silently drops
what it does not understand will eventually save that over someone's work.

**What about screen readers and keyboard-only use?** Blockly's keyboard
navigation and screen-reader support are built in. Every block's right-click
**Help** opens an article inside Snakie rather than a web page, so it works
offline and behind a school firewall.
