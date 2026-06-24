# Instruments library — live readings for the Oscilloscope, Multimeter & Plotter

Snakie's **Oscilloscope**, **Multimeter** and **Plotter** can read live values
two ways:

1. **LIVE poll** (the toggle on a scope/meter) — Snakie reaches into the board
   over the raw REPL and reads each pin. This is fine when nothing is running,
   but it **interrupts a running program** on every poll.
2. **Telemetry** (this library, issue #107) — your program **prints** readings
   and Snakie **parses the serial stream**. This is passive, always-on, and does
   **not** interrupt anything, so it works inside a `while True:` loop.

The instruments library is the easy way to do (2): a handful of one-line helpers
that print the readings in a format Snakie recognises, routes to the right
instrument, and hides from the console.

## Copying the library to your board

Copy [`micropython/instruments.py`](../micropython/instruments.py) onto the
board's filesystem, alongside your `main.py` (e.g. drag it across in Snakie's
file view, or use `mpremote cp`/Thonny). Then `import` it from your program:

```python
import instruments as inst
```

It's pure MicroPython with no dependencies — safe to run on a Pico.

## Quick start

```python
import time
from machine import ADC, PWM, Pin
import instruments as inst

pwm = PWM(Pin(0)); pwm.freq(1000); pwm.duty_u16(32768)
adc = ADC(26)

while True:
    inst.read_pwm(pwm, ch="pwm")     # -> Oscilloscope (the PWM duty waveform)
    inst.read_adc(adc, ch="adc0")    # -> Multimeter (the ADC voltage)
    inst.plot(temp=21.4, light=80)   # -> Plotter (named series over time)
    time.sleep(0.1)
```

Open the matching instrument in Snakie (the **SCOPE** / **METER** dock buttons,
or a launcher in the Board View) and run the program — the instruments update
live while the loop runs, with **no LIVE toggle needed**. There's a runnable
demo in [`examples/instruments_demo.py`](../examples/instruments_demo.py).

## API

### Core instruments (issue #107)

| Function | Emits | Notes |
| --- | --- | --- |
| `scope(value, ch="ch1")` | one oscilloscope sample | call repeatedly in a loop → a live waveform |
| `meter(value, ch="adc0", unit="V")` | one meter reading | the latest value is shown; Snakie tracks MIN/MAX/AVG |
| `plot(*args, **kwargs)` | one plotter row | bare numbers and/or `name=value` series |
| `read_adc(adc, ch="adc0")` | a meter reading, returns volts | reads `adc.read_u16()`, converts to volts (3.3 V ref, 16-bit) |
| `read_pwm(pwm, ch="pwm")` | a scope sample, returns duty | reads `pwm.duty_u16() / 65535` |

`plot` mixes styles: `plot(1, 2, 3)` graphs three positional series, while
`plot(temp=21.4, light=80)` graphs named ones; you can combine them.

### Robotics emitters (issue #116)

Each is a single cheap, non-blocking `print()` — loop-safe like `scope`/`meter`.

| Function | Emits | Notes |
| --- | --- | --- |
| `imu(roll, pitch, yaw, ch="imu")` | Euler-angle orientation (deg) | a 3-D attitude indicator |
| `imu_quat(w, x, y, z, ch="imu")` | quaternion orientation | drift-/gimbal-lock-free |
| `distance(mm, angle=None, ch="dist")` | a range reading (mm) | optional bearing for a sweeping sensor |
| `button(name, state)` | a button up/down | `state` coerced to `1` if truthy |
| `encoder(count, ch="enc", pressed=None)` | a rotary count | optional integrated push switch |
| `screen(lines, addr="0x3C")` | a small display's text rows | rows' spaces encoded as `_` on the wire |
| `screen_fb(data, w, h, addr=…, encoding="b64")` | a packed framebuffer | `b64` (raw 1-bpp) or `rle` |

### Scanners (issue #116)

These **block briefly** to run a scan, then emit the result set — call them
*occasionally* (emit-on-complete), not inside a tight loop. Each tolerates a
missing radio (no `network`/`bluetooth` → no output).

| Function | Emits | Notes |
| --- | --- | --- |
| `i2c_scan(i2c)` | one `SNK I2C …` result set | `i2c.scan()` addresses as `0x..` hex |
| `wifi_scan()` | one `SNK WIFI …` per network | `network.WLAN(STA_IF)` scan |
| `bt_scan(ms=4000)` | one `SNK BT …` per device | presence-gated; use `emit_bt(name, mac, rssi)` from your own BLE scan |

### Receivers (the control channel — issue #115)

Thin actuators driven by IDE → board commands (see **the control protocol**
below): `teleop(target="teleop")` returns the latest `(axes, payload)`; the
`buzzer` / `led` / `Screen` helpers act on the latest command. They guard their
hardware imports, so the module still imports under CPython.

The **`Buzzer`** drives a passive buzzer/speaker on a PWM pin: `tone(freq, ms)`
plays one tone, `play_seq([(freq, ms), …])` plays a note list (`freq` 0 = a
rest), `stop()` silences (duty 0), and `set_pin(n)` (re)targets `PWM(Pin(n))`.
`start(buzzer_pin=<n>)` attaches the shared `buzzer` to GP`<n>` and registers the
`buzzer` control receiver, so the IDE's Buzzer panel can drive a speaker over the
control channel — serviced by `inst.control.poll()` in your loop. The IDE
pre-parses melodies/RTTTL and sends a compact `seq` line, so the board needs no
RTTTL parser.

### The channel label `ch`

`<ch>` is a label you choose (e.g. `pwm`, `adc0`, the variable name). Snakie uses
it to match a reading to an open instrument:

- If the label matches the instrument's source variable, that reading feeds it.
- If only **one** scope (or meter) is open, it gets the telemetry regardless of
  the label — so the simple "open one scope and print" case just works.

## The telemetry protocol

Each helper does a **single `print()`** of **one line**, prefixed with the
sentinel token `SNK`. One reading per line, ASCII, space-delimited:

```
SNK SCOPE <ch> <value>            # a scope sample (value: float)
SNK METER <ch> <value> [<unit>]   # a meter reading (default unit "V")
SNK PLOT  <tok> [<tok> ...]       # plotter data; each tok is name=value or a number
SNK IMU   <ch> <roll> <pitch> <yaw>      # Euler-angle orientation (degrees)
SNK IMUQ  <ch> <w> <x> <y> <z>           # orientation quaternion
SNK DIST  <ch> <mm> [<angle>]            # range mm, optional bearing (degrees)
SNK BTN   <name> <0|1>                   # button up(0)/down(1)
SNK ENC   <ch> <count> [<0|1>]           # encoder count, optional press state
SNK SCR   <addr> text <row> [<row> ...]  # display text; each row's spaces -> '_'
SNK SCR   <addr> fb <w> <h> <enc> <data> # display framebuffer; enc in {b64, rle}
SNK I2C   <addr> [<addr> ...]            # one bus-scan result set (may be empty)
SNK WIFI  <ssid> <rssi> <ch> <sec>       # one network (one line each); SSID spaces -> '_'
SNK BT    <name> <mac> <rssi>            # one BLE device (one line each); name spaces -> '_'
SNK READY <caps ...>                     # the background service is alive (inst.start())
```

Examples of the exact lines printed:

```
SNK SCOPE pwm 0.5
SNK METER adc0 1.65 V
SNK PLOT temp=21.4 light=80
SNK PLOT 1 2 3
SNK IMU imu 0.0 1.2 90.0
SNK IMUQ imu 1.0 0.0 0.0 0.0
SNK DIST lidar 250 45
SNK BTN a 1
SNK ENC dial -3 1
SNK SCR 0x3C text Hello_world Line_2
SNK SCR 0x3C fb 8 8 b64 AAEC
SNK I2C 0x3C 0x68
SNK WIFI My_Network -42 6 WPA2
SNK BT My_Tag AA:BB:CC -57
```

### Packing notes

- **Text rows** (`SNK SCR … text …`): each row is a single ASCII token, so a
  space inside a row is encoded as `_` (the IDE decodes it back). An empty
  screen is a bare `SNK SCR <addr> text`.
- **Framebuffer** (`SNK SCR … fb …`): `<enc>` documents the packing — `b64` is
  base64 of the raw 1-bpp buffer (row-major, MSB-first within each byte), `rle`
  is a simple run-length form `<count>x<0|1>` joined by commas.
- **Scan sets**: `I2C` is **one** line for the whole scan; `WIFI`/`BT` print
  **one line per network/device**. SSID/name spaces are `_`-encoded so each
  stays a single token.

The `SNK` sentinel does three jobs in the IDE:

- **Routes** the line to the scope, meter or plotter.
- **Hides** the line from the REPL console (it's machine data, not output).
- Makes the Plotter's generic number parser **ignore** scope/meter lines (only
  `SNK PLOT` rows are graphed; plain non-`SNK` prints still graph as before).

Because the helpers are just `str` formatting plus one `print`, they're cheap and
non-blocking — safe to call at speed inside a tight loop.

## A worked loop example

```python
import time
from machine import ADC, PWM, Pin
import instruments as inst

pwm = PWM(Pin(0)); pwm.freq(1000)
adc = ADC(26)

duty = 0
while True:
    duty = (duty + 2048) & 0xFFFF      # sweep the PWM duty
    pwm.duty_u16(duty)

    d = inst.read_pwm(pwm, ch="pwm")    # scope: the duty fraction (0..1)
    v = inst.read_adc(adc, ch="adc0")   # meter: the ADC voltage
    inst.plot(duty=round(d, 3), volts=round(v, 3))  # plotter: both over time

    time.sleep(0.05)
```

Open the Oscilloscope, Multimeter and Plotter, run this, and watch all three
update together — without interrupting the loop.

## The control protocol — IDE → board (issue #115)

Telemetry flows board → IDE. The **control channel** is the reverse: the IDE
**writes** a command line over the same serial link and the on-device `control`
helper **polls stdin non-blockingly** in your loop and applies the **latest
value per target**. One line per command, mirroring the `SNK` sentinel so the
Terminal hides the echo:

```
SNKCMD <target> <payload>\n
```

`<target>` is a single token naming what to drive (`teleop`, `led`, `buzzer`,
`screen`, or a scan trigger like `scan:i2c`). `<payload>` is the free-form
remainder for that target's helper. Example wire lines:

```
SNKCMD led pwm 0.5
SNKCMD buzzer tone 440 200
SNKCMD buzzer seq 440:200,0:100,523:200
SNKCMD buzzer stop
SNKCMD buzzer pin 15
SNKCMD teleop axes=lx:0.5,ly:-0.2 btn:a=1
SNKCMD scan:i2c
```

The `buzzer` target's payload verbs: `tone <freq> <ms>` (one tone), `seq
<freq:ms>,<freq:ms>,…` (a melody/ringtone; `freq` 0 = a rest), `stop` (silence
now), and `pin <n>` (retarget the PWM pin). The IDE builds these with
`buzzerTonePayload` / `buzzerSeqPayload` / `buzzerStopPayload` / `buzzerPinPayload`
and the board actuates them via `buzzer_command(payload)`.

### On the board — poll it in your loop

```python
import instruments as inst

while True:
    inst.control.poll()                    # drain pending SNKCMD lines (non-blocking)
    inst.control.get("led")                # latest raw payload string, or None
    ax = inst.control.axes("teleop")       # {'lx': 0.5, 'ly': -0.2} from axes=...
    if inst.control.pressed("teleop", "a"):
        fire()
    # ... act on the values, then keep looping ...
```

`control.poll()` reads whatever is waiting on `sys.stdin` via `uselect.poll`
(falling back to inert when stdin isn't pollable), so it **never blocks** a
`while True:` loop, never corrupts your own `print()`/telemetry output, and
keeps only the **latest** payload per target. Register a callback for triggers
with `control.on("scan:i2c", do_scan)` — it fires inside `poll()` when that
command arrives. For tests / custom transports, drive it directly with
`control.feed("SNKCMD led on\n")`.

### Let the IDE drive it — `inst.start()` + poll your loop

`inst.start()` registers the built-in control handlers + attaches the buzzer, and
then you call `inst.control.poll()` once per loop iteration to service the IDE's
commands:

```python
import time
import instruments as inst

inst.start(buzzer_pin=15)    # attach the buzzer to GP15 + register the receiver
# inst.start(i2c=i2c)        # …also register the scan:i2c trigger for that bus

while True:
    inst.control.poll()      # drain SNKCMD commands + emit the SNK READY heartbeat
    time.sleep(0.02)
```

`start()` registers the built-in scan triggers (`scan:wifi`, `scan:bt`, and
`scan:i2c` when you pass a bus), the `buzzer` receiver (with `buzzer_pin`), and a
`ping` → readiness reply, then announces a first `SNK READY <caps...>`. From then
on **`control.poll()` itself emits the `SNK READY` heartbeat** (~every 2 s) — that
is the IDE's presence signal: an instrument (e.g. the **Wi-Fi scan** or **Buzzer**
panel) knows a Snakie program is live and drives it directly; with no `SNK READY`
it offers to open + run a demo instead. `stop()` silences the buzzer (handy from a
`KeyboardInterrupt` handler so Snakie's Stop leaves the board quiet). The
`SNK READY` line is hidden from the console like all `SNK …` telemetry.

> **Second core (`background=True`) — experimental.** `inst.start(background=True)`
> spawns a `_thread` to poll for you, so your main loop needn't call
> `control.poll()`. It is **off by default and unreliable on the RP2040**: the
> thread shares `stdin` with the REPL, which can wedge the board on Stop /
> soft-reset (needing a replug). Prefer the main-loop poll above.

The teleop payload grammar (parsed by `control.axes` / `control.pressed`):

```
axes=<name>:<value>,<name>:<value> btn:<name>=1 btn:<name>=1
```

i.e. one `axes=` token of comma-separated `name:value` axes, then a `btn:NAME=1`
token per pressed button (absent ⇒ not pressed).

### In the IDE — send a command

The renderer writes a control line through the device layer:

```ts
await window.api.device.sendControl('led', 'pwm 0.5')
// → writes `SNKCMD led pwm 0.5\n` over serial (does NOT interrupt a running program)
```

The line is built + sanitised by `buildControlLine(target, payload)` (in
`src/shared/control.ts`): the target is reduced to a single token and embedded
newlines are stripped so a command can't be injected. `buildTeleopPayload(axes,
buttons)` assembles the teleop grammar above. The Terminal hides both `SNK …`
telemetry and `SNKCMD …` control echoes from the console.

## See also

- [`docs/board.md`](board.md) — the Board View and its scope/meter launchers.
- [`micropython/instruments.py`](../micropython/instruments.py) — the library.
- [`examples/instruments_demo.py`](../examples/instruments_demo.py) — runnable demo.
- [`examples/buzzer_demo.py`](../examples/buzzer_demo.py) — the Buzzer panel's demo
  (`inst.start(buzzer_pin=15)`); the Wi-Fi panel's is
  [`examples/wifi_scan_demo.py`](../examples/wifi_scan_demo.py).
