# Subtractions that are not tick arithmetic, and one that is the wrong way round.
import time


def travelled(encoder, last_count):
    # Encoder counts are ordinary integers; they do not wrap on a tick period.
    return encoder.count - last_count


def remaining(deadline):
    # The counter is on the RIGHT here, so which way round ticks_diff's
    # arguments go would be a guess — and a wrong guess flips the sign.
    return deadline - time.ticks_ms()


def elapsed_via_local(start):
    # The reading is bound to a name first, so there is no arithmetic directly
    # on the call for this rule to rewrite.
    now = time.ticks_ms()
    return now - start


def scaled(sample):
    return sample.ticks_ms(4) - sample.offset
