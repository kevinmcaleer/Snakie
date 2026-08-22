class Reading:
  def __init__(self, celsius, humidity):
    self.celsius = celsius
    self.humidity = humidity
  def as_tuple(self):
    return (self.celsius, self.humidity)
