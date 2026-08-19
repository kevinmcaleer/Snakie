# Grove Red LED

A 5 mm red LED on a Grove **digital** port. Drive the `SIG` contact high to light
it — there's nothing to talk to and no driver to install, so it's the quickest
way to get something visible out of a fresh board.

## The trimmer is the first thing to check

`R2` is an on-board potentiometer in series with the LED, and it ships part-way
round. If the LED looks dim, or stays dark on a 3.3 V board while it works fine
on 5 V, **turn R2 before you doubt the code** — it's setting the current, and at
one end of its travel there isn't enough left to light anything.

That trimmer is also what lets the module take a wide range of supply voltages
without you soldering a different resistor each time.

## The LED is in a holder, not soldered

It plugs into a two-pin holder, so you can pull the red one out and drop in any
5 mm LED you like — the module is sold as red, green, blue, white and purple and
they are otherwise the same board. The **long leg is the anode** and goes in the
hole nearest the `+` on the silk. In backwards, it simply never lights.

## Wiring

| Grove contact | Colour | Board pin |
|---------------|--------|-----------|
| SIG | yellow | any GPIO |
| NC | white | — (not connected) |
| VCC | red | 3V3 or 5V |
| GND | black | GND |

## MicroPython

On and off — `machine.Pin` is built in, so there's nothing to install:

```python
from machine import Pin
from time import sleep

led = Pin(16, Pin.OUT)

while True:
    led.toggle()
    sleep(0.5)
```

Because `SIG` is just a GPIO, PWM gives you brightness in software as well as at
the trimmer:

```python
from machine import Pin, PWM
from time import sleep_ms

led = PWM(Pin(16))
led.freq(1000)

while True:                       # breathe
    for duty in list(range(0, 65535, 1024)) + list(range(65535, 0, -1024)):
        led.duty_u16(duty)
        sleep_ms(8)
```

The trimmer sets the *ceiling*; the duty cycle scales what's underneath it. Wind
R2 up to full first if a fade looks like it stops short of bright.

## Links

- [Product page](https://www.seeedstudio.com/Grove-Red-LED.html) (SKU 104030005)
- [Seeed wiki](https://wiki.seeedstudio.com/Grove-Red_LED/)
