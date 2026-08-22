from time import sleep, sleep_ms


def ramp(motor):
    for duty in range(0, 65536, 4096):
        motor.duty_u16(duty)
        sleep_ms(20)
