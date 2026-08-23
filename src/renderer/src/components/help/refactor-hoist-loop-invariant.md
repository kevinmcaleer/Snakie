This value never changes inside the loop — work it out once, before it.

```python
for angle in sweep:                span = MAX - MIN
    span = MAX - MIN               for angle in sweep:
    servo.write(angle)                 servo.write(angle)
    log(angle / span)                  log(angle / span)
```

The assignment does not depend on anything the loop changes, so it computes
the same value on every pass. On a microcontroller that is not a stylistic
point: a thousand-iteration loop that recomputes a constant is a thousand
needless divisions, and on a Pico each one is time the next sensor read does
not get. Moving it above the loop makes the loop body say only what actually
varies, which is also easier to read.

**Why this one is offered but never batched.** Hoisting changes how many
times the expression is evaluated — once instead of once per pass. For a
calculation over names and literals that is invisible, and that is the only
case rewritten automatically. The interesting case is the *impure* one:

```python
while running:
    limit = sensor.read_u16()   # is this meant to be re-read every pass?
```

Hoisting that is the bigger win and the bigger risk — it may be a deliberate
re-read of live hardware, or it may be an accident nobody noticed. Only a
human knows which, so the rule declines rather than guessing
(`isPureExpression` gates it), and it is deliberately kept out of
"Tidy this file".

Two further refusals worth knowing about: a fresh `[]`/`{}`/`set()` per pass
is almost never invariant in intent — hoisting it makes every pass share one
mutable object — and if the variable is read *after* the loop, hoisting also
decides whether it is bound at all when the loop body never runs.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
