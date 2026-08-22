This loop sleeps, and the whole board sleeps with it — poll the clock instead.

```python
# before                        # after
while True:                     last_tick = time.ticks_ms()
    read_line()                 while True:
    drive_motors()                  if time.ticks_diff(time.ticks_ms(), last_tick) >= 100:
    time.sleep(0.1)                     last_tick = time.ticks_ms()
                                        read_line()
                                        drive_motors()
```

`time.sleep()` does not pause *this loop*, it pauses **the whole board**. For
those 100 ms nothing else can happen: the bumper switch is not read, the UART
command sits unanswered, the second motor never gets its ramp step. That is
why a first robot can follow a line beautifully and still drive straight into
a wall — the wall was detected during the sleep, and by the time the code
looked, it was too late.

Checking the clock instead of blocking on it is the pattern every non-trivial
MicroPython program ends up using. The loop keeps spinning; the timed work
runs only when its period is up. The real payoff arrives on the *next* thing
you add: a second sensor on a 20 ms period, a heartbeat on 500 ms, a command
parser that must answer straight away. Each one is another `if` in the same
loop, and they interleave instead of taking turns to freeze each other. That
is cooperative multitasking by hand, and it is what `asyncio` (rule 39) does
for you once the program grows big enough to want it.

**Why the loop must already have at least two other statements.** Converting
a loop that does nothing *but* sleep makes it strictly worse. `while True:
time.sleep(1)` costs almost no CPU — the interpreter is parked. Turn it into a
tick check and it spins flat out, burning current and starving anything else
on the board, for no benefit at all: there is no other work in the loop to
interleave with. That is exactly the busy-wait rule 84 warns about, so this
rule refuses to create one. Two other statements is the floor at which the
loop plausibly has something worth freeing up.

The same honesty applies to the rewrite itself: the loop it produces is still
a spin loop until you put more work in it. It is the enabling step, not the
finished article — hence `severity: 'hint'` and `a judgement call`, so
"Tidy this file" never does this behind your back. One further difference
worth knowing: the original ran its body first and slept afterwards, whereas
the rewrite waits one period before the first pass. For a periodic task that
is immaterial; if it is not, seed the timestamp with
`ticks_add(ticks_ms(), -PERIOD)` instead.

What it declines, and why:

- **`break`, `continue`, `return` or `yield` in the body.** The body moves
  inside a new `if`, and a `continue` that used to skip the sleep would now
  skip nothing. Changing what a jump means is exactly the kind of silent
  behaviour change forbids.
- **A loop inside an `async def`.** Rule 39 owns that case, and
  `await asyncio.sleep()` is the better answer there.
- **`sleep_us`.** A sub-millisecond period is not a fit for a tick check —
  `ticks_ms()` cannot see it, and `ticks_us()` polling is a busy-wait by
  definition.
- **A delay that is not a whole number of milliseconds**, or is not a literal
  at all. We would be inventing a period.
- **A trailing comment on the sleep line.** That line is deleted, and the
  comment explaining it would go with it.
- **A module prefix we cannot resolve to the real `ticks_ms`/`ticks_diff`.**
  Snakie makes no change rather than calling a function it cannot prove exists.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
