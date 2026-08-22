def average(samples, threshold):
    total = 0
    for reading in samples:
        total += reading
        if reading > threshold:
            log(reading)
            alert(reading)
    return total / len(samples)
