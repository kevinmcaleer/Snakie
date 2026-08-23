"""blinking_eyes — a 1-bit sprite animation drawn in Snakie's Sprite editor.

12x8, 6 frames at 8 fps.
Each frame is framebuf.MONO_HLSB: row-major, most-significant bit = leftmost
pixel, each row padded to a whole byte (2 bytes per row).
"""

import framebuf
import time

WIDTH = 12
HEIGHT = 8
FPS = 8

FRAMES = (
    b'\x00\x00\x79\xe0\x86\x10\xb6\xd0\xb6\xd0\x86\x10\x79\xe0\x00\x00',
    b'\x00\x00\x79\xe0\x86\x10\xb6\xd0\xb6\xd0\x86\x10\x79\xe0\x00\x00',
    b'\x00\x00\x79\xe0\x86\x10\xb6\xd0\xb6\xd0\x86\x10\x79\xe0\x00\x00',
    b'\x00\x00\x00\x00\x79\xe0\x86\x10\xb6\xd0\x86\x10\x79\xe0\x00\x00',
    b'\x00\x00\x00\x00\x00\x00\x00\x00\x79\xe0\x00\x00\x00\x00\x00\x00',
    b'\x00\x00\x00\x00\x79\xe0\x86\x10\xb6\xd0\x86\x10\x79\xe0\x00\x00',
)


def frame(i):
    """Frame i wrapped in a FrameBuffer (blit it onto any framebuf display)."""
    return framebuf.FrameBuffer(bytearray(FRAMES[i]), WIDTH, HEIGHT, framebuf.MONO_HLSB)


def pixel(i, x, y):
    """True when pixel (x, y) of frame i is lit — for non-framebuf displays."""
    row_bytes = (WIDTH + 7) // 8
    return bool(FRAMES[i][y * row_bytes + (x >> 3)] & (0x80 >> (x & 7)))


def play(display, x=0, y=0, loops=None):
    """Loop the animation on a framebuf display (e.g. SSD1306). loops=None = forever."""
    n = 0
    while loops is None or n < loops:
        for i in range(len(FRAMES)):
            display.blit(frame(i), x, y)
            display.show()
            time.sleep_ms(1000 // FPS)
        n += 1
