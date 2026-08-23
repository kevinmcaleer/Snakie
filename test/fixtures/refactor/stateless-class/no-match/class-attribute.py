"""The class body carries a calibration constant, so it is not empty."""

import math


class Thermistor:
    BETA = 3950
    NOMINAL_K = 298.15

    def celsius(self, adc):
        ratio = adc.read_u16() / 65535
        kelvin = 1 / (1 / self.NOMINAL_K + math.log(ratio / (1 - ratio)) / self.BETA)
        return kelvin - 273.15
