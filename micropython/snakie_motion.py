"""snakie_motion — Motion Studio runtime (#412).

Turns the Motion Studio data model into live motion: a calibrated :class:`Servo`
(pin/PWM, URDF joint binding, min/max, trim, invert, pulse calibration) and a
:class:`Rig` that runs non-blocking group moves with easing, plays sequences of
poses, and blends named puppet controls.

It imports + runs headless under **CPython** (all hardware is isolated behind the
``machine`` import inside ``instruments``), so the same code drives the 3-D preview
with no board — and its joint maths mirrors the app's ``jointToServo`` /
``servoToJoint`` (``src/shared/krf.ts``) and ``ease`` (``src/shared/robot-timeline.ts``)
exactly, so what you see on screen is what the servos do.

Poses are dicts of ``{urdf_joint: display_value}`` in the joint's own units (degrees
for a revolute joint, like ``NamedPose.values``).
"""

__version__ = "1"

import math

RAD2DEG = 180.0 / math.pi
DEG2RAD = math.pi / 180.0

DEFAULT_SERVO_MIN = 0
DEFAULT_SERVO_MAX = 180


# ── Time (MicroPython ticks / CPython fallback), guarded like instruments._sleep_ms ──
def _now_ms():
    import time

    if hasattr(time, "ticks_ms"):
        return time.ticks_ms()
    return int(time.time() * 1000)


def _diff_ms(a, b):
    import time

    if hasattr(time, "ticks_diff"):
        return time.ticks_diff(a, b)
    return a - b


def _sleep_ms(ms):
    import time

    if hasattr(time, "sleep_ms"):
        time.sleep_ms(int(ms))
    else:
        time.sleep(ms / 1000.0)


def _clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def ease(easing, u):
    """The Python twin of ``robot-timeline.ts`` ``ease`` — ``linear`` is the identity,
    everything else is the ``x*x*(3-2*x)`` smoothstep — so preview == hardware."""
    x = _clamp(u, 0.0, 1.0)
    return x if easing == "linear" else x * x * (3.0 - 2.0 * x)


def _lerp_pose(a, b, f):
    """Blend two poses (dicts) at ``f`` in 0..1 over the UNION of their joints; a joint
    present in only one side holds that value."""
    out = {}
    for k in a:
        av = a[k]
        bv = b.get(k, av)
        out[k] = av + (bv - av) * f
    for k in b:
        if k not in out:
            out[k] = b[k]  # only in b → hold (a-side missing = treat as b)
    return out


class Servo:
    """A calibrated servo bound to a URDF joint.

    ``write_joint(rad)`` maps a joint angle in **radians** to a whole servo degree
    (the Python twin of ``jointToServo``: joint-rad → display-deg → lerp over the
    servo range, ``invert``, ``trim``, clamp) and drives it. All hardware + the
    ``SNK SERVO <pin> <deg>`` telemetry live in the composed ``instruments`` servo,
    so the 3-D view mirrors it for free (#313).
    """

    def __init__(
        self,
        pin,
        joint=None,
        *,
        freq=50,
        min_us=500,
        max_us=2500,
        servo_min=DEFAULT_SERVO_MIN,
        servo_max=DEFAULT_SERVO_MAX,
        joint_min=0.0,
        joint_max=180.0,
        trim=0.0,
        invert=False,
        _servo=None,
    ):
        self.pin = pin
        self.joint = joint
        self.servo_min = servo_min
        self.servo_max = servo_max
        self.joint_min = joint_min
        self.joint_max = joint_max
        self.trim = trim
        self.invert = invert
        # Compose the telemetry/hardware servo from `instruments` (imported lazily so
        # tests can inject a fake via `_servo`). Reuses the `machine` guard + the
        # `SNK SERVO` emission — one place owns hardware.
        if _servo is not None:
            self._servo = _servo
        else:
            import instruments

            # Construct instruments.Servo directly (not servo_on) so the pulse
            # calibration min_us/max_us is honoured; it still emits SNK SERVO.
            self._servo = instruments.Servo(pin=pin, freq=freq, min_us=min_us, max_us=max_us)
        self._current_deg = 90

    @property
    def deg_per_joint_rad(self):
        """Calibration slope: servo-degrees per joint-radian (signed; negative when
        ``invert``). 0 for a zero-width joint range."""
        jspan = self.joint_max - self.joint_min  # display units (deg for revolute)
        sspan = self.servo_max - self.servo_min
        slope = 0.0 if jspan == 0 else (sspan / jspan)
        if self.invert:
            slope = -slope
        return slope * RAD2DEG

    def _servo_deg_for(self, rad):
        deg = rad * RAD2DEG  # joint radians → joint display degrees
        span = self.joint_max - self.joint_min
        t = 0.0 if span == 0 else (deg - self.joint_min) / span
        t = _clamp(t, 0.0, 1.0)
        if self.invert:
            t = 1.0 - t
        raw = self.servo_min + t * (self.servo_max - self.servo_min) + self.trim
        raw = _clamp(raw, self.servo_min, self.servo_max)  # soft servo limits
        return int(_clamp(round(raw), 0, 180))

    def write_joint(self, rad):
        """Drive the servo so its bound joint reaches ``rad`` radians. Returns the
        whole servo degree written (and emits ``SNK SERVO <pin> <deg>``)."""
        deg = self._servo_deg_for(rad)
        self._servo.angle(deg)
        self._current_deg = deg
        return deg

    @property
    def current_deg(self):
        """The last servo degree written."""
        return self._current_deg

    def joint_display(self):
        """The current joint value in DISPLAY units (deg) — the ``servoToJoint`` twin
        of the current servo degree."""
        span = self.servo_max - self.servo_min
        t = 0.0 if span == 0 else (self._current_deg - self.servo_min) / span
        t = _clamp(t, 0.0, 1.0)
        if self.invert:
            t = 1.0 - t
        return self.joint_min + t * (self.joint_max - self.joint_min)

    def joint_radians(self):
        """The current joint value in radians — ``servoToJoint`` + ``toNative``."""
        return self.joint_display() * DEG2RAD


class Rig:
    """A named group of servos driven together: non-blocking group moves (``goto_pose``),
    pose sequences (``play``) and blended puppet controls (``set_control``). Tick it with
    ``update()`` in your loop, or hand off to the blocking ``run()`` driver."""

    def __init__(self, servos, *, hz=50, controls=None):
        # servos: name -> Servo (a joint may be driven by >1 pin via distinct names).
        self._servos = dict(servos)
        self.hz = hz
        self._controls = dict(controls) if controls else {}
        self._move = None  # {"start":{name:disp}, "target":{name:disp}, "t0", "dur_ms", "easing"}
        self._seq = None
        self._loop = False
        self._step = 0

    def servos(self):
        return self._servos

    def add_control(self, name, poses):
        """Register a puppet control: a list of poses blended by a 0..1 slider."""
        self._controls[name] = list(poses)

    # ── Group move ────────────────────────────────────────────────────────────
    def goto_pose(self, pose, duration=0.5, easing="easeInOut"):
        """Begin a NON-BLOCKING move of every servo toward ``pose`` (a
        ``{joint: display}`` dict) over ``duration`` seconds. Records intent only;
        the interpolation happens inside ``update()``. A joint absent from ``pose``
        holds its current value (partial poses)."""
        start = {}
        target = {}
        for name, servo in self._servos.items():
            cur = servo.joint_display()
            start[name] = cur
            j = servo.joint
            target[name] = pose.get(j, cur) if j is not None else cur
        self._move = {
            "start": start,
            "target": target,
            "t0": _now_ms(),
            "dur_ms": max(0.0, duration * 1000.0),
            "easing": easing,
        }
        self._apply(0.0)

    def _apply(self, e):
        for name, servo in self._servos.items():
            s = self._move["start"][name]
            t = self._move["target"][name]
            servo.write_joint((s + (t - s) * e) * DEG2RAD)

    # ── Sequence ──────────────────────────────────────────────────────────────
    def play(self, sequence, loop=False):
        """Queue a list of ``(pose, duration_ms[, easing])`` steps; ``update()``
        advances through them (``loop`` wraps). Replaces any active sequence/move."""
        self._seq = list(sequence)
        self._loop = loop
        self._step = 0
        self._move = None
        if self._seq:
            self._start_step(0, _now_ms())

    def _start_step(self, i, now):
        step = self._seq[i]
        pose = step[0]
        dur_ms = step[1] if len(step) > 1 else 500
        easing = step[2] if len(step) > 2 else "easeInOut"
        self.goto_pose(pose, duration=dur_ms / 1000.0, easing=easing)
        self._move["t0"] = now  # continuous timing across steps

    # ── Puppet control (blend) ────────────────────────────────────────────────
    def set_control(self, name, t):
        """Blend a registered control's poses at ``t`` in 0..1 and apply it AT ONCE — a
        puppet slider is instantaneous. N poses span N-1 segments (e.g.
        frown→neutral→smile). Overrides any in-flight move."""
        poses = self._controls.get(name)
        if not poses:
            return
        n = len(poses)
        if n == 1:
            blended = poses[0]
        else:
            tt = _clamp(t, 0.0, 1.0)
            seg = tt * (n - 1)
            i = int(seg)
            if i >= n - 1:
                i = n - 2
            blended = _lerp_pose(poses[i], poses[i + 1], seg - i)
        self._move = None  # a live slider overrides any active goto/sequence move
        self._seq = None
        for servo in self._servos.values():
            j = servo.joint
            if j is not None and j in blended:
                servo.write_joint(blended[j] * DEG2RAD)

    # ── Tick / run ────────────────────────────────────────────────────────────
    def update(self, now=None):
        """Advance the active move/sequence, writing every servo. Returns whether
        motion is still in progress. Safe to call every loop."""
        if self._move is None:
            return False
        now = _now_ms() if now is None else now
        m = self._move
        u = 1.0 if m["dur_ms"] <= 0 else _clamp(_diff_ms(now, m["t0"]) / m["dur_ms"], 0.0, 1.0)
        self._apply(ease(m["easing"], u))
        if u < 1.0:
            return True
        # This move finished — advance the sequence, if any.
        self._move = None
        if self._seq is not None:
            self._step += 1
            if self._step < len(self._seq):
                self._start_step(self._step, now)
                return True
            if self._loop:
                self._step = 0
                self._start_step(0, now)
                return True
            self._seq = None
        return False

    def run(self, hz=None):
        """Blocking convenience driver: tick ``update()`` forever at ``hz``. Use as
        your ``while True:`` loop on-device."""
        hz = hz or self.hz
        dt = max(1, int(1000 / hz))
        while True:
            self.update()
            _sleep_ms(dt)

    # ── State (for Capture Pose + the 3-D mirror) ─────────────────────────────
    def snapshot(self):
        """Current pose as ``{joint: display_value}`` (rounded like ``NamedPose.values``),
        for Capture Pose."""
        pose = {}
        for servo in self._servos.values():
            if servo.joint is not None:
                pose[servo.joint] = round(servo.joint_display(), 2)
        return pose

    def joint_state(self):
        """Current ``{urdf_joint: radians}`` feed for the 3-D view to mirror the robot
        (the ``servoToJoint`` + ``toNative`` inverse per bound servo)."""
        state = {}
        for servo in self._servos.values():
            if servo.joint is not None:
                state[servo.joint] = servo.joint_radians()
        return state
