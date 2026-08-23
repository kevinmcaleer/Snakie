Comparing the same value again and again — `in` says this in one test.

```python
if command == "stop" or command == "halt":     if command in ("stop", "halt"):
    motors.brake()                                 motors.brake()

if code != 200 and code != 204:                if code not in (200, 204):
    raise OSError(code)                            raise OSError(code)
```

The `or` chain makes the reader check that it is the *same* variable in every
clause and that the operator never flips half way along — the two mistakes
this shape actually produces (`command == "stop" or command == "halt" or
"quit"` is always true, and nobody spots it). `in` states the question once:
is this value one of these? Adding another accepted value is then a comma, and
the list can later move out to a named constant without touching the test.

The `!=` / `and` chain is the same smell inverted, and becomes `not in`.
Mixing the two (`x == 1 or x != 2`) is left alone — it is far more likely to
be a bug than a smell, and guessing which half was meant is not our job. So
is a chain whose later candidates do work: `or` never reaches them once an
earlier test passes, but a tuple builds every member before testing anything.
