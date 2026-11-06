- **Arduino UNO R3, UNO R4 Minima, UNO R4 WiFi and UNO Q for the kevsrobots.com
  parts catalog.** They live in the new `examples/parts/kevsrobots-catalog/`,
  which Snakie never loads: MicroPython doesn't run on these boards, so the app
  doesn't offer them, but the site's catalog imports them beside the Standard
  parts. Each has Arduino's top-down photo with every header pad placed over
  it, pins checked against Arduino's official pinouts, a help page and a 3-D
  model — Arduino's own STEP converted to STL for the R4s and UNO Q, and one
  generated from the Eagle board for the R3 by the new
  `scripts/arduino-uno-meshes.mjs`. (They were briefly in the Standard library
  on master; Standard library 1.20.1 drops them again.)
