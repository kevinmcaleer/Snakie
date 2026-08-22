# Half-way through a rename by hand: both spellings are live. Renaming
# `motorSpeed` to `motor_speed` here would merge two different variables.
def calibrate(sensor, motor):
    motor_speed = 0
    motorSpeed = sensor.read_u16() >> 8
    motor.duty_u16(motor_speed + motorSpeed)
    return motorSpeed
