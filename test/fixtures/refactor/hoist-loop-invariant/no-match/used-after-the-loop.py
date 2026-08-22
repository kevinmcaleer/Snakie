"""If the packet list is empty the name is never bound — hoisting would hide that."""
MAGIC = b"SNK"
VERSION = b"\x02"


def send_all(uart, packets):
    for packet in packets:
        header = MAGIC + VERSION
        uart.write(packet)
        uart.write(b"\n")
    print(header)


def calibrate(samples):
    for sample in samples:
        window = 8 * 4
        print(sample)
    return window
