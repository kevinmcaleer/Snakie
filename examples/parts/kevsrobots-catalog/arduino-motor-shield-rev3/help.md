# Arduino Motor Shield Rev3

Arduino's own motor shield (A000079), built round an ST **L298P** dual
H-bridge. It drives **two DC motors** at up to **2 A each** (or one bipolar
stepper) from a **5–12 V** supply, measures each motor's current, and has
TinkerKit connectors for sensors and outputs. It fits the UNO R3, UNO R4
Minima, UNO R4 WiFi and UNO Q.

In the wiring view, **drop the shield onto an UNO** and it seats on it. Its
stacking headers then *are* the UNO's pins, so the TinkerKit connectors are
already wired to the right UNO pins. Drag the shield away to take it off; hold
**Alt (Option)** while dragging to move the UNO and shield together.

## Motors

| Function | Motor A | Motor B |
|----------|---------|---------|
| Direction | **D12** | **D13** |
| Speed (PWM) | **D3** | **D11** |
| Brake | **D9** | **D8** |
| Current sense | **A0** | **A1** |

Current sense reads **1.65 V per amp** (3.3 V at the 2 A full scale). The brake
and sense lines can be cut free with the jumpers on the back if you need those
pins for something else.

## Power

The 6-way screw terminal takes the motors (**A+ A− B+ B−**) and the motor
supply (**Vin**, **GND**). The shield joins its Vin to the UNO's **VIN** (the
*Vin Connect* jumper on the back is closed as shipped), so one supply powers
both. ⚠️ Arduino warns that more than **12 V** on Vin can damage the UNO: above
that, cut the jumper and power the UNO separately.

## TinkerKit connectors

| Connector | Pins | UNO pin |
|-----------|------|---------|
| **IN2**, **IN3** (white) | GND, signal, 5V | **A2**, **A3** |
| **OUT5**, **OUT6** (orange) | GND, signal, 5V | **D5**, **D6** (PWM) |
| **TWI** ×2 (4-pin) | GND, SDA, SCL, 5V | I²C (**SDA**/**SCL**) |

## Picture and 3D model

The picture is Arduino's own top view of the board. Arduino publishes no 3D
model, so `scripts/arduino-motor-shield.mjs` builds one from that drawing: the
UNO R3's outline and holes, the stacking headers, the screw terminal, the L298P,
the TinkerKit connectors and the larger parts as blocks. Board files,
schematic and drawing: Arduino, CC BY-SA 4.0.

## Links

- [Motor Shield Rev3 docs](https://docs.arduino.cc/hardware/motor-shield-rev3/) ·
  [schematic (PDF)](https://docs.arduino.cc/resources/schematics/A000079-schematics.pdf) ·
  [CAD files](https://docs.arduino.cc/static/63cfbe1b31ba392673687910680912dd/A000079-cad-files.zip)
- [Tutorial: controlling a DC motor](https://docs.arduino.cc/tutorials/motor-shield-rev3/msr3-controlling-dc-motor)
