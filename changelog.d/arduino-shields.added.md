- **Shields dock onto their Arduino.** A part can now seat on the MCU board
  itself, not just on a placed part, when the board's part declares a mount:
  drop a shield on an Arduino UNO and its pins join the UNO's by name, so the
  wiring is implicit. Drag the shield away to take it off; Alt/Option-drag a
  seated part to move the whole stack (a shield covers its board, so there is
  nothing else to grab). A board also docks when it declares the mount's
  `footprint` name, whatever its pin layout.
- **FunduMoto L298P motor shield for the kevsrobots.com catalog**
  (`examples/parts/kevsrobots-catalog/`), with its servo, ultrasonic,
  Bluetooth, RGB, pin 2 and sensor headers railed to the right UNO pins, and a
  top view and 3-D model drawn by the new `scripts/fundumoto-shield.mjs`. The
  four UNO boards gain a `shield` socket (footprint `uno-shield`).
- **Arduino Motor Shield Rev3 for the kevsrobots.com catalog**, with Arduino's
  own top view, its TinkerKit connectors and motor terminal railed to the UNO
  (Vin included, as the shield ships with Vin Connect closed), and a 3-D model
  built from Arduino's drawing by the new `scripts/arduino-motor-shield.mjs`.
