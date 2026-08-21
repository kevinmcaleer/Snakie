A CircuitPython board is always running something. There is no "upload then run"
step: the board boots, runs **`code.py`**, and re-runs it every time a file
changes.

## The boot order

1. `boot.py` runs once, at power-on or hard reset. It's the only place settings
   like `storage.remount()` take effect.
2. Then the first of these that exists runs: **`code.txt`, `code.py`,
   `main.txt`, `main.py`**.

Only the first one runs. A board carrying both `code.py` and `main.py` runs
`code.py`, and editing `main.py` appears to do nothing — Snakie marks which file
your board will actually run in the device file tree.

3. When it finishes (or crashes), the board drops to the REPL and prints the
   traceback there.

## Auto-reload

Saving any file on the board restarts `code.py` immediately, from the top. That's
the whole edit-run loop: **save is run**.

Two things follow from it:

- A half-written file gets run. If you're saving mid-edit, expect a traceback.
- Restarting releases every pin, so `ValueError: D13 in use` usually means an
  older run is still holding one — a hard reset clears it.

Turn it off while you're experimenting at the REPL:

```python
import supervisor

supervisor.runtime.autoreload = False
```

…and restart your program by hand when you want to:

```python
import supervisor

supervisor.reload()
```

## What Snakie's buttons do

- **Run** executes the file that's open, over the REPL, exactly as it does on
  MicroPython. It takes over from `code.py`; when it ends, the board sits at the
  REPL rather than going back to `code.py`.
- **Stop** interrupts it (<kbd>Ctrl</kbd>+<kbd>C</kbd>).
- **Reset** soft-reboots — and on CircuitPython a soft reboot **runs `code.py`
  again from the start**, so it starts your program rather than clearing the
  board.
- **Save & upload** writes to the board. Name the file `code.py` and it becomes
  the program that runs at boot.

## Seeing what went wrong

If `code.py` fails, the traceback is printed to the serial console — the terminal
below the editor. Connect and press <kbd>Ctrl</kbd>+<kbd>C</kbd> then
<kbd>Ctrl</kbd>+<kbd>D</kbd> to interrupt and re-run cleanly.
