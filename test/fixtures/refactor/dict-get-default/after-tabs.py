"""Radio link settings, written with tabs."""

DEFAULT_CHANNEL = 76


def channel_for(link_settings, radio_name):
	channel = link_settings.get(radio_name, DEFAULT_CHANNEL)
	return channel


def power_for(link_settings, radio_name):
	power = link_settings.get(radio_name, 0)
	return power
