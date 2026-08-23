def drive(rovers):
    rover = rovers[0]
    for nxt in rovers:
        rover.motor.duty_u16(0)
        rover.motor.duty_u16(1)
        rover = nxt
