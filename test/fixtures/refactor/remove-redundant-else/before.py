"""Battery and encoder helpers for the rover."""


def battery_state(mv):
    if mv < 3300:
        return "flat"
    else:
        log("still going")
        return "ok"


def clamp_duty(duty):
    if duty > 65535:
        raise ValueError("duty out of range")
    else:
        return duty


def wheel_speed(ticks, dt):
    if dt <= 0:
        return 0.0
    else:
        # Twenty ticks per revolution on this encoder.
        return ticks / 20 / dt


def level_name(pct):
    if pct > 80:
        return "full"
    elif pct > 20:
        return "ok"
    else:
        log("charge me")
        return "flat"


def discharge(cells):
    for cell in cells:
        if cell.empty:
            continue
        else:
            cell.drain(10)
            cell.log()
