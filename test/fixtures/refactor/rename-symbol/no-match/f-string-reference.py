# The parser keeps an f-string opaque, so the `{cellVoltage}` inside one is
# invisible to the reference set. Renaming around it would leave a NameError
# waiting for the first time the board printed a reading.
def report(adc):
    cellVoltage = adc.read_u16() * 3.3 / 65535
    print(f"pack: {cellVoltage:.2f} V")
    return cellVoltage
