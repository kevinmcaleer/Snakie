from machine import Pin

motor_a_speed = Pin(0)
motor_a_direction = Pin(1)

motor_b_speed = Pin(2)
motor_b_direction = Pin(3)

value = 1
while True:
    if value == 100: value = 1
    print(f"value: {value}")
    value += 1