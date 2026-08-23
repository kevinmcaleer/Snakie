"""Five parameters is the limit, not past it."""

from machine import PWM, Pin


def configure_servo(pin, freq, min_us, max_us, centre_us):
    servo = PWM(Pin(pin))
    servo.freq(freq)
    servo.duty_ns((min_us + max_us) // 2 * 1000)
    return servo, centre_us


class Arm:
    def reach(self, shoulder, elbow, wrist, grip, speed):
        self.shoulder.angle(shoulder)
        self.elbow.angle(elbow)
        self.wrist.angle(wrist)
        self.grip.angle(grip)
        self.speed = speed
