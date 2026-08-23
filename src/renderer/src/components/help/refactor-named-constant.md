This literal is repeated — a name at the top of the file makes it one fact.

```python
# before                              # after
from machine import ADC, PWM, Pin     from machine import ADC, PWM, Pin

left = PWM(Pin(14), freq=1000)        PWM_FREQ = 1000
right = PWM(Pin(15), freq=1000)       READING_MAX = 42000

def on_line(sensor):                  left = PWM(Pin(14), freq=PWM_FREQ)
    return sensor.read_u16() > 42000  right = PWM(Pin(15), freq=PWM_FREQ)
```

## Why it matters

The second time a number appears it stops being a number and
starts being a *decision* — this is the PWM frequency, this is where the line
sensor says "black". Written out twice, nothing links the two, so the day the
frequency changes one of them gets missed and the robot pulls to one side for
reasons no one can see. A name at the top of the file makes the pair one fact,
puts the tuning knobs where a beginner can find them, and (on MicroPython)
hands rule 34 something it can wrap in `const()`.

The hard part is not finding the repeats, it is **naming them**, and a bad
name is worse than the literal it replaces — `MAGIC_1 = 42000` teaches nothing
and now has to be maintained. So the rule only ever offers a name it can
*derive* from what the code already says:

| what the occurrences have in common | the name |
|---|---|
| a string whose text is a plain word | `"cruise"` → `CRUISE` |
| the same keyword argument | `PWM(…, freq=1000)` → `PWM_FREQ` |
| assigned to the same name each time | `self.cruise_duty = …` → `CRUISE_DUTY` |
| compared against the same name | `reading > 42000` → `READING_MAX` |
| the same parameter of a function in this file | `set_duty(m, 48000)` → `SET_DUTY_DUTY` |

When none of those fit, the rule says nothing at all. That is the point: a
literal we cannot name is a literal the *author* has to name.

Literals that are already fine as they are get skipped outright — `0`, `1`,
`-1`, `2` and `100`; a float that only ever appears in one statement; anything
inside `range(…)`, where the number is the shape of the loop rather than a
setting; anything already living in a `const(…)` or an `ALL_CAPS = …`, which
is both the "someone has named this" case and what makes the rule idempotent
on its own output; empty and single-character strings; docstrings; and strings
that are mostly dict keys, which read perfectly well as literals.
