def relay_all(packets, radio):
  for packet in packets:
    if packet.ttl > 0:
      packet.ttl -= 1
      radio.send(packet)
