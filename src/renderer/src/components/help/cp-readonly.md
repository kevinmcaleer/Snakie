This is the single most confusing thing a newcomer meets on CircuitPython, and
it isn't a fault: **only one side may write the filesystem at a time.**

By default that side is your computer. The board shows up as a USB drive called
**CIRCUITPY**, you drag files onto it, and everything works. The cost is that
your *program* can't write:

```python
with open("log.csv", "a") as f:      # from code.py
    f.write("1,2,3\n")
```

```
OSError: [Errno 30] Read-only filesystem
```

Nothing is broken. The board is refusing because the computer has the drive
mounted, and two writers would corrupt the filesystem.

## Which way round do you want it?

**Computer writes (the default).** Edit files from Snakie or any editor, drag
libraries into `/lib`. Your code can read but not write. This is what you want
while you're building something.

**Board writes.** Your program can log to a file, but the drive goes read-only
for the computer — you can no longer edit files on it the normal way. Put this in
`boot.py` (it has no effect anywhere else):

```python
import board
import digitalio
import storage

# Hold D0 to GND at power-on to keep the drive editable — your escape hatch.
switch = digitalio.DigitalInOut(board.D0)
switch.switch_to_input(pull=digitalio.Pull.UP)

storage.remount("/", readonly=switch.value)
```

Boot with the pin free and the computer can edit; ground it and the board can
write its log. **Always** leave yourself a switch like this — without one, a
`boot.py` that hands the filesystem to the board and then crashes leaves you
reflashing the board to recover.

Changes to `boot.py` only take effect after a **hard** reset (the reset button or
a power cycle), not a soft reboot.

## How Snakie handles it

Snakie writes files through the CIRCUITPY **drive** rather than over the REPL,
which is why saving works even though the board's own code can't write. If you
have flipped the filesystem the other way, the drive is read-only to the
computer and saving fails — flip it back with the switch above.

## Other ways to store data

- `microcontroller.nvm` — a small block of bytes that survives a reset, with no
  filesystem involved.
- An SD card on SPI, using `adafruit_sdcard` — its own filesystem, always
  writable from code.
- Print it to the serial console and let Snakie's Data Logger keep it on the
  computer.
