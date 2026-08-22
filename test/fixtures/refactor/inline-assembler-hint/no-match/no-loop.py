import micropython


@micropython.viper
def clamp_duty(duty: int, ceiling: int) -> int:
    """One comparison and no loop — there is no hot path to hand-assemble."""
    if duty > ceiling:
        return ceiling
    if duty < 0:
        return 0
    return duty
