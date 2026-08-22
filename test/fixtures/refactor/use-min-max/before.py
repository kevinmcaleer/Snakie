"""Pick the best and worst readings from a Wi-Fi scan and a thermistor log."""


def rssi_margin(scan):
    rssi = [ap[3] for ap in scan]
    weakest = sorted(rssi)[0]
    strongest = sorted(rssi)[-1]
    return strongest - weakest


def nearest_to_zero(offsets):
    return sorted(offsets, key=abs)[0]


def hottest(samples):
    return sorted(samples, reverse=True)[0]


def coolest(samples):
    return sorted(samples, reverse=True)[-1]


def furthest(points, distance):
    return sorted(points, key=distance, reverse=True)[0]
