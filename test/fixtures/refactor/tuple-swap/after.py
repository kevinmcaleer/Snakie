"""Swap the drive channels when the chassis is mounted back to front."""


def flip_motors(left_pin, right_pin):
    left_pin, right_pin = right_pin, left_pin
    return left_pin, right_pin


class Chassis:
    def __init__(self, front, back):
        self.front = front
        self.back = back

    def reverse(self):
        self.front, self.back = self.back, self.front
        print("drive reversed")
