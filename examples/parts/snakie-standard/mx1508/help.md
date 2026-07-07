# MX1508 Dual H-Bridge Motor Driver

A tiny, cheap dual H-bridge that drives **two DC motors** forwards and backwards.
Great for little robots — each motor gets two input pins, and PWM on those pins
sets the speed.

## Wiring

| Pin | Connect to |
|-----|------------|
| VCC | motor supply **+** (2–10 V, e.g. 4×AA or VBUS 5 V) |
| GND | supply **−** and board GND (**shared**) |
| IN1 / IN2 | two GPIOs (Motor A direction/speed) |
| IN3 / IN4 | two GPIOs (Motor B direction/speed) |
| OUT1 / OUT2 | Motor A terminals |
| OUT3 / OUT4 | Motor B terminals |

⚠️ **VCC is the motor supply, not logic power** — don't feed it from the Pico's
3V3 pin; motors will brown the board out. Power it from batteries or 5 V and
tie the grounds together. The 3.3 V GPIO inputs are fine as-is.

## Quick start

```python
from machine import Pin, PWM
import time

FREQ = 1000
in1 = PWM(Pin(0), freq=FREQ)   # Motor A
in2 = PWM(Pin(1), freq=FREQ)
in3 = PWM(Pin(4), freq=FREQ)   # Motor B
in4 = PWM(Pin(5), freq=FREQ)

def motor(a, b, speed):        # speed −100 … +100
    duty = int(abs(speed) * 65535 / 100)
    a.duty_u16(duty if speed >= 0 else 0)
    b.duty_u16(0 if speed >= 0 else duty)

motor(in1, in2, 75)            # Motor A forwards at 75 %
motor(in3, in4, -75)           # Motor B backwards
time.sleep(2)
motor(in1, in2, 0)             # stop both
motor(in3, in4, 0)
```

Drive **one input high, the other low** for direction; PWM the high one for
speed. Both low = coast, both high = brake.

⚠️ If a motor spins the wrong way, just swap its two OUT wires.
