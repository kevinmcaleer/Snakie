"""The name is settled by more than one statement, so the hoist would lose one."""
HOME_ANGLE = 90


def replay(arm, plan):
    for step in plan:
        target = HOME_ANGLE
        if step.reverse:
            target = -HOME_ANGLE
        arm.move(target)


def stream(uart, frames):
    for frame in frames:
        prefix = b"F"
        uart.write(prefix)
        prefix = b"."
        uart.write(prefix)
