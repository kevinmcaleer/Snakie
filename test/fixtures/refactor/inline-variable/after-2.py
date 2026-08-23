"""A tab-indented file, and the parentheses the new position needs."""


def ratio(top, bottom):
	return (top + bottom) * 100


def pick(values, first, second):
	return values[first + second]


def armed(flag, docked, override):
	return (flag and not docked) == override
