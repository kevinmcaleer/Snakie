"""A tab-indented file, and the parentheses the new position needs."""


def ratio(top, bottom):
	total = top + bottom
	return total * 100


def pick(values, first, second):
	index = first + second
	return values[index]


def armed(flag, docked, override):
	ready = flag and not docked
	return ready == override
