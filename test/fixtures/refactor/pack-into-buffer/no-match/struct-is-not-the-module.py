"""`struct.pack()` where `struct` is not the module.

Nothing here imports `struct` or `ustruct`, so the `struct` this loop calls is
the packet builder defined above it — a plain object with a `pack` method that
allocates nothing the rule knows about. The spelling alone is not proof.
"""
from machine import UART

link = UART(1, 115200)


class PacketBuilder:
    def __init__(self, fmt):
        self.fmt = fmt
        self.buffer = bytearray(8)

    def pack(self, value):
        self.buffer[0] = value & 0xFF
        return self.buffer


struct = PacketBuilder("<Hhhh")


def stream(samples):
    for n in range(samples):
        link.write(struct.pack(n))
