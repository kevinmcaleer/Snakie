PIO state machines are a small fixed resource, and this file is using most of them.

board-specific).

```python
# before — six, and counting              # after — one program, four pixels
lights = rp2.StateMachine(0, ws2812, …)   lights = rp2.StateMachine(0, ws2812, …)
left = rp2.StateMachine(1, quad, …)       left = rp2.StateMachine(1, quad, …)
right = rp2.StateMachine(2, quad, …)      right = rp2.StateMachine(2, quad, …)
servo_a = rp2.StateMachine(3, pulse, …)   servos = rp2.StateMachine(3, pulse4, …)
servo_b = rp2.StateMachine(4, pulse, …)
servo_c = rp2.StateMachine(5, pulse, …)   # one program, four pins, one FIFO
```

## Why it matters

PIO state machines are a fixed, small, countable resource, and
the day you run out is the day the robot stops working with a `ValueError`
from a line that has been fine for weeks.

The RP2040 has **eight**: two PIO blocks with four state machines each. The
RP2350 has **twelve**, in three blocks of four. That is the headline number,
and it is not the one that usually bites.

The one that bites is instruction memory. Each PIO block has room for **32
instructions in total, shared by all four of its state machines**. Two copies
of the same program are loaded once and shared, but four *different* programs
averaging nine instructions each will not fit in one block no matter how many
state machines are free — and the failure arrives as "PIO instruction memory
is full" when you add the last one. So you can run out of program space with
half your state machines idle.

Both limits point at the same fix, which is why this fires at **five** rather
than at the hard ceiling: while there is still room, restructure. One program
driving four servo pins beats four programs driving one each; two wheels
sharing one quadrature program cost one program's worth of instruction memory,
not two; and anything running at kilohertz rather than megahertz — a servo
refresh, a status LED — very often does not need PIO at all when a `Timer` or
a `PWM` channel will do.

Hint only: which peripheral to fold together is a judgement about your robot.
The rule counts, names the board's real budget, and leaves the design to you.

Careful about `StateMachine`: plenty of robot code has a hand-written
`class StateMachine` for behaviour, and telling someone their behaviour tree
has exhausted the PIO block would be nonsense. This counts a construction only
when the name provably comes from `rp2`.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
