def sort_readings(samples, hi, lo):
    for reading in samples:
        if reading > 100:
            hi.append(reading)
            hi.sort()
        else:
            lo.append(reading)
