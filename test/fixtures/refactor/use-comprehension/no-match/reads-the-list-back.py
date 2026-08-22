"""The loop reads the list it is filling, so it is not a plain mapping."""


def unique_addresses(devices):
    seen = []
    for device in devices:
        if device.address not in seen:
            seen.append(device.address)
    return seen
