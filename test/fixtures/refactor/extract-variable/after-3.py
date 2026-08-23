"""Two extractions in one function get two names, not one name twice."""


def mix(base, trim, gain):
    value = base * 100 + trim
    left = value
    value2 = gain * 250 - trim
    right = value2
    log(value)
    log(value2)
    return left, right
