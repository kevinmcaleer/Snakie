"""ST7789 SPI TFT display demo for Snakie.

Open & Run this, then use the Display instrument: pick a TFT size, and its MIRROR
shows the live SNK SCR text/framebuffer while the SCK / MOSI / DC / RST / CS pin
selectors retarget the SPI bus over the control channel.
inst.start(screen_sck=..., screen_mosi=..., screen_dc=..., screen_rst=...,
screen_cs=..., screen_w=..., screen_h=..., background=False) builds the shared
display on an ST7789 panel and registers the screen receiver WITHOUT a background
thread; the loop's inst.control.poll() services the IDE's commands on the main core.

Wire an ST7789 TFT: SCK (clock) + MOSI/SDA (data) to the pins below, DC + RST to
their pins, CS to its pin (or tie it low and set screen_cs=None), VCC to 3V3, GND to
GND, BL/BLK to 3V3. SCK + MOSI MUST be a valid RP2040 SPI pair (this matches the
panel's selectors + its invalid-pin warning). Press Stop in Snakie to halt cleanly.
"""
import sys
import time

# Drop any stale cached `instruments` before importing, so a freshly UPDATED
# library on disk is actually used (MicroPython caches imports in sys.modules).
sys.modules.pop("instruments", None)
import instruments as inst

SCREEN_SCK = 18   # GPIO the ST7789 SCK/SCL (clock) is wired to
SCREEN_MOSI = 19  # GPIO the ST7789 MOSI/SDA (data) is wired to
SCREEN_DC = 16    # GPIO the ST7789 DC (data/command) is wired to
SCREEN_RST = 20   # GPIO the ST7789 RST (reset) is wired to
SCREEN_CS = 17    # GPIO the ST7789 CS is wired to (None = tied low)
SCREEN_W = 240    # panel width in px (from the panel's SIZE picker)
SCREEN_H = 240    # panel height in px

# background=False: never spawn the 2nd-core thread (it shares stdin with the REPL
# and can wedge the board). Service the channel on this loop instead.
inst.start(screen_sck=SCREEN_SCK, screen_mosi=SCREEN_MOSI, screen_dc=SCREEN_DC,
           screen_rst=SCREEN_RST, screen_cs=SCREEN_CS, screen_w=SCREEN_W,
           screen_h=SCREEN_H, background=False)

inst.display.text(["Snakie", "ready"])  # first frame: draw + mirror it

_beat = time.ticks_ms()
try:
    while True:
        inst.control.poll()  # service the IDE's screen commands (spi/text)
        if time.ticks_diff(time.ticks_ms(), _beat) >= 1500:
            _beat = time.ticks_ms()
            inst.ready()  # tell the IDE we're live
        time.sleep_ms(20)
except KeyboardInterrupt:
    inst.stop()  # Stop pressed (Ctrl-C) -> halt cleanly
