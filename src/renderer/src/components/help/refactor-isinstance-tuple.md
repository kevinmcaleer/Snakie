`isinstance` accepts a tuple of types — these `or`s can be one call.

```python
if isinstance(reading, int) or isinstance(reading, float):
    return reading * SCALE

# becomes
if isinstance(reading, (int, float)):
    return reading * SCALE
```

`isinstance` already takes a *tuple* of types and means "any of these", so the
chained `or` is spelling out by hand something the builtin does in one call.
The tuple form reads as the question actually being asked — "is this one of
the number types?" — puts the subject on screen once instead of once per
branch, and evaluates it once instead of N times. Adding a third accepted type
then becomes a one-word edit rather than another `or isinstance(…)` clause,
which is exactly where the copy-paste version grows a typo.

The rewrite only fires when every operand asks about the *same* subject, in
identical source text, and that subject is pure — combining the calls collapses
N evaluations into one, so anything that could touch hardware is left alone.
The same goes for the types after the first: `or` short-circuits past them,
a tuple does not, so only side-effect-free ones may be folded in.
