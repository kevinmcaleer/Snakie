An on-demand Wi-Fi scanner rendered as a signal-bar network list.

## What it does
Pressing **SCAN** clears the list and fires `SNKCMD scan:wifi` on the board; results stream back one `SNK WIFI …` line per network. Each row shows the SSID, a lock icon (secured vs open), 0–4 signal bars and the RSSI in dBm. The readout is **NETWORKS / BEST / BAND** (2.4 vs 5 GHz).

## How to use it
Scanning needs a running Snakie program to service the trigger — `inst.start()` runs the scan (`inst.wifi_scan()`) for you. Poll each loop:

```python
import instruments as inst

inst.start()          # registers scan:wifi
while True:
    inst.control.poll()
```

With no program live, **SCAN** offers to open and run the bundled Wi-Fi demo instead.
