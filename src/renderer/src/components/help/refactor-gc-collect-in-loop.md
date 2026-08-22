Collecting every iteration pays for a full heap scan every iteration.

```python
# before                              # after
for step in range(steps):             for step in range(steps):
    hip.duty_u16(1500 + step * 20)        hip.duty_u16(1500 + step * 20)
    gc.collect()                          time.sleep_ms(20)
    time.sleep_ms(20)
```

## Why it matters

`gc.collect()` is not a hint. It is a full mark-and-sweep of
the entire heap, right now, before the next line runs. On a Pico that is
single-digit milliseconds every time you call it — and calling it *inside* the
loop means paying it on **every single iteration**, whether there was anything
to collect or not.

This line almost always arrives the same way: something raised
`MemoryError`, the internet said "call `gc.collect()`", it went into the loop
because that is where the error appeared, and the crash went away. What
actually happened is that a memory problem was traded for a speed problem. The
loop now runs at a fraction of its old rate, misses encoder edges, jitters the
servo timing — and none of that looks like the "fix" that caused it.

Collect where a pause costs nothing: in the idle path between jobs, once
before a timing-critical section starts, or on a `Timer` that fires when the
robot is stationary. Not in the loop whose timing you care about.

**When Snakie stays quiet.** If the loop body genuinely allocates on every
pass — it builds a list or a dict, formats an f-string, appends to something —
then the collect may well be deliberate, holding a fragmenting heap together
while the real fix waits. That author knows something the file does not say
out loud, so the rule leaves them alone entirely and does not even raise the
hint. (Rules 57, 58, 85 and 36 are the ones that go after the allocation
itself, which is the better fix in every case.)

Gated on a board being connected at all: it is advice about the collector on
the chip in front of you, and Snakie says nothing about a board it cannot see.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
