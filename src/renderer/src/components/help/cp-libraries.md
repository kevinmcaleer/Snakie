CircuitPython has no `mip`, no `pip` and no installer running on the board.
A library is just **files copied into `/lib`** on the CIRCUITPY drive.

## Where libraries come from

The **Adafruit CircuitPython Bundle** is one big zip containing every maintained
library, built for each CircuitPython major version:

<https://circuitpython.org/libraries>

Download the bundle that matches your board's version — a 9.x board needs the
9.x bundle. `boot_out.txt` on the drive tells you which you have, and so does
Snakie's status bar when the board is connected.

## Installing one

1. Unzip the bundle.
2. Find the library inside its `lib/` folder — a single `.mpy` file
   (`neopixel.mpy`) or a folder (`adafruit_motor/`).
3. Copy it into `/lib` on the board, keeping the same shape: a folder stays a
   folder.
4. `import neopixel` now works. Nothing to reboot — the next auto-reload picks
   it up.

Copy the **`.mpy`**, not the `.py`, unless you're debugging: `.mpy` is
pre-compiled, so it loads faster and uses much less RAM. That matters — running
out of memory on import is the usual reason a board with several libraries
suddenly stops working.

## Dependencies

Libraries import each other. `adafruit_bme280` needs `adafruit_bus_device` and
`adafruit_register`; miss one and you get `ImportError: no module named
'adafruit_bus_device'`. Each library's page lists what it needs, and the safest
move is to copy the whole dependency folder from the same bundle.

## Keeping the versions straight

A library built for CircuitPython 8 on a board running 9 will usually fail on
import with a `.mpy` version error. When you upgrade the firmware, replace the
libraries from the matching bundle too.

## Community libraries

The **Community Bundle** carries libraries maintained outside Adafruit. Same
mechanism: download, unzip, copy into `/lib`.

## In Snakie

The board's files are in the device file tree — make a `lib` folder there if
there isn't one, and copy files into it the same way you would any other file.
Snakie writes through the CIRCUITPY drive, so this works even though the board's
own code can't write to itself.
