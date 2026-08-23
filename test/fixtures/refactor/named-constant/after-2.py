"""Servo sweep helpers for the Snakie gripper arm."""

PULSE = 1500


def set_pulse(servo, pulse):
    servo.duty_ns(pulse * 1000)


def centre(left_servo, right_servo):
    set_pulse(left_servo, PULSE)
    set_pulse(right_servo, PULSE)


def open_gripper(gripper):
    set_pulse(gripper, 2200)
