This value never changes — `const()` lets the compiler inline it.

```python
# before                        # after
LEFT_MOTOR_PIN = 16             from micropython import const
PWM_FREQ = 1000
                                LEFT_MOTOR_PIN = const(16)
                                PWM_FREQ = const(1000)
```

Why it matters, and why no desktop Python linter will tell you: on CPython a module
constant is just a global, and a linter has no reason to care. On MicroPython
`const()` is understood by the *compiler*. `NAME = const(16)` folds the value
into the bytecode at every use site, so the name lookup — a dictionary probe
in the module's globals, on every single loop iteration — disappears
completely. Name it `_LEADING_UNDERSCORE` and the global entry disappears from
RAM too. On a Pico with 264 KB, a control loop that reads eight pin numbers
per pass, that is real money in both time and space.

The rewrite only fires on a module-level `NAME = <integer literal>` whose name
is never bound again anywhere in the file — because a `const` the code later
reassigns is the one way this optimisation bites: every *read* was already
folded to the old value at compile time, so the reassignment would silently do
nothing. Floats are excluded too: `const()` is an integer facility.
