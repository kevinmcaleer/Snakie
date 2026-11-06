- **Shields: a footprint can seat its board underneath.** A mount marked
  `under: true` in parts.yml draws the docked board below the carrier, the way an
  Arduino UNO sits under a motor shield (the XIAO expansion base keeps its XIAO
  on top). Wiring, pin bonding and moving the stack work as before. A board now
  also docks when it declares the mount's `footprint` name, so an UNO R4 WiFi,
  whose extra pins change its pin layout, still fits an UNO socket.
- **FunduMoto L298P motor shield for the kevsrobots.com catalog**
  (`examples/parts/kevsrobots-catalog/`), with the UNO docking underneath, its
  servo, ultrasonic, Bluetooth, RGB, pin 2 and sensor headers wired through to
  the right UNO pins, and a top view and 3-D model drawn by the new
  `scripts/fundumoto-shield.mjs`. The four UNO boards now declare the `uno`
  footprint.
