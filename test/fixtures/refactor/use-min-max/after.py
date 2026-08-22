"""Pick the best and worst readings from a Wi-Fi scan and a thermistor log."""


def rssi_margin(scan):
    rssi = [ap[3] for ap in scan]
    weakest = min(rssi)
    strongest = max(rssi)
    return strongest - weakest


def nearest_to_zero(offsets):
    return min(offsets, key=abs)


def hottest(samples):
    return max(samples)


def coolest(samples):
    return min(samples)


def furthest(points, distance):
    return max(points, key=distance)
