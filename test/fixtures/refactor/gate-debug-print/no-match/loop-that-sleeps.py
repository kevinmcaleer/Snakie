"""A quarter-second step loop: the print is nowhere near the time budget."""

from time import sleep_ms


def walk_forward(steps, legs):
    for step in range(steps):
        legs.step(step)
        print("step", step)
        sleep_ms(250)
