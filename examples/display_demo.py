"""I²C SSD1306 OLED display demo for Snakie.

Open & Run this, then use the Display instrument: its MIRROR shows the live
``SNK SCR`` framebuffer/text, and the SDA / SCL pin selectors (+ the address)
retarget the I²C bus over the control channel. ``inst.start(screen_sda=...,
screen_scl=..., screen_addr=..., background=False)`` builds the shared display on
an SSD1306 OLED and registers the ``screen`` receiver WITHOUT a background thread;
the loop's ``inst.control.poll()`` services the IDE's commands on the main core.

Wire an SSD1306 OLED: SDA to the SDA pin below, SCL to the SCL pin, VCC to 3V3,
GND to GND. The pins MUST be a valid RP2040 I²C pair — block 0 wants SDA∈{0,4,8,
12,16,20} & SCL∈{1,5,9,13,17,21}; block 1 wants SDA∈{2,6,10,14,18,26} & SCL∈{3,7,
11,15,19,27} (this matches the panel's SDA / SCL selectors + its invalid-pin
warning). Press Stop in Snakie to halt cleanly.
"""
import time
import instruments as inst

SCREEN_SDA = 0  # GPIO the SSD1306 SDA is wired to (from the panel's SDA selector)
SCREEN_SCL = 1  # GPIO the SSD1306 SCL is wired to (from the panel's SCL selector)
SCREEN_ADDR = 0x3C  # the OLED's I²C address (from the panel's ADDR field)

# background=False: never spawn the 2nd-core thread (it shares stdin with the REPL
# and can wedge the board). Service the channel on this loop instead.
inst.start(screen_sda=SCREEN_SDA, screen_scl=SCREEN_SCL, screen_addr=SCREEN_ADDR,
           background=False)

inst.display.text(["Snakie", "ready"])  # first frame: draw + mirror it

_beat = time.ticks_ms()
try:
    while True:
        inst.control.poll()  # service the IDE's screen commands (pins/addr/text)
        if time.ticks_diff(time.ticks_ms(), _beat) >= 1500:
            _beat = time.ticks_ms()
            inst.ready()  # tell the IDE we're live (works on any library version)
        time.sleep_ms(20)
except KeyboardInterrupt:
    inst.stop()  # Stop pressed (Ctrl-C) -> halt cleanly
