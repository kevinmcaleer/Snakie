"""Correct in shape, but the one-liner would run past 100 characters — four
readable lines beat one that scrolls off the screen."""

DEFAULT_ENCODER_OFFSET_MICROSECONDS = 12


def encoder_offset(wheel_calibration_table, wheel_encoder_channel):
    if wheel_encoder_channel in wheel_calibration_table:
        measured_offset_microseconds = wheel_calibration_table[wheel_encoder_channel]
    else:
        measured_offset_microseconds = DEFAULT_ENCODER_OFFSET_MICROSECONDS
    return measured_offset_microseconds
