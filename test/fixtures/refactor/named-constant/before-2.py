"""Servo sweep helpers for the Snakie gripper arm."""


def set_pulse(servo, pulse):
    servo.duty_ns(pulse * 1000)


def centre(left_servo, right_servo):
    set_pulse(left_servo, 1500)
    set_pulse(right_servo, 1500)


def open_gripper(gripper):
    set_pulse(gripper, 2200)
