"""The fixed gait tables: one bytes literal, one file read on demand."""

# One object, built in one step, indexed straight back to an int.
SINE_Q8 = b"\x80\x8b\x96\xa0\xab\xb5\xbf\xc8\xd1\xd9\xe1\xe8\xed\xf3\xf7\xfa"

LEG_ORDER = ("fl", "fr", "rl", "rr")
TRIM_FILE = "servo_trim.bin"


def hip_angle(phase):
    return SINE_Q8[phase % len(SINE_Q8)]


def trim_for(index):
    with open(TRIM_FILE, "rb") as handle:
        handle.seek(index * 2)
        return int.from_bytes(handle.read(2), "little")
