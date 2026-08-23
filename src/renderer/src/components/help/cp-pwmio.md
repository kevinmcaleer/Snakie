PWM switches a pin on and off very fast. The ratio (the **duty cycle**) dims an
LED, sets a motor's speed, or positions a servo.

## Dimming an LED

```python
import board
import pwmio
import time

led = pwmio.PWMOut(board.D13, frequency=1000)

while True:
    for duty in range(0, 65536, 1024):
        led.duty_cycle = duty
        time.sleep(0.01)
```

`duty_cycle` is a **16-bit attribute you assign** — 0 is off, 65535 is fully on,
32768 is half. There is no `duty_u16()` method here.

## Changing the frequency later

A PWM pin's frequency is fixed unless you say otherwise when you create it:

```python
buzzer = pwmio.PWMOut(board.D5, frequency=440, variable_frequency=True)
buzzer.duty_cycle = 32768        # a square wave is loudest at 50 %
buzzer.frequency = 880           # only allowed because of the flag above
```

Without `variable_frequency=True`, assigning `frequency` raises
`AttributeError`.

## Servos

Don't drive a servo with raw duty cycles — the `adafruit_motor` library from the
bundle does the pulse-width maths:

```python
import board
import pwmio
from adafruit_motor import servo

pwm = pwmio.PWMOut(board.D5, frequency=50)
arm = servo.Servo(pwm)

arm.angle = 90
```

Copy `adafruit_motor/` into `/lib` first — see "Install libraries".

## Notes

- PWM channels are a finite hardware resource; some pins share a timer and can't
  have independent frequencies. `deinit()` a PWM you've finished with.
- Frequency matters: ~1 kHz for LEDs, 50 Hz for hobby servos, the note's pitch
  for a buzzer.
