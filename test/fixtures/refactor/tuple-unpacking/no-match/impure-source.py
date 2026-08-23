"""Each index is its own bus read; collapsing them would change the traffic."""


def pose(imu):
    x = imu.read()[0]
    y = imu.read()[1]
    return x, y
