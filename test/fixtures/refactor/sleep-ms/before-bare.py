from time import sleep


def ramp(motor):
    for duty in range(0, 65536, 4096):
        motor.duty_u16(duty)
        sleep(0.02)
