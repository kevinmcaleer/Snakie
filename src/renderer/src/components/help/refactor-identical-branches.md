Both branches run exactly the same code — the test decides nothing.

```python
# before
def pick_gear(load, gearbox):
    if load > 0.75:
        gearbox.select("low")
        gearbox.engage()
    else:
        gearbox.select("low")
        gearbox.engage()

# after
def pick_gear(load, gearbox):
    gearbox.select("low")
    gearbox.engage()
```

Both branches do the same thing, so the test decides nothing. This is
`warning` rather than `hint` because it is nearly always the fossil of a
copy-paste: the `else` was meant to say `"high"` and never got edited. Seeing
the two branches side by side as one block is what makes that obvious — and
if the collapse looks wrong, the branch that was supposed to differ has just
been found.

The rule declines rather than guesses when:

- the condition is not pure — dropping `if sensor.read() > 100:` would skip a
  hardware read, and a rewrite that quietly stops talking to a device is
  exactly the kind of "fix" that costs the feature its trust;
- the `if` is part of an `elif` chain, in either direction — collapsing a
  branch out of the middle of a chain is a different (and much fiddlier)
  rewrite;
- a comment sits in the replaced range but outside the kept block, so
  collapsing would delete it. Comments *inside* the two blocks are safe:
  the blocks are byte-identical, so every comment that goes has an identical
  twin that stays;
- the block contains a multi-line string, whose contents would change when
  the block is dedented.

## Before you apply it

- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
