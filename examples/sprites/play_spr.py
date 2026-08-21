"""Play a Snakie ``.spr`` sprite animation from the board's filesystem.

The ``.spr`` container (magic ``SNKS``) is a fixed 16-byte little-endian header
followed by the frames, each in ``framebuf.MONO_HLSB`` layout (row-major, MSB =
leftmost pixel, rows padded to whole bytes — the same raster as binary PBM):

    offset size  field
    0      4     magic       b"SNKS"
    4      1     version     1
    5      1     flags       bit0 = per-frame u16 duration table follows
                             bit2 = loop
    6      1     format      0 = 1-bit MONO_HLSB
    7      1     reserved
    8      2     width       (u16 LE)
    10     2     height      (u16 LE)
    12     2     frame count (u16 LE)
    14     2     duration_ms (u16 LE, per frame)

Frames are streamed straight from flash through ONE reusable buffer, so RAM
cost stays a single frame however long the animation. This demo blits onto an
SSD1306 OLED; anything framebuf-based works the same way.
"""

import struct
import time

import framebuf
from machine import I2C, Pin
from ssd1306 import SSD1306_I2C

SPR_FILE = "blinking_eyes.spr"


class Spr:
    """A .spr animation, streamed frame-by-frame from the filesystem."""

    def __init__(self, path):
        self.f = open(path, "rb")
        magic, version, flags, fmt, _, w, h, count, dur = struct.unpack(
            "<4sBBBBHHHH", self.f.read(16)
        )
        if magic != b"SNKS" or version != 1 or fmt != 0:
            raise ValueError("not a 1-bit SNKS v1 sprite")
        self.width, self.height, self.count = w, h, count
        if flags & 0x01:  # per-frame duration table
            self.durations = list(struct.unpack("<%dH" % count, self.f.read(2 * count)))
        else:
            self.durations = [dur or 100] * count
        self.loop = bool(flags & 0x04)
        self.data_start = self.f.tell()
        stride = (w + 7) // 8
        self.frame_size = stride * h
        self.buf = bytearray(self.frame_size)  # one frame, reused forever
        self.fb = framebuf.FrameBuffer(self.buf, w, h, framebuf.MONO_HLSB)

    def frame(self, i):
        """Read frame ``i`` into the shared FrameBuffer and return it."""
        self.f.seek(self.data_start + i * self.frame_size)
        self.f.readinto(self.buf)
        return self.fb


# I2C0 on a Raspberry Pi Pico (RP2040) — the pins differ on other boards, so
# check your board's I2C pinout before running.
i2c = I2C(0, sda=Pin(0), scl=Pin(1))
oled = SSD1306_I2C(128, 64, i2c)

spr = Spr(SPR_FILE)
x = (128 - spr.width) // 2
y = (64 - spr.height) // 2

while True:
    for i in range(spr.count):
        oled.fill(0)
        oled.blit(spr.frame(i), x, y)
        oled.show()
        time.sleep_ms(spr.durations[i])
    if not spr.loop:
        break
