"""The streaming fix this hint asks for, written out in full.

`batch` is created at the top of every pass, filled, printed and dropped — the
heap holds one batch at a time however long the run lasts. The `= []` inside the
loop is the very thing that makes it safe, so a rule that reads any empty-list
assignment as the start of a leak would be flagging the fix as the bug.
"""
import time
from machine import ADC

battery = ADC(29)

while True:
    batch = []
    for _ in range(16):
        batch.append(battery.read_u16())
        time.sleep_ms(10)
    print(batch)
