# Sprite editor examples

Assets and players for Snakie's **Sprite editor** (Display instrument → **Sprites**
key): draw 1-bit sprites and frame animations for LED matrices and OLED displays,
then save/export them for MicroPython.

## Files

| File | What it is |
| --- | --- |
| `blinking_eyes.spr` | A pair of blinking eyes (12×8, 6 frames, 8 fps) in the Snakie `.spr` container — the editor's starter sprite, sized for the Arduino Modulino LED Matrix / UNO R4 WiFi matrix. |
| `blinking_eyes_open.pbm` | The open-eyes frame as a binary PBM (P4) — the single-frame interchange format. |
| `blinking_eyes.py` | The same animation exported as a MicroPython module (`FRAMES` bytes + `frame()` / `pixel()` / `play()` helpers). |
| `modulino_eyes.py` | Plays the eyes on an **Arduino Modulino LED Matrix** (needs `mpremote mip install github:arduino/arduino-modulino-mpy`). Copy it to the board together with `blinking_eyes.py`. |
| `play_spr.py` | A generic `.spr` player for framebuf displays (SSD1306 OLED shown) — documents the container layout and streams frames from flash through one reusable buffer. |

## The formats in one paragraph

A **binary PBM (P4)** raster is byte-for-byte identical to MicroPython's
`framebuf.MONO_HLSB` layout (row-major, most-significant bit = leftmost pixel,
each row padded to a whole byte), so a frame loads on-device with a single
`readinto()` and a `FrameBuffer` wrap. The **`.spr`** container simply puts a
16-byte self-describing header (magic `SNKS`, width, height, pixel format, frame
count, frame duration) in front of concatenated PBM-style frames, so a whole
animation is parseable in ~20 lines of MicroPython (see `play_spr.py`) with the
RAM cost of one frame. The editor also imports/exports **PNG, JPEG and animated
GIF** for use with ordinary image tools.
