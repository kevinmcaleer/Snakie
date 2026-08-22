"""Tab-indented file: the rewrite must keep the file's own indentation."""


def read_all(pins):
	readings = []
	for pin in pins:
		readings.append(pin.read_u16())
	return readings
