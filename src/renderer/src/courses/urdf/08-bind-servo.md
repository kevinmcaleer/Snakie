## Bind a servo to a joint 🤖

A joint can turn on its own with the pose slider — but a real robot uses a **servo** motor. Binding tells Snakie "this servo drives this joint," so when the servo moves, the 3-D joint moves with it.

Before you bind, you need two things ready:
- A **revolute** joint in your Robot View (the elbow, wheel, or head you built earlier).
- A **servo** wired on the breadboard, so Snakie knows which pin it lives on.

Binding links the servo's pin to the joint's name. That link gets saved right inside your robot, so it remembers next time.

### Try it

1. Open the **Parts Library** and drag a **servo** onto the breadboard in **Board View**.
2. Note the **pin** it connects to (Board View draws the wire for you).
3. Open **Robot View** and click your revolute joint to select it.
4. In the joint's panel, find **Bind servo** and pick that same pin.
5. Move the joint's **pose slider** — the servo on the board swings to match. They're linked!

### Now you

Add a **second** servo on a fresh pin and bind it to another joint. Now two motors drive two joints. Nudge both sliders — your robot moves in two places at once.

> A bound servo and joint share one number: the joint's angle *is* the servo's angle. Move one, the other follows.
