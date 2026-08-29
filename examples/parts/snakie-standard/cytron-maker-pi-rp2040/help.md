# Cytron Maker Pi RP2040

An RP2040 board built for robots: two DC motor channels, four servo ports and
seven Grove ports, with the wiring already done. Power it from USB, a single-cell
LiPo, or 3.6–6 V into VIN — whichever you use also feeds the motors and servos.

## Motors

Two channels, each a pair of PWM pins on an on-board DRV8833. Drive one pin to go
forward and the other to go back; never both at once.

```python
from machine import Pin, PWM

m1a, m1b = PWM(Pin(8)), PWM(Pin(9))      # MOTOR 1
m1a.freq(20_000); m1b.freq(20_000)        # 20 kHz, above hearing

m1a.duty_u16(40000); m1b.duty_u16(0)      # forward at ~60%
```

`M1A=GP8 · M1B=GP9 · M2A=GP10 · M2B=GP11`. Each channel does 1 A continuously
(1.5 A for a few seconds). The four buttons beside the terminals run a motor at
full speed without any code — handy for checking your wiring.

## Servos

Four ports on `GP12`–`GP15`. The V+ rail is your power-source voltage, so check
your servo is happy with it before plugging in.

```python
from machine import Pin, PWM
s = PWM(Pin(12)); s.freq(50)
s.duty_u16(4915)                          # ~1.5 ms, centre
```

## Grove ports

| Port | Pin 1 | Pin 2 | Handy for |
|------|-------|-------|-----------|
| 1 | GP1 | GP0 | UART0 |
| 2 | GP3 | GP2 | I²C1 |
| 3 | GP5 | GP4 | UART1 |
| 4 | GP17 | GP16 | UART0 |
| 5 | GP26 | GP6 | analog (ADC0) |
| 6 | GP27 | GP26 | analog (ADC0/1) |
| 7 | GP28 | GP7 | analog (ADC2) |

Every port is a plain GPIO pair, so any of them will drive a digital module.
**Grove 5 and Grove 6 share GP26** — using an analog module on both at once will
not work.

All seven share one 3V3 supply with a **300 mA** total budget.

## On board

```python
from machine import Pin, PWM
import neopixel

px = neopixel.NeoPixel(Pin(18), 2)        # the two RGB LEDs
px[0] = (0, 40, 0); px.write()

buzzer = PWM(Pin(22)); buzzer.freq(440); buzzer.duty_u16(20000)

btn = Pin(20, Pin.IN, Pin.PULL_UP)        # buttons pull LOW when pressed
```

`GP18` NeoPixels ×2 · `GP20`/`GP21` buttons · `GP22` buzzer (there's a mute
switch next to it) · `GP29` reads battery voltage through a 1:2 divider.

The row of blue "DIGITAL IO STATUS" LEDs mirrors the Grove GPIOs — they light
when a pin goes high, which makes a wiring mistake visible without a meter.

## Links

- [Product page](https://www.cytron.io/p-maker-pi-rp2040-simplifying-robotics-with-raspberry-pi-rp2040)
- [Datasheet (Rev 1.2)](https://docs.google.com/document/d/1_MPn_0LGnjKLBGO9GHOnLZaqZ_zCw5cxwGwEQeUIH-U)
- [Examples on GitHub](https://github.com/CytronTechnologies/MAKER-PI-RP2040)
