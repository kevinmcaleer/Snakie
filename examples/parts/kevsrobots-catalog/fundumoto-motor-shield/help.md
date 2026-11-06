# FunduMoto L298P Motor Shield

A shield for the **Arduino UNO** (R3, R4 Minima, R4 WiFi, UNO Q) built round an
ST **L298P** dual H-bridge. It drives **two DC motors** at up to **2 A each**
(2.5 A peak) from a **4.8–24 V** motor supply, and breaks out headers for a
servo, an ultrasonic sensor, a Bluetooth module, an RGB LED and six sensors.
Sold as the FunduMoto shield and as the Keyes L298P (the silk says both).

In the wiring view, **drop the shield onto an UNO** and it seats on it. The
shield's stacking headers then *are* the UNO's pins, so its servo, ultrasonic,
RGB and other headers are already wired to the right UNO pins. Drag the shield
away to take it off; hold **Alt (Option)** while dragging to move the UNO and
shield together.

## Motors

| Motor | Speed (PWM) | Direction |
|-------|-------------|-----------|
| **A** | **D10** | **D12** |
| **B** | **D11** | **D13** |

Direction HIGH runs forward, LOW reverse. One direction pin per motor drives both
halves of the bridge through an inverter, so there is no brake mode. The
terminal's polarity isn't marked: swap a motor's two leads if it turns the wrong
way. The black **MA / MB** header carries the same two outputs, and a yellow and
green LED per motor show which way it is driven.

## Power

- **Motor power** goes into the 2-way terminal (**+** = VMS, **−** = GND), 4.8–24 V.
- The **OPT** jumper feeds VMS to the UNO's **VIN**. Only fit it with VMS at 12 V
  or less, don't use the UNO's barrel jack at the same time, and don't leave it on
  with no motor supply (the motors would then try to run from USB).
- The **servo** header has its own 5 V regulator off VMS, so it needs about
  6.5 V or more on VMS. Everything else runs from the UNO's 5 V.

## Headers

| Header | Pins | Arduino pins |
|--------|------|--------------|
| **SERVO** (white) | G, +5, 9 | **D9** |
| **Ping** (yellow, ultrasonic) | +, R (echo), T (trigger), G | **D8** echo, **D7** trigger |
| **RGB** (blue) | 5V, B, G, −, R | **D6** blue, **D5** green, **D3** red |
| **BT2** (Bluetooth, HC-06 style) | R, T, −, + (3.3 V) | **D1** / **D0** (the UNO's serial) |
| **PIN 2 I/O** (blue) | G, +, S | **D2** |
| **Sensor** block (3 × 6) | G, +5, signal per pin | **A0–A5** |
| **Buzzer** (on board) | — | **D4**, active high |

⚠️ Bluetooth shares **D0/D1** with the UNO's USB serial: unplug the module while
uploading a sketch. The 2 mm "bluetooth" header beside it isn't modelled as pins.

## Drawing and 3D model

Nobody publishes CAD or a licensed photo for this board, so the top view and the
3D model are drawn by `scripts/fundumoto-shield.mjs` from one layout measured off
a flat photo of the board (70 × 54 mm). Headers line up with the UNO's grid;
the smaller parts are approximate.

## Links

- [ProtoSupplies: L298P motor driver shield](https://protosupplies.com/product/l298p-motor-driver-shield/) (pinout and power notes)
- [Arduino forum: FunduMoto L298P shield](https://forum.arduino.cc/t/fundumoto-l298p-shield/385824)
