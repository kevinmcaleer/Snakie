"""Tab-indented file: the joined line lands at the loop's own indent."""


def dump(rows):
	parts = []
	for row in rows:
		parts.append(row)
	text = "".join(parts)
	return text
