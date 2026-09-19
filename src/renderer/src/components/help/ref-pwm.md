PWM switches a pin on/off fast; the **duty cycle** sets the average level. Use it for LED brightness, motor speed, tones, and servos.

## Basics

```python
from machine import Pin, PWM

led = PWM(Pin(15))
led.freq(1000)            # 1 kHz
led.duty_u16(32768)       # 0..65535 → ~50%
```

`duty_u16(0)` = off, `65535` = full on.

## Fade

```python
for d in range(0, 65536, 1024):
    led.duty_u16(d)
    time.sleep_ms(10)
```

## Servos

Hobby servos want **50 Hz** and a 1–2 ms pulse (0°–180°):

```python
sg = PWM(Pin(16)); sg.freq(50)

def angle(deg):            # 0..180
    us = 500 + deg * 2000 // 180
    sg.duty_ns(us * 1000)

angle(90)                  # centre
```

Call `led.deinit()` to release the pin.

## The blocks

| Block | Python |
| --- | --- |
| `set power of [GP15 ▾] to [50] %` | `pwm_15.duty_u16(int(50 * 65535 / 100))` |
| `set frequency of [GP15 ▾] to [1000] Hz` | `pwm_15.freq(1000)` |
| `power of [GP15 ▾] as [per cent ▾]` | `pwm_15.duty_u16() * 100 / 65535` |
| `turn PWM off on [GP15 ▾]` | `pwm_15.deinit()` |

*Power* rather than *brightness* or *speed*: the block drives a pin, and whether
that dims an LED or slows a motor is up to what you wired to it. The unit is the
duty cycle either way.

Each one has a twin that takes its PWM from a **socket** instead of a pin menu —
drop in the name from a `name PWM on pin [GP5 ▾] as [motor_a]` block, and a
rover's two drive channels are two names rather than two pin numbers.

Setting the power to 0 stops the pulses. **Turning the PWM off releases the
pin**, which is what you want at the end of a program, or before driving the same
pin high and low yourself.
