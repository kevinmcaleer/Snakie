Put MicroPython onto a board (or update it) without leaving Snakie.

## Open the flasher

Click the **⚡ Flash firmware** button at the right of the status bar. Snakie
auto-detects connected boards — ESP32/ESP8266 on their serial port, an RP2040 /
Pico holding **BOOTSEL** (the `RPI-RP2` drive), or a micro:bit (the `MICROBIT`
drive). Press **⟳ Detect** to re-scan.

## Pick the firmware

- **Download from MicroPython.org** — choose a **Family → Model → Variant →
  Version** from the official catalog and Snakie downloads it for you.
- **Local file** — browse to a `.uf2` (RP2040), `.bin` (ESP32/ESP8266) or
  `.hex` (micro:bit) you already have.

## Flash it

- **Pico / RP2040** — unplug, hold **BOOTSEL** while plugging back in, pick the
  `RPI-RP2` drive, then **Flash**. The file is copied over and the board reboots
  into MicroPython.
- **ESP32 / ESP8266** — pick the serial port and flash offset (pre-filled).
  Flashing uses `esptool`; install it once with `pip install esptool` if the
  dialog says it's missing.
- **micro:bit** — pick the `MICROBIT` drive. If you see a `MAINTENANCE` drive
  instead, unplug and replug **without** holding reset — flashing MicroPython in
  maintenance mode can brick the interface firmware, so Snakie blocks it.

A progress bar and log show the whole flash; hit **Done** when it finishes,
then **Connect** as usual.

## Updates

When a board is connected, Snakie can check whether a newer MicroPython exists
for it and offer the update from the same ⚡ button (toggle this in
**Settings ▸ Editor ▸ Firmware updates**).
