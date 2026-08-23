def stream(link, packet):
	if link.up and packet.crc_ok:
		link.send(packet)
		link.ack(packet.seq)
