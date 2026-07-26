# Pimoroni Servo 2040 (RP2040)

An **RP2040** board that drives up to **18 servos** with 3-pin headers, plus
current/voltage sensing, **6 analog sensor inputs**, **6 RGB LEDs** (WS2812) and
a Qw/ST (Qwiic / STEMMA QT) **I²C** connector. Servo signals are **GP0–GP17**.

## Servo channels → GPIO

| Servo | GPIO | Servo | GPIO |
|------:|:-----|------:|:-----|
| 1 | GP0 | 10 | GP9 |
| 2 | GP1 | 11 | GP10 |
| 3 | GP2 | 12 | GP11 |
| 4 | GP3 | 13 | GP12 |
| 5 | GP4 | 14 | GP13 |
| 6 | GP5 | 15 | GP14 |
| 7 | GP6 | 16 | GP15 |
| 8 | GP7 | 17 | GP16 |
| 9 | GP8 | 18 | GP17 |

Other pins: WS2812 LEDs **GP18**, I²C **INT GP19 · SDA GP20 · SCL GP21**, user
button **GP23**, analog **A0 GP26 · A1 GP27 · A2 GP28**, and a shared sense ADC on
**GP29** (current/voltage + the 6 sensor inputs, read through an analog mux).

## Why 18 servos need PIO, not hardware PWM

Each servo pin shows a **PWM A** or **PWM B** badge in the Part Editor. That's
accurate — it's the hardware PWM channel the GPIO muxes to — but it is *not* 18
independent channels, and the reason matters if you ever drive these pins
yourself.

The RP2040 has **8 PWM slices**, each with an A and a B channel, and every
channel is shared by two GPIOs:

| Channel | GPIOs | Servos |
|---|---|---|
| PWM0 A | GP0, **GP16** | 1 and **17** |
| PWM0 B | GP1, **GP17** | 2 and **18** |
| PWM1 A … PWM7 B | GP2 … GP15 | 3 … 16 |

So **servo 17 shares a PWM channel with servo 1**, and **servo 18 with servo 2**.
Drive them with `machine.PWM` and the pair can't hold different angles — the
second one you set drags the first with it, because they're the same counter and
the same compare register.

That's the whole reason the board's own driver uses the RP2040's **PIO** instead:
`ServoCluster` builds the pulse train in a state machine, so all 18 really are
independent. If you're hand-rolling with `machine.PWM`, either stay under 16
servos avoiding the GP0/GP16 and GP1/GP17 pairs, or use `ServoCluster`.

```python
from servo import ServoCluster, servo2040

# All 18, genuinely independent — PIO, not the PWM blocks.
cluster = ServoCluster(pio=0, sm=0, pins=list(range(servo2040.SERVO_1, servo2040.SERVO_18 + 1)))
cluster.enable_all()
cluster.to_percent(0, 100)   # servo 1 hard over
cluster.to_percent(16, 0)    # servo 17 the other way — no interaction
```

## Powering servos

Feed servo power into the board's **screw terminal** (2.8–8 V for typical hobby
servos — check your servo's rating). Each servo header is **Signal · V+ · GND**;
V+ comes from that terminal, not from the RP2040's 3V3.

## MicroPython

The `servo` / `servo2040` modules are built into **Pimoroni's MicroPython
firmware** — flash the Pico-family Pimoroni build (see the release link below),
then:

```python
import time
from servo import Servo, servo2040

s = Servo(servo2040.SERVO_1)   # servo 1 = GP0
s.enable()
while True:
    s.to_min(); time.sleep(1)   # ~ -90°
    s.to_mid(); time.sleep(1)   # ~ 0°
    s.to_max(); time.sleep(1)   # ~ +90°
```

Control many at once with `ServoCluster` (uses the RP2040 PIO). See the examples
directory linked below.

## Links
- [Pimoroni Servo 2040 product page](https://shop.pimoroni.com/products/servo-2040) (PIM613)
- [MicroPython examples](https://github.com/pimoroni/pimoroni-pico/tree/main/micropython/examples/servo2040)
- [Pimoroni MicroPython firmware releases](https://github.com/pimoroni/pimoroni-pico/releases)
