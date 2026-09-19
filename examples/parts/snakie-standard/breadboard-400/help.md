---
kevsrobots: https://www.kevsrobots.com/learn/
---
# Breadboard (400 point)

A half-size solderless breadboard: push component legs and jumper wires into
the holes and the metal clips underneath join them — no soldering. In Snakie the
tie points are **wired internally exactly like the real thing**, so a wire
dragged to `a5` reaches anything else in `b5`–`e5`.

## How the holes connect

| Region | What's joined |
|--------|---------------|
| **Terminal strips** (columns `a`–`e`) | The 5 holes of one **row** are one net (`a1 b1 c1 d1 e1`). |
| **Terminal strips** (columns `f`–`j`) | Likewise, `f1`–`j1` — but **not** joined to `a`–`e`; the centre channel splits the row. |
| **Power rails** (`+` / `−` down each side) | Every hole in a rail column is one net for the **whole length** of the board. |

Rows never connect to the row above or below, and the left and right rails are
**not** joined to each other — bridge them with a jumper if you need power on
both sides.

## Wiring

| Breadboard | Board pin |
|-----------|-----------|
| `+` rail | **3V3** (or **VBUS/5 V** for 5 V parts) |
| `−` rail | **GND** |
| a row (`a`–`e` / `f`–`j`) | one signal or one component leg |

The channel is a **DIP-width** gap (7.62 mm): a chip straddles it with one row
of legs in `e` and the other in `f`, so every leg gets its own 4 spare holes.

## Tips

- **One net per row.** Two component legs in the same 5-hole group are shorted
  together. Put a resistor across rows, not along one.
- **Keep the rails consistent** — red `+`, blue `−` — and don't feed 5 V into a
  rail that 3.3 V parts are hanging off.
- Solid-core **22 AWG** jumper wire fits best; stranded wire frays the clips.
- Some full-size boards **split** their rails in the middle; this half-size
  board's rails run the full 30 rows.

## Specs

- 400 tie points: 300 terminal (30 rows × 10) + 100 rail (4 × 25)
- 2.54 mm (0.1") pitch · 82 × 55 × 8.5 mm · self-adhesive back
- Accepts 20–29 AWG wire and component leads
