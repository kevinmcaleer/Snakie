"""Servo Arm — drive the 3-D robot from code (headless, #313).

Open `arm.urdf` in the Robot View. The bundled `robot.yml` already binds
GP0 -> shoulder and GP1 -> elbow (see the Servos panel). Press Run: each
`inst.servo_on(pin).angle(...)` emits `SNK SERVO <pin> <deg>`, which the Robot
View maps onto the bound joint and animates live — no board required, it runs in
the simulator.
"""
import instruments as inst
import time

shoulder = inst.servo_on(0)  # GP0 -> the shoulder joint
elbow = inst.servo_on(1)  # GP1 -> the elbow joint

while True:
    for a in range(0, 181, 10):
        shoulder.angle(a)
        elbow.angle(180 - a)
        time.sleep(0.05)
    for a in range(180, -1, -10):
        shoulder.angle(a)
        elbow.angle(180 - a)
        time.sleep(0.05)
