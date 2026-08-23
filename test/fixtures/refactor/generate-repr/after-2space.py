class Reading:
  def __init__(self, celsius, humidity):
    self.celsius = celsius
    self.humidity = humidity
  def as_tuple(self):
    return (self.celsius, self.humidity)
  def __repr__(self):
    return f"Reading(celsius={self.celsius!r}, humidity={self.humidity!r})"
