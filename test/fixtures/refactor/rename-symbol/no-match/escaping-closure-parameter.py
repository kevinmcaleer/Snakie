# A closure's parameter is renameable only while every caller is in front of us.
# `step` is handed straight back to whoever called `make_ramp`, so the call site
# lives in a file we cannot see — and `ramp(stepSize=3)` over there would start
# raising TypeError the moment this parameter changed its name.
def make_ramp(motor):
    def step(stepSize):
        motor.duty_u16(stepSize)

    return step
