Put MicroPython — or CircuitPython — onto a board (or update it) without
leaving Snakie.

## Open the flasher

Click the **⚡ Flash firmware** button at the right of the status bar. Snakie
auto-detects connected boards — ESP32/ESP8266 on their serial port, an RP2040 /
Pico holding **BOOTSEL** (the `RPI-RP2` drive), any other board in UF2
bootloader mode (each vendor names its own volume — `FEATHERBOOT`, `QTPY_BOOT`,
`ARDUINO`…), or a micro:bit (the `MICROBIT` drive). Press **⟳ Detect** to
re-scan.

## Choose the runtime

The **Runtime** buttons at the top pick which Python you are flashing:

- **MicroPython** — builds from micropython.org, one per **chip family**. An
  `ESP32_GENERIC_S3` build runs on any ESP32-S3 board.
- **CircuitPython** — builds from circuitpython.org, one per **board**.
  `raspberry_pi_pico` and `raspberry_pi_pico_w` are different files, and the
  wrong one flashes without complaining and comes up with the wrong pins.

If a board is already connected, the dialog opens on whatever that board says it
is running. Because CircuitPython is per board, Snakie matches your board to its
own build using the **Board ID** in `boot_out.txt` on the `CIRCUITPY` drive. When
it can't establish that id it pre-selects **nothing** and says so — pick the
board yourself rather than take a near-enough build.

## Pick the firmware

- **Download from micropython.org / circuitpython.org** — choose a
  **Family → Model → Variant → Version** from the official catalog and Snakie
  downloads it for you. Where a board is published both ways, the Variant list
  names which — `(UF2)` for a drive copy, `(esptool .bin)` for an esptool write.
- **Local file** — browse to a `.uf2` (drive copy), `.bin` (ESP32/ESP8266) or
  `.hex` (micro:bit) you already have.

Only stable releases are offered as updates. CircuitPython publishes its alphas
and betas in the same catalog, and MicroPython its nightlies; you can still pick
one from the Version list deliberately, but Snakie will never suggest one.

## Flash it

- **Pico / RP2040** — unplug, hold **BOOTSEL** while plugging back in, pick the
  `RPI-RP2` drive, then **Flash**. The file is copied over and the board reboots
  into the new firmware.
- **Other UF2 boards** (Feather, QT Py, Metro, XIAO…) — double-tap **RESET** so
  the vendor's bootloader volume mounts, pick it, then **Flash**. Same
  mechanism, different volume name.
- **ESP32 / ESP8266** — pick the serial port and flash offset (pre-filled).
  Flashing uses `esptool`; install it once with `pip install esptool` if the
  dialog says it's missing.
- **micro:bit** — pick the `MICROBIT` drive. If you see a `MAINTENANCE` drive
  instead, unplug and replug **without** holding reset — flashing in maintenance
  mode can brick the interface firmware, so Snakie blocks it.

A progress bar and log show the whole flash; hit **Done** when it finishes,
then **Connect** as usual.

## Updates

When a board is connected, Snakie can check whether a newer build exists for it
and offer the update from the same ⚡ button (toggle this in **Settings ▸ Editor
▸ Firmware updates**). The prompt names the runtime it's offering, so a
CircuitPython board is never told a MicroPython release is available.
