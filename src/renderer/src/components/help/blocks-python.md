When the block you need doesn't exist yet, you write the line yourself — and the
**Python** blocks at the bottom of the toolbox are how.

They are grey on purpose. Everything above them says what it does in words;
these say it in code, which is what the rest of your program is made of anyway.
Reaching for one is the first bit of Python you will write on your own.

## The two plain ones

| Block | What it is |
| --- | --- |
| **statement** | one line of Python, dropped into your program exactly as you type it |
| **value** | a piece of Python that works out a value, to plug into any socket |

```python
oled.fill(0)          # a statement block
sensor.temperature()  # a value block, plugged into `say [ ]`
```

Click into one and you get a real code editor, with the same autocomplete the
main editor has: type `machine.` and the list appears.

You can also just type in the **Python pane** beside the canvas — it is an
editor, not a read-only copy, and what you write there turns back into blocks.

**One line per block.** That is not a limit, it is the shape: each block owns one
line, so hovering it lights up that line in the Python beside you, and an error
on that line badges that block. Code that needs indenting goes *inside* a
**repeat**, **forever** or **if** block — the same way Python indents it.

If you paste several lines at once, you get one block per line. Nothing is lost.

## Imports

```python
import machine
import instruments as inst
from machine import Pin
```

Three blocks, one for each form. They generate nothing where they sit — the
import line appears at the **top** of your program, where Python wants it, and
Snakie merges it with the imports the other blocks already needed. Hover the
block and watch the line light up.

## Calling anything

`call [method] on (object) with (…)` works on any object at all, including a
driver Snakie has never heard of. Press **+** for another argument, **−** for one
fewer. There is a matching **value** version for a method that gives something
back:

```python
motor.set_speed(120)              # call [set_speed] on (motor) with (120)
distance = tof.range()            # [range] of (tof)
```

And the attribute blocks read or change something that is not a method call:

```python
print(sensor.value)               # [value] of (sensor)
led.brightness = 0.5              # set (led) . [brightness] to (0.5)
```

## Decorators — the `@…` line above a `def`

A decorator is a label on a function. It is not a step that runs on its own, so
it is not a block on its own either: it rides on the **function block**, and the
lines come out immediately above the `def`.

| On the block | In the Python |
| --- | --- |
| a **function** block carrying `micropython.native` | `@micropython.native` above its `def` |
| a **method** block carrying `property` | `@property` above its `def` |

```python
@micropython.native
def count_up():          # compiled, not interpreted — faster, bigger
    total = 0
    for _ in range(200000):
        total = total + 1
    return total


class Thermometer:
    @property
    def celsius(self):   # read as `t.celsius`, with no brackets
        return 27 - (self.volts() - 0.706) / 0.001721
```

A function can carry more than one, and they are written in the order they were
put on. Entries are stored without the `@` — `property`,
`micropython.native`, `app.route("/")` — and the ones that need an import
(`micropython.native`, `micropython.viper`) bring `import micropython` with them
to the top of the file, the same as any other block.

`@micropython.native` is the one worth trying first when something is too slow:
it asks MicroPython to compile that function to machine code instead of reading
it back a bytecode at a time. It costs flash, so time the function before and
after rather than decorating everything.

*A gear on the function block for adding and removing these arrives in a
following release.*

## Snakie checks what you type

Not to be fussy — because a missing bracket is much easier to fix when the block
tells you than when the board does, halfway through a program:

> **This round bracket ( is never closed.**

You will also be told when a line ends in `:` (it needs an indented block under
it — use a Control block), and when a statement has been plugged into a socket
that wants a value.

It is a check, not a judge. Anything it does not recognise, it lets through:
these blocks exist so that nothing is ever impossible, and a checker that refused
code which would have worked would put the wall back.
