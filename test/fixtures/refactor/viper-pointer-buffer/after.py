"""Packet and pixel work for the LED matrix, one subscript at a time."""


def checksum(payload):
    """Fletcher-16 over a packet we just read off the UART."""
    low = 0
    high = 0
    for i in range(len(payload)):
        low = (low + payload[i]) & 0xFF
        high = (high + low) & 0xFF
    return (high << 8) | low


def brighten(step):
    """Lift every pixel of the frame by one step, clamped to a byte."""
    frame = bytearray(64)
    for i in range(64):
        frame[i] = (frame[i] + step) & 0xFF
    return frame
