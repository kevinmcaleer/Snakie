"""Tab-indented pixel driver."""


def fade(levels, strip):
	for i in range(len(levels)):
		strip.set_pixel(i, levels[i])
	strip.write()


def peak(samples):
	highest = 0
	for i in range(len(samples)):
		if samples[i] > highest:
			highest = samples[i]
	return highest
