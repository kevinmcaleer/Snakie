This code can never run — the statement above always jumps away.

```python
# before — the motor never stops, whatever the last line says
def drive(motor, speed):
    motor.duty(speed)
    return speed
    motor.stop()

# after
def drive(motor, speed):
    motor.duty(speed)
    return speed
```

Anything after a `return`, `raise`, `break` or `continue` in the same block
can never run. This is `warning`, not `hint`: it is almost never a style
choice, it is a line someone believed was doing something. The motor that was
supposed to stop, the pin that was supposed to be pulled low — the code reads
as if it happens, and the hardware says otherwise. Deleting it makes the file
say what it does, and puts the missing stop somewhere it will actually run.

The rule declines rather than guesses in five cases:

- a `def` or `class` in the dead span — the *name* may still be imported from
  another module, and deleting a definition is not a local decision;
- a `yield` in the dead span — `return` followed by `yield` is the standard
  empty-generator idiom, and removing the `yield` turns the generator into an
  ordinary function;
- a `global`/`nonlocal` declaration — those bind at compile time for the whole
  function, reachable or not, so deleting one changes what the *live* code
  above it assigns to;
- an assignment whose name the live code reads but never binds — for the same
  compile-time reason. `print(counter)` above a dead `counter = 1` raises
  `UnboundLocalError` today and would quietly start printing the global if we
  deleted the dead line, which is a behaviour change even though the old
  behaviour was a bug (see `bindsALocalTheLiveCodeReads`);
- a comment anywhere in the span — someone wrote it on purpose, and deciding
  it can go is their call, not ours.

## Before you apply it

- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
