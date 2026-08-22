Quadrature decoded in software drops counts at speed — PIO decodes it in hardware.

board-specific).

```python
# before — decoded in Python            # after — decoded in the PIO block
def on_edge(pin):                       sm = rp2.StateMachine(
    global state, count                     0, quadrature, in_base=Pin(2)
    a = enc_a.value()                   )
    b = enc_b.value()                   sm.active(1)
    state = ((state << 2) | (a << 1) | b) & 0xF
    count += TRANSITIONS[state]         count = sm.get()

enc_a.irq(handler=on_edge)
```

## Why it matters

At speed you *will* miss counts, and the failure is silent.

A polling loop reads the two channels, then goes away and does something else
— reads a sensor, prints a line, waits on a servo. While it is away the
encoder can move through two transitions, and two transitions in opposite
directions look exactly like no movement at all. An interrupt handler is
better but not immune: a small gearmotor at full tilt produces edges faster
than MicroPython can enter a Python-level handler, and when the next edge
arrives before the last one has been serviced it is simply dropped. Nothing
raises. Nothing logs. The count is just quietly a bit low.

What you see is a robot that drives 1 m and thinks it drove 0.94 m, and drifts
a little more every time — and because the error scales with speed, it looks
like a mechanical problem. People re-measure the wheels, re-tune the PID and
re-solder the encoder before suspecting the software, because the software
"works" at the speeds they test it at.

A PIO state machine decodes quadrature in hardware. It watches both channels
on every one of its own clock cycles, keeps the count in a scratch register
and hands it over through the FIFO when you ask — no CPU involvement, no
interrupt latency, and no transition fast enough to slip past it. The RP2040
and RP2350 have eight and twelve of these; two of them cover a differential
drive and you get your main loop back as well.

Hint only: the replacement is a PIO program plus a `StateMachine` per wheel,
which is a design decision about pins and clock rates, not a rewrite of the
handler you already have.

Deliberately narrow. Two pin reads and a counter also describes a pair of
independent button counters, which PIO would not improve. This fires only when
the two channels are *combined* — shifted together, compared with each other,
or used as one index into a transition table — because combining them is what
makes it quadrature decoding rather than two unrelated inputs.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
