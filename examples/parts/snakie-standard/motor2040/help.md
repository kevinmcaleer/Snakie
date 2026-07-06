# Pimoroni Motor 2040 (RP2040)

An **RP2040** board that drives **4 DC motors** (up to ~10 V / 0.5 A each) with
per-motor **current sensing**, **4 quadrature encoder** inputs, 2 analog sensor
inputs, a WS2812 RGB LED and a Qw/ST (Qwiic / STEMMA QT) **I²C** connector.

## Motors & encoders → GPIO

| Motor | +  | −  | Encoder | A | B |
|:------|:---|:---|:--------|:--|:--|
| A | GP4 | GP5 | A | GP0 | GP1 |
| B | GP6 | GP7 | B | GP2 | GP3 |
| C | GP8 | GP9 | C | GP12 | GP13 |
| D | GP10 | GP11 | D | GP14 | GP15 |

Other pins: TX/TRIG **GP16**, RX/ECHO **GP17**, WS2812 LED **GP18**, I²C **INT
GP19 · SDA GP20 · SCL GP21**, user button **GP23**, and a shared sense ADC on
**GP29** (per-motor current, board voltage, driver fault + 2 sensors via a mux).

## Powering motors

Feed motor power (up to ~10 V) into the board's **screw terminal**. Each motor
output is a **+ / −** pair driven as a complementary PWM H-bridge — don't wire a
motor pin to logic.

## MicroPython

The `motor` / `motor2040` (and `encoder`) modules are built into **Pimoroni's
MicroPython firmware** — flash the Pico-family Pimoroni build (link below), then:

```python
import time
from motor import Motor, motor2040

m = Motor(motor2040.MOTOR_A)   # motor A = GP4 / GP5
m.enable()
m.full_positive();  time.sleep(2)   # full speed one way
m.stop();           time.sleep(1)
m.full_negative();  time.sleep(2)   # full speed the other way
m.coast()
```

Read an encoder with the `encoder` module (`Encoder(0, motor2040.ENCODER_A)`),
or drive all four motors together with `MotorCluster`. See the examples below.

## Links
- [Pimoroni Motor 2040 product page](https://shop.pimoroni.com/products/motor-2040) (PIM618)
- [MicroPython examples](https://github.com/pimoroni/pimoroni-pico/tree/main/micropython/examples/motor2040)
- [Pimoroni MicroPython firmware releases](https://github.com/pimoroni/pimoroni-pico/releases)
