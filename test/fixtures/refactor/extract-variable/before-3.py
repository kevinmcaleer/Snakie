"""Two extractions in one function get two names, not one name twice."""


def mix(base, trim, gain):
    left = base * 100 + trim
    right = gain * 250 - trim
    log(base * 100 + trim)
    log(gain * 250 - trim)
    return left, right
