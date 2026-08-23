def battery_percent(millivolts):
    """No emitter here, so there is nothing being paid for."""
    try:
        return millivolts / 42.0
    except ZeroDivisionError:
        return 0.0
