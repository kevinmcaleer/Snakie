Writing to a file inside the loop commits to flash on every iteration.

```python
# before                              # after (by hand)
log = open("wind.csv", "a")           log = open("wind.csv", "a")
for n in range(samples):              rows = []
    log.write("%d\n" % read())        for n in range(samples):
    log.flush()                           rows.append("%d\n" % read())
    sleep_ms(100)                         if len(rows) == 200:
                                              log.write("".join(rows))
                                              rows.clear()
```

## Why it matters

On a microcontroller "the filesystem" is the flash the
firmware itself is stored in, and flash cannot be changed a byte at a time. A
write turns into *erase a whole block, rewrite a whole block* — tens of
milliseconds during which the rest of your loop is simply not running. A
datalogger that writes one line per sample spends most of its life waiting for
flash, and a loop that was supposed to sample at 100 Hz quietly drops to 20.

The second cost is permanent. Flash cells survive a finite number of erase
cycles — on the order of 100,000 — and every per-sample write ages the same
block again. A logger left running for a weekend can genuinely wear a board
out, and the failure looks like random corruption long before it looks like
wear.

`flush()` inside the loop is the sharper version of the same mistake: it
defeats the buffering the runtime was already doing for you and forces the
erase-rewrite cycle on *every single iteration*.

The fix is to collect a few hundred samples in a list or a `bytearray` and
write them in one call. That is a real change in behaviour — pull the power
mid-batch and the unwritten samples are gone — so it is a trade the author has
to make deliberately. So Snakie only points: it flags the write, explains
what it costs, and changes nothing.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
