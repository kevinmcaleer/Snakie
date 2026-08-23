def battery_percent(millivolts, full_millivolts):
    """Rough state of charge — floats, so viper has nothing to hold in a register."""
    percent = 0.0
    for _ in range(4):
        percent = percent + millivolts / full_millivolts * 25.0
    return percent
