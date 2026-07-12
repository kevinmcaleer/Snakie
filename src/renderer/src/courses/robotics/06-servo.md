## Drive a servo 🤖

A servo is a little motor that turns to an *exact* angle and holds there — perfect for a robot arm or a wiggling leg.

Your starter code:

- `Servo(PWM(Pin(0)), pin=0)` makes a servo on pin 0. PWM is the fast on/off signal that tells the servo where to point.
- `s.angle(90)` turns it to 90 degrees — halfway.
- The `for` loop steps through `0, 90, 180, 90`, pausing 600ms each time, so the servo sweeps and comes back.

### Try it

1. Make sure the simulated device is **Connected** (it usually auto-connects — check the status bar).
2. Press **Run ▶**.
3. Open the **Pose bench** and watch the servo arm swing to each angle and hold.
4. Peek at the **Board View** to see the wire from pin 0 to your servo.

### Now you

Change the angles to make a slow nod: try `(0, 45, 0, 45)`. Then make the pauses longer with `time.sleep_ms(1000)` so it moves gently. Can you get it to point straight up and stay there?

> Angles go from 0 to 180 — that's your servo's whole world. Ask for 200 and it just stops at 180!
