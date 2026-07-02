A CRT-style oscilloscope that traces a PWM channel as a live square wave.

## What it shows
Draws the waveform for one PWM pin from its frequency and duty. With a live board it animates the real duty/frequency and shows **FREQ / DUTY / PERIOD**; raw `SNK SCOPE` samples switch it to a sampled trace with **LAST / MIN / MAX**. Use the source selector to pick another PWM pin, and RUN/STOP to hold the trace.

## How to use it
Opens per PWM pin from the board view. On the board, `import instruments as inst` and call `read_pwm()` on your `machine.PWM` in a loop — it prints `SNK PWM <ch> <freq> <duty>` passively, so it never interrupts a running program.

## Snippet
```python
from machine import Pin, PWM
import instruments as inst

pwm = PWM(Pin(0)); pwm.freq(1000)
pwm.duty_u16(32768)
while True:
    inst.read_pwm(pwm, ch="pwm")
```
