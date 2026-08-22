import uos


def replay(log_path):
	try:
		# Every line is one timestamped reading.
		with open(log_path) as f:
			for line in f:
				yield line.strip()
	except OSError:
		pass
