The **write** panel for an LED output — a digital on/off rocker, a PWM brightness slider, an RGB colour picker, and an 8-pixel NeoPixel strip with rainbow/chase animations.

## What it does
Pick a **MODE** (DIGITAL / PWM / RGB / STRIP) and the control writes an IDE→board line `SNKCMD led <payload>` via `sendControl('led', …)`. The glowing bulb reflects the state optimistically (the board doesn't echo LED state back). Payload grammar: `on` / `off`, `pwm <0..1>`, `rgb <r> <g> <b>`, plus `strip …` / `anim …`.

## How to use it
Wire an LED to a GPIO (digital), a PWM pin (dimming), or three PWMs (RGB). On the board, drive an `Led` and route the `led` commands to it.

```python
from instruments import Led
from machine import Pin, PWM

led = Led(pwm=PWM(Pin(15)))
led.pwm(0.5)      # 50% brightness
# led.set(True)   # digital on/off
# led.rgb(255,0,0)
```

- Sends are fire-and-forget — a disconnected board just no-ops, the UI still updates.
