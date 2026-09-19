# Files on the board

A Pico has a small filesystem of its own. You can log readings to it, keep a
config in it, and read both back after the board has been unplugged and plugged
in again — which is the only way a program remembers anything.

The blocks are in **Control ▸ Files**.

## Logging your readings

```
use  [open file "data.csv" for adding to the end]  as (file)
    forever
        write (join [temperature] with ["\n"]) to (file)
        wait 1 second
and close it afterwards
```

```python
with open('data.csv', 'a') as file:
    while True:
        temperature = read()
        file.write(f"{temperature}\n")
        time.sleep(1)
```

**"adding to the end"** keeps what is already in the file. **"writing (start
again)"** empties it first — useful, and easy to do by accident, which is why
the block spells it out rather than saying `w`.

Nothing is added to what you write. If you want each reading on its own line,
put a newline on the end yourself.

## Reading it back

```
use  [open file "data.csv" for reading]  as (file)
    for every line (line) of (file)
        print (line with spaces trimmed)
and close it afterwards
```

```python
with open('data.csv') as file:
    for line in file:
        print(line.strip())
```

**for every line** hands you one line at a time and never holds the whole file
in memory at once — on a board with 264 KB of RAM that is the difference
between a program that works and one that dies on a long log. Each line still
carries its newline, so **with spaces trimmed** is almost always the next block.

## Why "use … as" and not "open" and "close"

You could open a file, write to it, and close it in three separate steps. If
your program stops in the middle — an error, a reset, a cable pulled — the file
is never closed, and on a microcontroller **that loses your data with no error
at all**: what you wrote was still waiting in memory to be flushed.

**use … as** closes the file however the block ends, including when something
inside it goes wrong. That is the whole reason to prefer it, and it is why
there is no "close file" block to forget.

Python calls this `with`, and it works for anything that needs giving back
afterwards, not only files.

## On a CircuitPython board

**Reading works.** Writing does not, by default: a CircuitPython board's
filesystem is read-only to your program so that your computer can edit it over
USB, and a write raises `OSError: Read-only filesystem`.

To log to it you have to hand the filesystem to the board in `boot.py`:

```python
import board, digitalio, storage

button = digitalio.DigitalInOut(board.GP15)
button.pull = digitalio.Pull.UP
# Writable by the BOARD when the button is held down at power-on.
storage.remount("/", readonly=not button.value)
```

That is a deliberate trade — while the board can write, your computer cannot —
so it is worth reading the CircuitPython section on it before you rely on it.
