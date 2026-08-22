"""Folded onto one line these would be unreadable, or would lose a comment."""


def calibrated(raw_channels, reference_voltage, gain_correction, offset_correction):
    corrected = []
    for channel_reading in raw_channels:
        corrected.append((channel_reading - offset_correction) * gain_correction * reference_voltage / 65535)
    return corrected


def headers(rows):
    labels = []
    for row in rows:
        # column 0 is the sensor name the logger writes first
        labels.append(row[0])
    return labels
