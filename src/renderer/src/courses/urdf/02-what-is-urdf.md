## A robot is a URDF 🤖

Every robot you build in the Robot View is really one tidy text file called a **URDF**. It's the robot's recipe — no code to run, just parts and how they connect.

A URDF holds two kinds of things:

- **Links** — the solid parts (a body, an arm, a wheel). Each link is a shape, like a box or a cylinder.
- **Joints** — the bendy or sliding spots that hold two links together and let them move.

So a robot arm is just links (the pieces) plus joints (the elbows) written down in order.

### Try it

1. Open the **Robot View** from the activity bar.
2. In the **build panel**, add a primitive — pick a **box**. That's your first link!
3. Add a **cylinder** and use the **Join tool** to mate its face to the box. That join is a joint.
4. Spin the model with your mouse to see both parts move as one robot.

### Now you

Add a second box on top and join it. You've made a 3-link robot — all inside one URDF, with zero typing.

> Links are the bones, joints are the bendy bits — and the URDF is the whole robot written on one page.
