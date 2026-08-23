"""Swap the drive channels when the chassis is mounted back to front."""


def flip_motors(left_pin, right_pin):
    spare = left_pin
    left_pin = right_pin
    right_pin = spare
    return left_pin, right_pin


class Chassis:
    def __init__(self, front, back):
        self.front = front
        self.back = back

    def reverse(self):
        tmp = self.front
        self.front = self.back
        self.back = tmp
        print("drive reversed")
