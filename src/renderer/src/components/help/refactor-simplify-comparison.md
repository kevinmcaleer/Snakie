Comparing with `True`, `False` or `None` — say it directly.

```python
if ready == True:            if ready:
    arm()                        arm()

if sensor.fault != True:     if not sensor.fault:
    go()                         go()

if bus == None:              if bus is None:
    return -1                    return -1
```

Two different smells wearing the same shirt. Comparing a flag with `True` or
`False` is the beginner tell that a value is already the condition — the
comparison adds a word and takes one away, and `flag == True` quietly means
something *different* from `flag` for anything that isn't a bool, which is a
bug waiting for the day a driver returns `1` instead of `True`.

`== None` is worse than noisy: `None` is a singleton, so identity is the
question, and a class that defines `__eq__` can make `x == None` say True for
an object that is emphatically not `None`. PEP 8 makes `is None` the rule, and
this one is the correct idiom **everywhere**, so — unlike the `True`/`False`
rewrites — it is not restricted to conditions.

The `True`/`False` rewrites only fire where the value is used as a condition
(an `if`/`while` test, a comprehension guard, an operand of `and`/`or`/`not`).
`ok = flag == True` stores a bool where `ok = flag` stores the flag, so
outside a condition the rule declines.
