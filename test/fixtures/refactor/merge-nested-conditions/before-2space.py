def beep(buzzer, alarm):
  if buzzer is not None:
    if alarm.pending or alarm.repeat:
      buzzer.tone(880, 100)
