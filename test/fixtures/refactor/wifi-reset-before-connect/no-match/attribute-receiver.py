import network


class Radio:
    def __init__(self):
        self.wlan = network.WLAN(network.STA_IF)

    def up(self, ssid, password):
        # An attribute receiver: proving this is the same object across a method
        # boundary is more than the rule claims, so it stays quiet.
        self.wlan.active(True)
        self.wlan.connect(ssid, password)
