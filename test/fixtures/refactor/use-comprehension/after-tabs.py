"""Tab-indented file: the rewrite must keep the file's own indentation."""


def read_all(pins):
	readings = [pin.read_u16() for pin in pins]
	return readings
