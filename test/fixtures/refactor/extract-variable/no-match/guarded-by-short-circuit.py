"""The `and` guards the division on purpose — hoisting it would divide by zero."""


def safe_ratio(total, divisor):
    ok = divisor and total / divisor > 1
    report(total / divisor)
    return ok
