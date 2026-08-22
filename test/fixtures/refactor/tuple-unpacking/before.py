"""Take the IMU packet apart into names the rest of the code can read."""


def orientation(imu):
    reading = imu.read()
    roll = reading[0]
    pitch = reading[1]
    yaw = reading[2]
    return roll, pitch, yaw


def leg(step):
    x = step[0]
    y = step[1]
    return x, y


class Route:
    def first_move(self):
        dx = self.moves[0]
        dy = self.moves[1]
        return dx, dy
