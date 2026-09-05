A soft reboot leaves the radio as the last run left it, and the next `connect()` raises.

```python
wlan = network.WLAN(network.STA_IF)
wlan.active(True)                  # ← on a soft reboot the radio is still
wlan.connect(SSID, PASSWORD)       #   mid-connect from the last run
```

```python
wlan = network.WLAN(network.STA_IF)
# A soft reboot leaves the radio as the last run left it.
wlan.active(False)
wlan.active(True)
wlan.connect(SSID, PASSWORD)
```

## Why it matters

Pressing **Run** does a *soft* reboot. Your program is cleared and the file runs
again from the top — but a soft reboot does not reset the ESP32's WiFi hardware.
The radio keeps whatever state the previous run left it in.

If that state is "still trying to connect", the next `connect()` refuses:

```
MPY: soft reboot
E (7111) wifi:sta is connecting, cannot set config
Traceback (most recent call last):
  File "boot.py", line 23, in <module>
OSError: Wifi Internal State Error
```

This is a nasty one to meet, because the code is *correct on a cold boot*. Unplug
the board, plug it back in, run it — fine. Press Run a second time — broken. So
the evidence points at whatever you changed in between, which is almost never
the problem.

`active(False)` tears the interface down before you bring it back up, which
clears that leftover state. On a cold boot the interface is already down, so the
line does nothing and costs nothing. On every run after the first, it is the
difference between working and not.

## Why `isconnected()` is not the guard

The obvious first attempt is:

```python
if not wlan.isconnected():
    wlan.connect(SSID, PASSWORD)     # still raises
```

It does not help. The station is *connecting*, not connected — so
`isconnected()` is `False`, the guard passes, and `connect()` raises exactly as
before. Guarding on the connection state cannot fix a problem caused by the
connection *attempt*.

## Before you apply it

- Bringing the interface down **drops a live connection** on purpose. That is
  the point here, but it means this is not a change to apply blindly across a
  file you have not read.
- If your program deliberately keeps a connection alive across runs — a REPL
  session you reconnect to, say — you want the opposite of this, and should
  guard on `wlan.status()` instead.
- Waiting for the connection afterwards is still your job. `connect()` returns
  immediately; the radio takes a second or two, and `ifconfig()` will report
  `0.0.0.0` until it is done.
