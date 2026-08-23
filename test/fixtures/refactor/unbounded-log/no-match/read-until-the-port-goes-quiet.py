"""A serial reader that stops when the sender does.

`while True:` looks endless and the list is only ever appended to, but the
`break` ends the loop the moment the port goes quiet: the list is bounded by how
much data actually arrived, which is the whole point of reading it this way. The
warning's claim — "a loop that never ends" — would simply be untrue, and telling
someone their working reader will die of MemoryError is exactly the wolf-crying
this rule is built to avoid.
"""
from machine import UART

uart = UART(0, 115200)
lines = []

while True:
    line = uart.readline()
    if line is None:
        break
    lines.append(line)

print("read", len(lines), "lines")
