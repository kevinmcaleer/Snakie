# buckets: method call on an object, subscript assign, tuple assign, for/range
import machine
import neopixel
import time

PIXELS = 16

np = neopixel.NeoPixel(machine.Pin(0), PIXELS)


def wheel(pos):
    if pos < 85:
        return (pos * 3, 255 - pos * 3, 0)
    if pos < 170:
        pos -= 85
        return (255 - pos * 3, 0, pos * 3)
    pos -= 170
    return (0, pos * 3, 255 - pos * 3)


offset = 0
while True:
    for i in range(PIXELS):
        np[i] = wheel((i * 16 + offset) % 255)
    np.write()
    offset += 1
    time.sleep_ms(20)
