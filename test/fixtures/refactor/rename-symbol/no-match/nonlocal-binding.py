# The `nonlocal stepSize` declaration names the variable without an expression
# to rewrite, so a rename would leave the closure pointing at the old spelling.
def make_ramp(motor):
    stepSize = 1

    def faster():
        nonlocal stepSize
        stepSize += 1
        motor.duty_u16(stepSize * 256)

    return faster
