# Bits & bitwise maths

A number in a computer is a row of **bits** — 1s and 0s. Most of the time you
can ignore that. On a microcontroller you cannot, because a chip talks in bits:
one byte coming back from a sensor often carries eight separate yes/no answers,
and one byte going out often has to be built from several pieces.

The Maths drawer has the blocks for it.

## Reading part of a byte — a status register

A BME280 sensor answers "am I busy?" in a single bit of its status register.
The rest of the byte is other things you do not care about, so you **mask** it:
keep the bits you want and throw the others away.

```python
status = i2c.readfrom_mem(0x76, 0xF3, 1)[0]
measuring = status & 0b00001000
if measuring:
    print("still taking a reading")
```

`&` is *bits and*: a bit survives only if it is 1 in **both** numbers. Every
other bit meets a 0 in the mask and becomes 0.

Build it from **`%1 bits and %2`** with a **binary** block on the right.

## Writing a byte — one bit per thing

Going the other way, *bits or* (`|`) puts bits together, and *shifted left*
moves a bit into the position you want:

```python
command = (1 << 7) | (mode << 4) | channel
```

`1 shifted left by 7` is the number with only bit 7 set. This is how a pin
number becomes a mask, and how a driver packs three settings into one byte.

## Hex and binary

Datasheets write addresses and registers in **hex** — `0x3C` for a common OLED
display, `0x76` for that BME280 — because two hex digits are exactly one byte.
The **hex** block keeps what you typed, so `0x3C` in the block is `0x3C` in
your program, not `60`.

The **binary** block is for when you want to *see* the bits: `0b00001000` says
"bit 3" far more plainly than `8` does.

## The rest of the drawer

- **not the bits of `x`** — `~x`, every 1 becomes a 0 and back again.
- **`x` shifted right by `n`** — `x >> n`, slide the bits down. Shifting right
  by 1 halves a whole number.
- **bit `n` of `x`** — one bit on its own, as a 1 or a 0. Bit 1 is the
  rightmost, counting the same way the Lists drawer does.
- **`//`** on the arithmetic block — divide and throw the remainder away.
  `7 // 2` is `3`. It is how you count whole things: how many complete rows,
  how many whole seconds.

## bits and is not and

The Logic drawer's **and** asks a question about two answers: *is this true
**and** is that true?* **bits and** does arithmetic on two numbers, one bit at
a time, and hands back a number. They are different jobs and Python writes them
differently — `and` and `&` — which is why they live in different drawers here.
