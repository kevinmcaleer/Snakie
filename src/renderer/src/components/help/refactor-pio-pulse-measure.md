Timing a pulse from Python measures the interpreter as well as the echo.

board-specific).

```python
# before — timed by the interpreter        # after — timed by the PIO block
while echo.value() == 0:                   sm = rp2.StateMachine(
    start = time.ticks_us()                    0, echo_timer, freq=1_000_000,
while echo.value() == 1:                       in_base=echo
    pass                                   )
end = time.ticks_us()                      sm.active(1)
cm = time.ticks_diff(end, start) / 58      cm = sm.get() / 58
```

## Why it matters

The noisy readings everyone blames on the sensor are usually
Python's timing jitter, not the sensor at all.

An HC-SR04 answers by holding a pin high for as long as the sound took to come
back, and you convert that time to a distance by dividing by 58 µs per
centimetre. So every microsecond of error in your measurement is about a fifth
of a millimetre — and *every* microsecond counts, in both directions. Between
your two `ticks_us()` calls the interpreter may service an interrupt, run
another thread, or start a garbage collection, and a gc pass on a busy heap is
easily hundreds of microseconds. That is centimetres. It arrives at random, on
one reading in twenty, which is precisely the pattern that makes people add a
median filter, take five readings and average them, or buy a different sensor.

None of those fix the cause. The pulse was always the right length; the clock
watching it was not.

A PIO state machine counts the pulse in its own hardware at a clock you choose
and pushes the number into the FIFO. Nothing the CPU does can perturb it, so
consecutive readings of a stationary wall differ by a count or two instead of
by centimetres — and your main loop is free while it measures, rather than
spinning in a `while` doing nothing.

`machine.time_pulse_us()` is worth knowing about as a middle step: it is the
same measurement written in C, so the interpreter's per-statement jitter goes
away and it is a large improvement over a hand-rolled spin loop for one line
of change. It still blocks the CPU for the whole pulse, and it can still be
interrupted, so Snakie mentions it more gently than it mentions the spin
loop.

Hint only: moving to PIO changes where the number comes from and when it is
ready, which is the author's call.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
