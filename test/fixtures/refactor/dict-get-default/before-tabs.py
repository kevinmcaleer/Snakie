"""Radio link settings, written with tabs."""

DEFAULT_CHANNEL = 76


def channel_for(link_settings, radio_name):
	if radio_name in link_settings:
		channel = link_settings[radio_name]
	else:
		channel = DEFAULT_CHANNEL
	return channel


def power_for(link_settings, radio_name):
	if radio_name not in link_settings:
		power = 0
	else:
		power = link_settings[radio_name]
	return power
