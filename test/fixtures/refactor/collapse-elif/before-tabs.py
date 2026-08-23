"""Decode the packet type the radio handed us (tab-indented)."""


def state_name(code):
	if code == 0:
		return "idle"
	else:
		if code == 1:
			return "run"
		else:
			return "fault"
