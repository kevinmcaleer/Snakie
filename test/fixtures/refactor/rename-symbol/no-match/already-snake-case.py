# Every name here is already snake_case, and `adc` is a single word. There is no
# improvement to derive, so the rule offers nothing rather than churn the file.
def read_battery(adc):
    raw_reading = adc.read_u16()
    cell_voltage = raw_reading * 3.3 / 65535
    return round(cell_voltage, 2)
