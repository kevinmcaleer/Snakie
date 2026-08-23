"""Tab-indented pixel driver."""


def fade(levels, strip):
	for i, level in enumerate(levels):
		strip.set_pixel(i, level)
	strip.write()


def peak(samples):
	highest = 0
	for sample in samples:
		if sample > highest:
			highest = sample
	return highest
