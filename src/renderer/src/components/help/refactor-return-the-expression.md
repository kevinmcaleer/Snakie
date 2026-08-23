This `if`/`else` returns `True`/`False` — return the condition itself.

```python
def is_charged(mv):            def is_charged(mv):
    if mv >= FULL_MV:              return mv >= FULL_MV
        return True
    else:
        return False
```

Five lines to say "if the answer is yes, return yes". The comparison is
already a `bool`, so handing it straight back says the same thing with a lot
less to read — and it is the shape that makes the next step obvious, whether
that is naming the condition or reusing it in a guard clause.

The branches the other way round — `return False` then `return True` — become
`return` of the *inverted* condition, written the way a person would write it
(`>` becomes `<=`, `is` becomes `is not`) rather than as a bolted-on `not`.

The rule fires ONLY when the condition is already boolean-valued: a
comparison, a `not`, or `and`/`or` over those. `if motor: return True` is not
the same as `return motor` — the first hands back `True`, the second hands
back the motor object, and a caller that prints the result or compares it
with `is True` would see the difference. That is a behaviour change, so we
decline it.
