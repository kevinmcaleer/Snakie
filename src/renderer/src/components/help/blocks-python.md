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
