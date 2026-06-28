# Minimal VL53L0X time-of-flight driver stub (Snakie example, #184).
#
# This is a tiny placeholder shipped with the example part so the Board View's
# "install driver" flow has a real file to copy onto the board. Replace it with
# the full driver (e.g. from github:kevinmcaleer/vl53l0x) for production use.

from machine import I2C

_VL53L0X_ADDR = 0x29


class VL53L0X:
    """A stub VL53L0X driver: enough to import and construct on the board."""

    def __init__(self, i2c: I2C, address: int = _VL53L0X_ADDR) -> None:
        self.i2c = i2c
        self.address = address

    def read(self) -> int:
        """Return a distance in millimetres (stub: always 0)."""
        return 0
