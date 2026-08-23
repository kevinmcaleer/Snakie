# A comprehension is a scope Python has and this engine does not model, so it is
# a blind spot in both collision checks. Renaming `minSpeed` to `min_speed` here
# would rewrite the filter to `min_speed > min_speed` — never true, and the list
# comes back empty with nothing in the diff to explain why.
def fast_enough(readings):
    minSpeed = 20
    return [min_speed for min_speed in readings if min_speed > minSpeed]
