def scan(samples, threshold):
    hits = 0
    for sample in samples:
        if sample > threshold:
            hits += 1
        elif sample == threshold:
            hits += 1
    return hits
