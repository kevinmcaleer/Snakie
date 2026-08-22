# `motorSpeed: int` with no value binds nothing at runtime (PEP 526), so it is
# not a name use and never reaches the reference set. Renaming would rewrite the
# two occurrences it can see and leave this third one behind, still declaring
# the old spelling local to the function.
def drive(motor):
    motorSpeed: int
    motorSpeed = 40
    motor.duty_u16(motorSpeed)
