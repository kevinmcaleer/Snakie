"""A `break` whose loop stays behind: inside a new function it has nothing to leave."""

import time


def home_axis(limit_switch, stepper):
    for step in range(400):
        stepper.step(-1)
        if limit_switch.value() == 0:
            time.sleep_ms(5)
            break
    stepper.zero()
