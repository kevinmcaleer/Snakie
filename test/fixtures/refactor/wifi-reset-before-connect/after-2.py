import network


def bring_up(ssid, password):
    sta = network.WLAN(network.STA_IF)
    # A soft reboot leaves the radio as the last run left it.
    sta.active(False)
    sta.active(True)
    sta.connect(ssid, password)
    return sta
