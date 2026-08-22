import uos


def replay(log_path):
	if uos.path.exists(log_path):
		# Every line is one timestamped reading.
		with open(log_path) as f:
			for line in f:
				yield line.strip()
