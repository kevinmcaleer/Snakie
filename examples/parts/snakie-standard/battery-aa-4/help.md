# 4×AA Battery Pack

Four AA cells wired in series — a simple, untethered **~6 V** supply for motors,
servos and anything that needs more punch (or more current) than a USB port or a
board's 3V3 pin can give.

## Power at a glance

| | |
|---|---|
| **Voltage** | ~6 V (4 × 1.5 V alkaline; ~4.8 V with 1.2 V NiMH rechargeables) |
| **Current** | ~1–2 A in short bursts — plenty for a couple of servos |
| **Capacity** | ~2000–2500 mAh (alkaline) |
| **Terminals** | **V+** (red, positive) and **GND** (black, negative) |

## Wiring

Power flows **out of V+**, through your circuit, and **back into GND** — the pack
only delivers current when that loop is complete.

- **V+** → the device's power pin (a servo/motor `+`, or a board's **VSYS**).
- **GND** → the device's ground, **shared with everything** (including the board's
  GND) so they have a common reference.

⚠️ **6 V is not 5 V, and it's not 3.3 V.** It's fine for most hobby servos and
motors, but **don't feed it into a logic pin** — put a regulator (or the board's
on-board one) between the pack and anything running at 3.3 V. And never wire
**V+ straight to GND**: that's a dead short.

## On a Raspberry Pi Pico

Wire **V+ → VSYS** and **GND → GND**. VSYS feeds the Pico's on-board regulator,
which makes the 3V3 rail for the chip. VSYS takes 1.8–5.5 V, so a *fresh* 6 V pack
sits a touch high — okay in practice, but a part-used pack is safest. Don't use
**VBUS** (that's the 5 V USB line).

## How long will it last?

Roughly: **capacity ÷ current draw**. Two idle servos (~0.1 A total) off a 2400 mAh
pack is about a day of on-time — but a *stalled* servo can pull 10× that, so size
for the worst case, not the idle one.
