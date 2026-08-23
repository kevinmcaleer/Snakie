"""The subject is a fresh read each time, so folding it into one test would
change how often the hardware is touched."""


def at_limit(switch):
    if switch.read() == 0 or switch.read() == 1:
        return True
    return False


def known_code(frame, index):
    return frame[index] == 0x55 or frame[index] == 0xAA
