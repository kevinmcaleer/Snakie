Get Snakie talking to your MicroPython board over USB.

## Plug in & connect

1. **Plug the board in** with a USB data cable (not a charge-only one).
2. Click **Connect** in the toolbar.
3. **Pick the serial port** for your board from the list.

Once connected, the toolbar shows the port and the terminal wakes up.

## The REPL

The terminal at the bottom is a live MicroPython **REPL** — type Python and press <kbd>Enter</kbd> to run it on the board right away.

- <kbd>Ctrl</kbd>+<kbd>C</kbd> — interrupt a running program
- <kbd>Ctrl</kbd>+<kbd>D</kbd> — soft reboot (re-runs `main.py`)

## Not showing up?

- Try a different cable or USB port.
- Close other tools holding the port (Thonny, `mpremote`, a serial monitor).
- Unplug and replug, then hit **Connect** again.
