# buckets: class, __init__, self.x assign/read, instance creation, method calls
from machine import PWM, Pin


class Motor:
    def __init__(self, pin_a, pin_b):
        self.forward = PWM(Pin(pin_a))
        self.reverse = PWM(Pin(pin_b))
        self.speed = 0

    def drive(self, speed):
        self.speed = speed
        self.forward.duty_u16(speed)
        self.reverse.duty_u16(0)

    def stop(self):
        self.speed = 0
        self.forward.duty_u16(0)
        self.reverse.duty_u16(0)


left = Motor(14, 15)
right = Motor(16, 17)
left.drive(30000)
right.drive(30000)
print("speed:", left.speed)
