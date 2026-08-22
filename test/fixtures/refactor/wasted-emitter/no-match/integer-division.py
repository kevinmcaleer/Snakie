import micropython


@micropython.native
def heading_steps(ticks, per_step):
    """Floor division and modulo stay in integer land — `/` would not."""
    whole = 0
    for _ in range(ticks // per_step):
        whole += 1
    return whole % 360
