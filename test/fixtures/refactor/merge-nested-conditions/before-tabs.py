def stream(link, packet):
	if link.up:
		if packet.crc_ok:
			link.send(packet)
			link.ack(packet.seq)
