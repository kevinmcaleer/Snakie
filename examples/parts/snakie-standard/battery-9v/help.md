# 9V Battery (PP3)

The rectangular block with the snap terminals — properly a **PP3** or **6LR61**.
Nine volts from one cell-sized package, which makes it the obvious choice for a
small project and, more often than not, the wrong one.

## What it is good for

Anything that needs a **regulator in front of it** and draws modest current: a
9 V input into a 5 V or 3.3 V regulator, powering a microcontroller and a couple
of sensors. It is compact, it is everywhere, and 9 V gives a linear regulator
comfortable headroom.

## What it is bad for — motors

A PP3 is a stack of six tiny cells, so it has a **high internal resistance**
(roughly 1.7 Ω fresh, and it climbs as the battery ages) and only about
**550 mAh**. Draw half an amp and the terminal voltage sags by nearly a volt
before it reaches your circuit; draw more and it collapses, browning out the
microcontroller mid-instruction.

That sag is why a robot on a PP3 resets every time its motors start. If you are
driving motors or servos, use **AA cells or a LiPo** — both are modelled in this
library, and both hold their voltage under load in a way this cannot.

Snakie models the internal resistance rather than rounding it away, so the
Electronics workspace shows the sag rather than pretending 9 V arrives intact.

## Terminals

| Pin | What |
|---|---|
| V+ | +9 V — the **smaller** stud on the battery, the socket on the clip |
| GND | 0 V — the **larger** stud, the stud on the clip |

The asymmetric snaps mean a standard clip can only go on one way round, which is
the one genuinely good piece of design in the format.

**Do not short the terminals.** They sit a few millimetres apart on the same
face, and a PP3 will happily push enough current through a dropped screwdriver or
a pocketful of keys to get hot. Snap the cap on, or tape the terminals, when it
is out of the project.

## Rough numbers

| | |
|---|---|
| Nominal | 9 V (alkaline; a fresh one reads ~9.5 V) |
| Flat at | ~6 V — below that a 5 V regulator drops out |
| Capacity | ~550 mAh alkaline, less under heavy load |
| Internal resistance | ~1.7 Ω fresh, rising with age |
| Size | 26.5 × 17.5 × 48.5 mm |
| Mass | ~45 g |

Rechargeable NiMH PP3s exist, but they are **8.4 V** nominal and typically only
150–300 mAh — worse on both counts unless you are cycling them daily.
