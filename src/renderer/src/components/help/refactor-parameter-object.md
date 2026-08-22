```python
# before — the call site is a row of anonymous numbers
def configure_drive(left_pin, right_pin, freq, min_duty, max_duty, deadband):
    ...

configure_drive(14, 15, 50, 1638, 8192, 40)

# after — one thing, with names on its parts
class DriveConfig:
    __slots__ = ("left_pin", "right_pin", "freq", "min_duty", "max_duty", "deadband")

    def __init__(self, left_pin, right_pin, freq, min_duty, max_duty, deadband):
        self.left_pin = left_pin
        ...

def configure_drive(config):
    ...
```

A long parameter list is a memory test. `configure_drive(14, 15, 50, 1638,
8192, 40)` cannot be read without opening the `def`, and swapping two of those
numbers is a bug the interpreter will never catch — it just drives wrong.
Parameters that always travel together are usually one idea that has not been
given a name yet, and naming it shortens every call and every future signature
change.

**The MicroPython answer is not a dataclass.** Every desktop-Python article
ends this refactoring with `@dataclass`, and that advice does not survive the
trip to a board: `dataclasses` is not in the firmware, it is a micropython-lib
package you have to install onto the device, and importing it costs RAM you
were probably short of already. What fits here is a small plain class with
`__slots__` — the slots are the point, since they replace the per-instance
dict with a fixed set of fields and save the bytes that made the class look
expensive in the first place — or, when the group really is just a handful of
values, a plain tuple unpacked at the top of the function. That gap between
the desktop advice and what actually runs on the board is exactly the kind of
thing this catalogue exists to teach.

This one is **hint only**. *Which* parameters belong together, what the object
is called, and whether it is a config, a pose or a pin bundle are design
decisions about this program, and picking one silently would rewrite every
call site on a guess. Snakie makes no change — the panel shows the explanation
and the "Why?" article, never a diff.

The threshold is five parameters, and what counts
is exactly what the epic's example makes unreadable: **the values the caller
has to type, in order, with no name attached.** So the count leaves out

- `*args` / `**kwargs`, one idea each however many values they carry, and the
  `/` and `*` separators, which are punctuation rather than parameters;
- anything after `*` or `*args`, because a keyword-only argument arrives at
  the call site already labelled — `publish(t, p, qos=1, retain=True)` is the
  opposite of the row of anonymous numbers Snakie is about;
- anything with a default, because the caller can simply leave it out. A
  driver whose `__init__` ends in six optional tuning knobs is called
  `SSD1306(i2c)`, and telling its author to bundle the knobs into an object
  would be answering a question nobody asked;
- the implicit receiver of a method — `self`, `cls`, or whatever the author
  happened to call it — which is bound by the call rather than written at it.

That receiver is found **by position, not by name**: the first parameter of a
`def` sitting directly in a `class` body, unless the method is a
`@staticmethod` and therefore has no receiver at all. `self` is a convention,
not a keyword, and a name test gets it wrong in both directions — it drops a
real parameter from a module-level `def draw(self, …)` and it keeps the
receiver of `def reach(s, …)`, which then gets underlined as something to
bundle into an object.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
