"""A branch that does something as well as returning cannot collapse."""


def is_charged(cell, log):
    if cell.millivolts() >= 8400:
        log.write("charged")
        return True
    else:
        return False


def in_range(distance_cm, buzzer):
    if distance_cm < 20:
        return True
    else:
        buzzer.off()
        return False
