# Make it faster with @micropython.native

Here is a function that counts to two hundred thousand, and a clock either side
of it to find out how long that took.

Press **Run**. The first number is what it counted to; the second is the
milliseconds it spent doing it. Write that second number down.

## The line above the def

Look at the Python pane, just above `def count_up():`

```python
@micropython.native
def count_up():
    count = 0
    for _ in range(200000):
        count = count + 1
    return count
```

That `@…` line is a **decorator**. It is not a separate instruction that runs
before the function — it belongs to the function under it, the way a label
belongs to the jar it is stuck on. It says something *about* `count_up`.

What this one says is: *don't interpret this function, compile it*. MicroPython
normally reads your function back one bytecode at a time, every time round the
loop. `@micropython.native` asks it to turn the function into real machine code
for the chip instead, once, when the file is loaded.

The function does exactly the same thing. It just stops being read aloud.

## Try it without

Click into the Python pane and delete the `@micropython.native` line. Press
**Run** again and compare the two numbers.

On a Pico, counting like this is normally somewhere around two to four times
faster with the decorator than without.

To get the decorated version back, open this lesson again from **Learn** — it
hands you the starting program each time.

## What it costs

Nothing is free. A native function is **bigger** — it is machine code now, and
machine code takes more flash than bytecode. On a board with a lot of functions,
decorating all of them can run you out of room.

So it is a tool for the one function that is actually slow: the loop reading a
sensor thousands of times a second, the routine drawing to a display. Time it
first, the way you just did. Decorate the part that the clock says is slow.

There is a stricter sibling, `@micropython.viper`, which is faster again but
only lets you use a small, machine-shaped subset of Python — integers, not
objects. It is worth knowing it exists. It is not worth reaching for until
`native` has not been enough.

## Decorators you will meet elsewhere

The same line, other labels:

| Decorator | What it says about the function |
| --- | --- |
| `@micropython.native` | compile me instead of interpreting me |
| `@property` | I am a method, but read me like a plain value |
| `@staticmethod` | I live in this class but I don't need a `self` |

`@property` is the one you will see most often in other people's drivers. It is
why a BME280's temperature is `sensor.temperature` and not
`sensor.temperature()`.

## Where they live in Snakie

A decorator is attached to the **function block itself**, not dropped in beside
it — because a block of its own could be dragged away from the function it was
labelling, and a label that can fall off the jar is worse than no label. So it
is saved with the block, and the `@…` lines are written immediately above the
`def` every time the Python is generated, in the order you put them.

The way you *add* one on the canvas — a small gear on the function block, with
the common ones offered by name — arrives in a release shortly after this one.
This lesson's function came with its decorator already on.
