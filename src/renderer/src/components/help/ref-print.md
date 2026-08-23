`print()` sends text to the **REPL** — the live terminal below the editor. It's your main tool for seeing what a program is doing.

## Printing

```python
print("hello")
print("temp:", 21.4, "C")      # spaces between args
print(f"pin={pin} val={v}")    # f-string
print("loading", end="...")    # no newline
```

## The REPL

The terminal is a live prompt on the board — type Python and press Enter to run it now:

```python
>>> 2 + 2
4
>>> import time
>>> time.sleep(0.5)
```

## REPL shortcuts

- <kbd>Ctrl</kbd>+<kbd>C</kbd> — interrupt a running program / infinite loop
- <kbd>Ctrl</kbd>+<kbd>D</kbd> — soft reboot (re-runs `main.py`, or `code.py` on
  CircuitPython)
- `help('modules')` — list every module on the board
- A bare expression echoes its value: `>>> 2 + 2` → `4`
