"""Blinking eyes on the Arduino Modulino LED Matrix (12x8) — Sprite editor demo.

Wire the Modulino LED Matrix to your board's I2C (Qwiic) connector, install the
official package with:

    mpremote mip install github:arduino/arduino-modulino-mpy

then run this file. The animation data lives in ``blinking_eyes.py`` beside it
(exported from Snakie's Sprite editor — Display instrument, "Sprites" key), so
copy both files to the board.
"""

import time

from modulino import ModulinoLEDMatrix

import blinking_eyes as sprite

matrix = ModulinoLEDMatrix()

while True:
    for i in range(len(sprite.FRAMES)):
        for y in range(sprite.HEIGHT):
            for x in range(sprite.WIDTH):
                matrix.set_pixel(x, y, 1 if sprite.pixel(i, x, y) else 0)
        matrix.show()
        time.sleep_ms(1000 // sprite.FPS)
