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
