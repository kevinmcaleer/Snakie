This loop hand-rolls a waveform the hardware could hold for free.

```python
# before — a servo pulse train, hand-rolled
while True:
    servo.value(1)
    time.sleep_us(1500)
    servo.value(0)
    time.sleep_us(18500)
```

## Why it matters

This loop has one job — hold a pin high for a precise time,
then low for a precise time — and it is the *worst* possible way to do it,
because the CPU has to be present for every microsecond of it. Three
consequences follow, and all of them bite:

- **The timing is only as good as your loop.** A garbage collection, an
  interrupt, or anything else the board decides to do lands in the middle of
  your pulse and stretches it. On a servo that is a visible twitch; on a
  stepper it is a missed step.
- **The CPU can do nothing else.** The whole point of a robot's main loop is
  to read sensors and decide things, and this loop is asleep for 20 ms out of
  every 20 ms.
- **It does not scale.** Two servos this way is twice the problem, and four is
  not possible at all.

Both fixes are hardware doing the work instead:

- **`PWM`** is the right answer for a plain repeating square wave, which is
  what a hobby servo wants. Set the frequency to 50 Hz and the duty to the
  pulse width, and the peripheral holds it forever with no CPU at all.
- **PIO** is the answer when the waveform is not a plain square wave — a
  stepper ramp, a one-shot pulse of an exact length, an unusual protocol
  frame. A state machine clocks it deterministically, and you can run several
  independently.

Snakie only points, because which of the two you want depends on the shape of
the waveform, and getting that wrong is worse than leaving the loop alone.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
