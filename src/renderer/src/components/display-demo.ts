/**
 * The display demo program the IDE opens + runs when a Display action is taken and
 * no Snakie program is detected on the board (mirrors `range-demo.ts`). Kept in
 * sync with the reference copy at `examples/display_demo.py`.
 *
 * It builds the shared SSD1306 OLED on the SDA/SCL pins, registers the `screen`
 * control receiver, draws a first frame, then services commands on the MAIN loop
 * via `inst.control.poll()` (which also emits the `SNK READY` heartbeat) while the
 * Display panel's MIRROR shows the live `SNK SCR` echo. The SDA/SCL pins + address
 * are injected from the panel's selectors so "Run display demo" matches the user's
 * wiring without an edit.
 */
export const DISPLAY_DEMO_NAME = 'display_demo.py'

/**
 * Build the display demo source with the SSD1306 wired to GP`sda` / GP`scl` at the
 * I²C `addr` (a `0xNN` string, e.g. `0x3C`). The address is normalised to a clean
 * `0xNN` literal so the generated `SCREEN_ADDR` is valid Python.
 */
export function displayDemo(sda: number, scl: number, addr: string): string {
  const s = Number.isFinite(sda) ? Math.round(sda) : 0
  const c = Number.isFinite(scl) ? Math.round(scl) : 1
  // Accept `0x3C` / `0X3C` / `3C` / `60` — emit a tidy `0xNN` literal.
  const parsed = addr ? Number(/^0x/i.test(addr) ? addr : `0x${addr}`) : NaN
  const a = Number.isFinite(parsed) ? `0x${parsed.toString(16).toUpperCase()}` : '0x3C'
  return `"""I²C SSD1306 OLED display demo for Snakie.

Open & Run this, then use the Display instrument: its MIRROR shows the live
SNK SCR framebuffer/text, and the SDA / SCL pin selectors (+ the address) retarget
the I²C bus over the control channel. inst.start(screen_sda=..., screen_scl=...,
screen_addr=..., background=False) builds the shared display on an SSD1306 OLED and
registers the screen receiver WITHOUT a background thread; the loop's
inst.control.poll() services the IDE's commands on the main core.

Wire an SSD1306 OLED: SDA to the SDA pin below, SCL to the SCL pin, VCC to 3V3, GND
to GND. The pins MUST be a valid RP2040 I²C pair (this matches the panel's SDA /
SCL selectors + its invalid-pin warning). Press Stop in Snakie to halt cleanly.
"""
import time
import instruments as inst

SCREEN_SDA = ${s}  # GPIO the SSD1306 SDA is wired to (from the panel's selector)
SCREEN_SCL = ${c}  # GPIO the SSD1306 SCL is wired to (from the panel's selector)
SCREEN_ADDR = ${a}  # the OLED's I²C address (from the panel's ADDR field)

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
`
}
