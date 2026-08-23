This `else:` holds nothing but an `if` — `elif` says it in one line.

```python
if level > 80:            if level > 80:
    return GREEN              return GREEN
else:                     elif level > 40:
    if level > 40:            return AMBER
        return AMBER      else:
    else:                     return OFF
        return OFF
```

`else:` followed by nothing but an indented `if` is Python's own `elif`
written the long way. Every extra level of it pushes the real work another
indent to the right, and a chain of three or four — the shape a beginner
reaches for when mapping a battery level or a joystick position onto a
handful of cases — ends up half a screen wide. Collapsing them lines the
branches up as the peers they are.

The rewrite is a single ranged edit: the `else:` line and the inner `if`
keyword become one `elif`, and the inner statement's remaining lines lose one
indent unit. Comments inside the branch travel with it and are dedented
alongside the code; a comment stranded *between* the `else:` and the `if` has
nowhere to go once those two lines merge, so we decline instead.
