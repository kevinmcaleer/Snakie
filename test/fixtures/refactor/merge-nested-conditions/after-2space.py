def beep(buzzer, alarm):
  if buzzer is not None and (alarm.pending or alarm.repeat):
    buzzer.tone(880, 100)
