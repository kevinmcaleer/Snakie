The `if` branch always leaves, so this `else` only adds indentation.

When the `if` branch always leaves — `return`, `raise`, `break`, `continue` —
the `else` is decoration. Nothing after the `if` can run when the test was
true, so the else body may simply follow it:

```python
def battery_state(mv):          def battery_state(mv):
    if mv < 3300:                   if mv < 3300:
        return "flat"                   return "flat"
    else:                           log("still going")
        log("still going")          return "ok"
        return "ok"
```

The win is the same one guard clauses buy: the branch that keeps going stops
being indented for a condition it has already passed. It is also the shape
that lets a long `if/elif/else` ladder unroll into a flat sequence of checks.

Two things make this unsafe and are refused. An `elif` after the `if` is a
chain, not an else — unrolling it is a different rewrite. And when the `if`
being flattened is itself an `elif`, every earlier branch of the chain must
leave too, or code that used to be skipped would start running; the rule walks
the chain and proves that before offering.
