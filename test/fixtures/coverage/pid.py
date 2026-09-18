# buckets: class, self.x assign, @property, augmented assign, docstring
class PID:
    """A small proportional-integral-derivative controller."""

    def __init__(self, kp, ki, kd):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.integral = 0
        self.previous = 0
        self.target = 0

    @property
    def gains(self):
        return (self.kp, self.ki, self.kd)

    def reset(self):
        self.integral = 0
        self.previous = 0

    def update(self, value, dt):
        error = self.target - value
        self.integral += error * dt
        derivative = (error - self.previous) / dt
        self.previous = error
        return self.kp * error + self.ki * self.integral + self.kd * derivative
