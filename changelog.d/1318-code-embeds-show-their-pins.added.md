- **Code embeds show the board and the pins the code uses (#1318).** A code
  box whose MicroPython uses pins now draws the board beside it, with each pin
  lit, named and coloured by what it does (output, input, PWM, I2C and so on).
  Point at a line and its pins glow on the board; point at a pin and its lines
  are marked in the code. While the program runs, each pin shows its simulated
  state (`on`, `off`, `PWM 8%`). A pin the board does not have, or one set up
  twice, is underlined. `board=` picks the board (Pico 2 W by default) and
  `pins=0` turns the strip off. Narrow boxes show a row of pin chips instead.
