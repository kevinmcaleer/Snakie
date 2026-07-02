An on-demand BLE scanner listing nearby Bluetooth devices by signal strength.

## What it does
**SCAN** resets the list and sends `SNKCMD scan:bt`; each discovered device arrives as a `SNK BT <name> <mac> <rssi>` line (deduped by MAC, strongest sample kept). Rows show the device **name**, its **MAC** and signal bars + RSSI. The readout is **DEVICES / NEAREST / MODE**.

## How to use it
A running program must service the trigger — `inst.start()` runs an active `inst.bt_scan()` on request. Poll each loop:

```python
import instruments as inst

inst.start()          # registers scan:bt
while True:
    inst.control.poll()
```

No program running? **SCAN** offers to open and run the BLE demo (it scans on the second core).
