def tabbed(pin):
	if not pin.value():
		return
	count = read(pin)
	log(count)
	return count
