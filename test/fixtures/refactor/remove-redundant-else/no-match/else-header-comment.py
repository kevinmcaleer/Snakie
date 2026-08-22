def safe_stop(motor, fault):
    if fault:
        motor.brake()
        return False
    else:  # the happy path keeps the wheels turning
        motor.cruise()
        return True
