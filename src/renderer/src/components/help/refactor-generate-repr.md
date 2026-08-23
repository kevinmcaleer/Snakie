This class has no `__repr__`, so printing one shows only a memory address.

```python
class Waypoint:                  class Waypoint:
    def __init__(self, x, y):        def __init__(self, x, y):
        self.x = x                       self.x = x
        self.y = y                       self.y = y
                             →
                                     def __repr__(self):
                                         return f"Waypoint(x={self.x!r}, y={self.y!r})"
```

Without one, `print(waypoint)` over the REPL prints
`<Waypoint object at 20003f10>` — an address that tells a beginner nothing and
changes every reset. Debugging a robot mostly happens through that serial
console, so a class that can describe itself is worth more here than on a
desktop where a debugger is a keystroke away.

The generated line uses `!r` so a string attribute keeps its quotes and an
empty one is visible at all. MicroPython compiles an f-string down to the
`str.format` call it is equivalent to, and its `format` implements the `!r`
conversion, so this runs on the board exactly as it does on the desktop.

Only attributes assigned **directly** in `__init__` are listed, and only when
the value assigned is a pure expression — a parameter, a literal, another
attribute, arithmetic over those. `self.pwm = PWM(Pin(16))` is skipped: the
interesting part of a hardware handle is not its `repr`, and a class whose
`__init__` only wires up peripherals gets no offer at all. Dunder-prefixed
names (`self.__secret`) are skipped too, since name mangling means
`self.__secret` inside the class is really `self._Class__secret`.

Declines when the class already has a `__repr__` (nothing to add), when
nothing qualifies, or when the generated line would run past 100 characters —
a `__repr__` you have to scroll sideways to read is not an improvement, and
choosing which attributes to drop is a judgement call the rule will not make
on the user's behalf.
