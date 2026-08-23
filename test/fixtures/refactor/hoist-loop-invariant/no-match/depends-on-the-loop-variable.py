"""The expression changes every pass, so there is nothing to hoist."""
ADC_STEPS = 65535


def to_volts(readings):
    volts = []
    for reading in readings:
        scaled = reading * 3.3 / ADC_STEPS
        volts.append(scaled)
    return volts


def ramp(motor, plan):
    speed = 0
    for target in plan:
        speed = (speed + target) // 2
        motor.duty(speed)
