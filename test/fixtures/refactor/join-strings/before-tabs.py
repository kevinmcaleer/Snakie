"""Tab-indented file: the joined line lands at the loop's own indent."""


def dump(rows):
	text = ""
	for row in rows:
		text += row
	return text
