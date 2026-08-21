A GPIO is a `digitalio.DigitalInOut` built from a `board` pin. Give it a
**direction**, then read or write its `value`.

## Output

```python
import board
import digitalio

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

led.value = True      # 3.3 V (high)
led.value = False     # 0 V (low)
led.value = not led.value   # toggle
```

`value` is an **attribute you assign**, not a method you call. `led.value(True)`
raises `TypeError: 'bool' object is not callable` — that is the single most
common first error coming from MicroPython.

## Input & pull resistors

A floating input reads noise. Add an internal pull so an unconnected pin has a
defined level.

```python
import board
import digitalio

btn = digitalio.DigitalInOut(board.D14)
btn.switch_to_input(pull=digitalio.Pull.UP)

# wired to GND, so pressed == False
if not btn.value:
    print("pressed")
```

- `digitalio.Pull.UP` — idles **True**, reads False when tied to GND
- `digitalio.Pull.DOWN` — idles **False**
- `switch_to_input(...)` / `switch_to_output(...)` set direction and pull in one
  call; the long way is `btn.direction = digitalio.Direction.INPUT` then
  `btn.pull = digitalio.Pull.UP`

## Releasing a pin

Only one object may hold a pin. When you're finished with it:

```python
led.deinit()
```

Without that, re-creating it gives `ValueError: D13 in use` — which also happens
if `code.py` auto-reloads while a pin is still claimed.

## Debounced buttons the easy way

For anything more than one button, `keypad` does the debouncing and queues
press/release events for you:

```python
import board
import keypad

keys = keypad.Keys((board.D14,), value_when_pressed=False, pull=True)
event = keys.events.get()
if event and event.pressed:
    print("pressed")
```

## Notes

- Pins are **3.3 V** — don't feed them 5 V.
- There is no `machine` module here; see "Coming from MicroPython" for the
  side-by-side.
