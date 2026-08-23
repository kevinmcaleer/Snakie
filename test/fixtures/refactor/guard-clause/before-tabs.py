def tabbed(pin):
	if pin.value():
		count = read(pin)
		log(count)
		return count
