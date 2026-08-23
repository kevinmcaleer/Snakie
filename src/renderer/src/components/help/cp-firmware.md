CircuitPython firmware is per-**board**, not per-chip: there is a separate build
for a Feather RP2040 and for a Pico, even though both are RP2040s. Get the one
for the board you're holding from:

<https://circuitpython.org/downloads>

`boot_out.txt` on the CIRCUITPY drive names your board id and version, so you
always know which build you're on.

## The UF2 way (most boards)

1. Double-press the **RESET** button. A second drive appears — `RPI-RP2`,
   `FEATHERBOOT`, `QTPY_BOOT`, depending on the board.
2. Drag the `.uf2` onto it.
3. The board reboots by itself and comes back as **CIRCUITPY**.

That's the whole procedure. There's no separate erase step, and no serial tool
involved — the bootloader is in ROM, so this works even if the firmware on the
board is broken.

## What upgrading keeps and loses

- Your files on CIRCUITPY are **kept**. `code.py` survives a firmware update.
- Your libraries in `/lib` are kept but may stop working: a major-version jump
  (8 → 9) needs libraries from the matching bundle. Replace them at the same time.
- `boot_out.txt` is rewritten by the new firmware.

To wipe the filesystem deliberately, flash the board's `flash_nuke.uf2` (or run
`storage.erase_filesystem()`) — an ordinary firmware update won't do it.

## Coming from MicroPython

Flashing CircuitPython onto a board that has MicroPython on it is exactly the
same drag-and-drop; the new firmware replaces the old one and creates a fresh
CIRCUITPY drive. Nothing needs erasing first.

## Notes

- Snakie's flash dialog is built around the MicroPython catalogue today; the
  UF2 drag-and-drop above works regardless and is what the CircuitPython docs
  recommend.
- ESP32 boards without native USB use a web installer or `esptool` instead of a
  UF2 drive — check your board's page on circuitpython.org.
