"""Take the IMU packet apart into names the rest of the code can read."""


def orientation(imu):
    reading = imu.read()
    roll, pitch, yaw = reading
    return roll, pitch, yaw


def leg(step):
    x, y = step
    return x, y


class Route:
    def first_move(self):
        dx, dy = self.moves
        return dx, dy
