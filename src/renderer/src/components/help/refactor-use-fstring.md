An f-string puts each value where it is printed, so the order cannot drift.

```python
print("{} at {}".format(name, angle))     print(f"{name} at {angle}")
uart.write("speed %s\n" % motor.speed)  →  uart.write(f"speed {motor.speed}\n")
```

The value moves to the place it is printed, so there is no counting brackets
against arguments and no way to get them out of order. On MicroPython an
f-string is compiled to the same `str.format` call the first line already
made, so this costs nothing at runtime — it is purely about the person
reading it six months later.

**The MicroPython quoting caveat.** MicroPython's parser predates PEP 701
(Python 3.12), so a replacement field may not contain the quote character
that delimits the f-string: `f"{d["key"]}"` is a syntax error on the board
even though CPython 3.12 accepts it. That is why every substituted argument
here must be a bare name or a dotted attribute — `sensor.raw` is fine,
`readings["left"]` is not — and why the rule additionally refuses any
argument whose source text contains the literal's own quote character. A
refactoring that only compiles on the desktop is worse than none at all.

Declined, too, for: a prefixed or triple-quoted literal (`b""`, `r""`,
`"""…"""`); implicit concatenation of adjacent literals; a literal already
containing `{` or `}`, which would have to be doubled; anything but bare
`{}` placeholders, so `{0}`, `{name}` and `{:>4}` are all left alone; and a
mismatch between the number of placeholders and the number of arguments.

**`%d` is deliberately not converted.** `"%d" % x` truncates a float — `3.7`
prints as `3` — while `f"{x}"` prints `3.7` and `f"{x:d}"` raises. Neither is
a faithful translation of what the board is doing today, and a tidy-up that
silently changes the numbers in a telemetry line (or starts throwing) is not
a tidy-up. The scanner still *recognises* `%d`, so it can tell a placeholder
it will not touch from a stray `%`, and then declines the whole match.
