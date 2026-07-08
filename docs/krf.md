# KRF — Kev's Robot File

KRF is Snakie's standard folder layout for a **robot project**: the wiring, the
MicroPython code, and the 3D model, together in one folder that the Board View
and Robot View (epic #309) both understand.

```
my-robot/
├── robot.yml      # manifest: wiring + the robot MODEL (below)
├── code/          # MicroPython source
├── urdf/          # .urdf + meshes/ (STL, DAE)
└── stl/           # 3D-printable files
```

`New Robot Project` in Snakie scaffolds this structure; Robot View
auto-discovers `robot.yml` in the workspace root.

## `robot.yml`

`robot.yml` already describes the board + placed parts + wiring (see
`src/shared/robot.ts`). KRF adds an **optional** `robot:` section for the 3D
model — a legacy wiring-only `robot.yml` is unaffected (every new field is
optional and validated corruption-safe).

```yaml
name: My Robot
board: pico2w
parts: [...]          # existing wiring
connections: [...]    # existing wiring

robot:                # ← the KRF robot MODEL (optional)
  version: 1
  urdf: urdf/robot.urdf
  servoJointMap:      # servo pin ↔ URDF joint, with angle calibration
    - pin: GP0
      joint: shoulder
      servoMin: 0     # servo input sweep (deg) — default 0..180
      servoMax: 180
      jointMin: -90   # joint output range (deg for revolute, mm for prismatic)
      jointMax: 90
      invert: false
  joints:             # per-joint limit overrides (edited in the pose tool)
    shoulder: { min: -80, max: 80 }
  defaultPose:        # applied on load
    shoulder: 0
  poses:              # saved named poses
    - name: home
      values: { shoulder: 0 }
```

### Pose tool (#312)

Opening a robot's `.urdf` full-screen shows the **pose tool** — a slider per
movable joint (degrees for revolute, mm for prismatic) that drives the model
within its URDF limits. `<mimic>` joints follow their master (`multiplier *
master + offset`). Editing a joint's min/max writes an override into
`robot.joints`; saving a named pose appends to `robot.poses`; both persist here
(display units — deg/mm). A measure tool reports the distance between two clicked
points. The `robot.yml` (de)serialiser round-trips this whole `robot:` section.

### Servo → joint mapping (#313)

A running program's servo write drives the mapped joint — **headless**, in the
simulator, no board required. The servo angle is clamped to `servoMin..servoMax`,
optionally inverted, and lerped onto `jointMin..jointMax` (`servoToJoint` in
`src/shared/krf.ts`; tests in `test/krf.test.ts`).

Bind a pin to a joint in the pose tool's **Servos** panel (calibration + invert);
it persists here as `servoJointMap`. In code, use one servo per joint::

    import instruments as inst
    shoulder = inst.servo_on(0)   # GP0
    elbow = inst.servo_on(1)      # GP1
    shoulder.angle(90)            # -> SNK SERVO 0 90 -> the joint bound to pin 0 moves

`inst.servo_on(pin).angle(deg)` emits pin-keyed `SNK SERVO <pin> <deg>`
telemetry, which Robot View parses and maps onto the bound joint in real time —
so the same code animates the 3-D model (simulator) and drives real servos on a
board. Worked example: `examples/servo-arm/` (open `arm.urdf`, Run `sweep.py`).

## Meshes (#319)

A URDF's `<visual>`/`<geometry>` can reference **STL** or **DAE (Collada)** mesh
files instead of primitives. Robot View loads them straight from the project
folder — no web server:

- **Relative** paths (`meshes/base.stl`) resolve against the URDF's own folder.
- **`package://<pkg>/rest`** paths resolve `<pkg>` to that same folder, so
  `package://my-robot/meshes/link.stl` → `<urdf-folder>/meshes/link.stl`.

Meshes are read through the app's filesystem (binary-safe for STL), the URDF
`<material>` colour is applied to meshes that carry none, and the camera reframes
once they load. A mesh that can't be read degrades to a small placeholder plus a
note in the panel — the rest of the robot still renders. `.obj`/`.glb` and other
formats aren't loaded yet (they show a placeholder). See
`examples/mesh-demo/mesh-demo.urdf` for a zero-setup example.

**Importing a mesh (#324).** The pose tool's **Assembly** panel has a **+ STL**
button: pick an `.stl`/`.dae` and Snakie copies it into `<urdf-folder>/meshes/`
(never overwriting — it appends `-1`, `-2`, …) and appends a new `<link>` (with
that `<mesh>`) plus a fixed `<joint>` onto the root link, so it shows in the model
straight away. The assembly panel lists every link + the mesh file it uses.

## Motion timeline (#314)

The pose tool has a bottom **timeline** dock — choreograph a motion and export it
as MicroPython. It persists in the `robot:` section as `timeline` (+ `mirror`):

```yaml
robot:
  timeline:
    duration: 1.2       # loop length, seconds
    easing: easeInOut   # linear | easeInOut (interpolation between keys)
    loop: true          # preview loop + exported `while True`
    fps: 20             # preview + export sample rate
    tracks:             # one keyframe track per movable (non-mimic) joint
      - joint: hip_left
        keys: [ { t: 0, value: -30 }, { t: 0.6, value: 30 }, { t: 1.2, value: -30 } ]
  mirror:               # left↔right pairs (seeded from joint names, editable)
    - { a: hip_left, b: hip_right }
```

Keyframe values are DISPLAY units (deg / mm), like poses. **＋ Keyframe** snapshots
the current pose at the playhead; **＋ pose…** drops a saved pose; **Mirror** /
**Mirror ½** copy a track onto its left↔right partner (½ offsets by half a cycle —
a walk); **Export .py** bakes the eased frames into runnable code that drives
`inst.servo_on(pin).angle(...)` from the `servoJointMap` (so the same clip plays
in the simulator and on a board). Mimic joints are never keyframed (they
auto-follow). Worked example: `examples/biped/` (open `biped.urdf`).

## Versioning

`robot.version` is bumped on breaking changes; `sanitiseRobotModel` migrates /
drops unknown shapes without throwing. Current version: **1**.

## Scope

KRF is the folder + manifest contract for the Robot View epic (#309): the URDF
viewer, pose tool, servo↔joint binding, motion timeline and URDF builder all
read/write this one `robot.yml`. Physics, IK and serial-bus servos are
explicitly out of scope for now.
