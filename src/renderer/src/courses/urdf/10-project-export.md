## Project: export your robot 🚀

You've built it, jointed it, and posed it. Now let's turn your robot into a real **URDF file** you can save, share, and reuse.

A URDF is just a tidy description of your robot: its parts, how they join, and how each joint moves. Snakie writes it for you.

Before exporting, give things good names so future-you understands them:

- Click each part in the **Robot View** build panel and rename blobs like `link_3` to `arm`, `base`, or `head`.
- Do the same for joints: `shoulder`, `elbow`, `wrist`.
- Double-check your joint **limits** so nothing bends the wrong way.

### Try it

1. Open the **Robot View** and select your robot's root (base) part.
2. In the build panel, tidy the part and joint names.
3. Drag a posing slider to confirm each joint still moves nicely.
4. Press **Export URDF**.
5. Watch the console — Snakie saves a clean `.urdf` into your `urdf/` folder.

### Now you

Rename one joint from something dull to something clear, then Export again. Open the new file — can you spot your name inside the URDF text?

> A URDF is your robot's recipe. Save it in `urdf/` and you can rebuild your robot any time, or share it with a friend!
