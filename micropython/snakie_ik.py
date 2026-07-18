"""snakie_ik — on-device inverse-kinematics runtime (epic #533 §4, #539).

A faithful MicroPython mirror of the shared TypeScript solver in
``src/shared/ik/`` (#538). The two implementations are verified against the SAME
language-neutral vectors (``test/fixtures/ik-vectors.json``) so a goal posed in
the browser's Robot View and a goal posed in code on a Pico produce identical
joint angles.

Two layers:

* A **pure planar solver** (`solve_ik`) — law-of-cosines for 1/2-bone chains,
  FABRIK + CCD + analytic two-group fallback for 3+ bones — that consumes plain
  numbers and returns a plain dict, matching the shared `IkResult`. This is the
  cross-language contract; it allocates little and uses only `math`, so it runs
  on a Pico.
* A thin **`Skeleton`** helper that loads the auto-generated ``skeleton.json``
  (#537 schema, `schema_version` 1), turns a named joint chain into bone
  lengths + limits, solves it, and drives the bound servos through the existing
  ``snakie_motion`` rig where one is present.

Runs UNMODIFIED on CPython (the Snakie simulator) and on MicroPython: all
hardware lives behind ``snakie_motion`` / ``instruments``, which guard their
``machine`` import, so importing this module never touches hardware. Only
`math` and `json` (both present on CPython and MicroPython) are used.

Conventions (identical to the shared solver — see ``src/shared/ik/README.md``):

* Chains are planar (XY plane); the base joint is pinned at the origin.
* ``angles[i]`` is the RELATIVE angle (radians) of joint i; the absolute heading
  of bone i is ``angles[0] + ... + angles[i]``. Heading 0 points +X, positive
  angles turn counter-clockwise.
* Angles are normalised to the half-open interval [-PI, PI).
* Joint limits are inclusive ``[min, max]`` on the relative angle, ``-PI <= min
  <= max <= PI``; ``None`` means unlimited. Returned angles are ALWAYS inside
  the limits.
"""

__version__ = "1"

import math

PI = math.pi
TWO_PI = 2.0 * math.pi

# Geometric slack for reach classification (NOT the solve tolerance).
REACH_EPS = 1e-9
# Slack when testing whether an angle sits within its limit.
LIMIT_EPS = 1e-9

DEFAULT_TOLERANCE = 1e-4
DEFAULT_MAX_ITERATIONS = 64

RAD2DEG = 180.0 / math.pi
DEG2RAD = math.pi / 180.0


# ---------------------------------------------------------------------------
# Pure math helpers — mirror src/shared/ik/common.ts
# ---------------------------------------------------------------------------


def wrap_to_pi(a):
    """Normalise an angle to the half-open interval [-PI, PI)."""
    r = (a + PI) % TWO_PI
    if r < 0:  # MicroPython/CPython % of a positive divisor is >= 0; belt & braces.
        r += TWO_PI
    return r - PI


def _clamp(x, lo, hi):
    """Clamp ``x`` into ``[lo, hi]``."""
    return lo if x < lo else hi if x > hi else x


def _limit_of(limits, i):
    """Effective ``(min, max)`` for joint i (full range when free/None)."""
    if limits is None:
        return (-PI, PI)
    lim = limits[i] if i < len(limits) else None
    if lim is None:
        return (-PI, PI)
    return (lim[0], lim[1])


def clamp_angles(limits, angles):
    """Wrap then clamp every angle into its joint limit; returns a new list."""
    out = []
    for i in range(len(angles)):
        lo, hi = _limit_of(limits, i)
        out.append(_clamp(wrap_to_pi(angles[i]), lo, hi))
    return out


def within_limits(limits, angles):
    """True when every angle already sits inside its limit (with slack)."""
    for i in range(len(angles)):
        lo, hi = _limit_of(limits, i)
        a = angles[i]
        if a < lo - LIMIT_EPS or a > hi + LIMIT_EPS:
            return False
    return True


def joint_positions(bone_lengths, angles):
    """Joint positions ``[p0 ... pN]`` for the given relative angles.

    ``p0`` is the base at the origin; ``pN`` is the end effector.
    """
    pts = [(0.0, 0.0)]
    heading = 0.0
    x = 0.0
    y = 0.0
    for i in range(len(bone_lengths)):
        heading += angles[i]
        x += bone_lengths[i] * math.cos(heading)
        y += bone_lengths[i] * math.sin(heading)
        pts.append((x, y))
    return pts


def forward_kinematics(bone_lengths, angles):
    """End-effector position ``(x, y)`` only."""
    pts = joint_positions(bone_lengths, angles)
    return pts[-1]


def _distance(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def _hypot(x, y):
    return math.sqrt(x * x + y * y)


def angles_from_positions(points):
    """Convert joint positions back to relative angles (inverse of
    :func:`joint_positions`). Zero-length segments keep the previous heading so
    the conversion never produces NaN."""
    angles = []
    prev_heading = 0.0
    for i in range(len(points) - 1):
        dx = points[i + 1][0] - points[i][0]
        dy = points[i + 1][1] - points[i][1]
        heading = prev_heading if _hypot(dx, dy) < 1e-12 else math.atan2(dy, dx)
        angles.append(wrap_to_pi(heading - prev_heading))
        prev_heading = heading
    return angles


def pose_distance(a, b):
    """Sum of absolute wrapped per-joint differences — a pose "distance"."""
    s = 0.0
    for i in range(len(a)):
        s += abs(wrap_to_pi(a[i] - b[i]))
    return s


def validate_chain(bone_lengths, limits=None, current_angles=None):
    """Validate a chain, raising ``ValueError`` with a stable code on bad input:
    ``invalid_chain`` (empty), ``invalid_bone_length`` (zero/negative/non-finite),
    ``invalid_limits`` (length mismatch, ``min > max``, outside [-PI, PI]),
    ``invalid_angles`` (``current_angles`` length mismatch). The codes match the
    shared solver exactly, so the same test vectors assert them."""
    n = len(bone_lengths)
    if n == 0:
        raise ValueError("invalid_chain")
    for length in bone_lengths:
        if not _is_finite(length) or length <= 0:
            raise ValueError("invalid_bone_length")
    if limits is not None:
        if len(limits) != n:
            raise ValueError("invalid_limits")
        for lim in limits:
            if lim is None:
                continue
            lo, hi = lim[0], lim[1]
            if not _is_finite(lo) or not _is_finite(hi):
                raise ValueError("invalid_limits")
            if lo > hi or lo < -PI - LIMIT_EPS or hi > PI + LIMIT_EPS:
                raise ValueError("invalid_limits")
    if current_angles is not None and len(current_angles) != n:
        raise ValueError("invalid_angles")


def _is_finite(x):
    """``math.isfinite`` exists on CPython + modern MicroPython; fall back for
    older ports (NaN != NaN; Inf overflows the sum)."""
    try:
        return math.isfinite(x)
    except AttributeError:  # pragma: no cover - ancient MicroPython
        return x == x and x not in (float("inf"), float("-inf"))


# ---------------------------------------------------------------------------
# Analytical solvers — mirror src/shared/ik/two-bone.ts
# ---------------------------------------------------------------------------


def _result(status, angles, position, error, iterations):
    """Build an IkResult-shaped dict (mirrors the shared solver's return)."""
    return {
        "status": status,
        "angles": angles,
        "position": position,
        "error": error,
        "iterations": iterations,
    }


def _make_candidate(bone_lengths, limits, raw, target):
    """Wrap+clamp a raw pose and score it (mirrors two-bone.ts makeCandidate)."""
    wrapped = [wrap_to_pi(a) for a in raw]
    free = within_limits(limits, wrapped)
    angles = clamp_angles(limits, wrapped)
    position = forward_kinematics(bone_lengths, angles)
    error = _distance(position, target)
    return {"angles": angles, "error": error, "position": position, "free": free}


def _finish(best, tolerance, geometrically_reachable):
    if best["error"] <= tolerance:
        status = "reached"
    elif not geometrically_reachable:
        status = "out_of_reach"
    else:
        status = "blocked_by_limits"
    return _result(status, best["angles"], best["position"], best["error"], 0)


def solve_one_bone(bone_lengths, limits, target, current_angles, tolerance):
    """1-bone chain: aim straight at the target; reachable only on the circle."""
    L = bone_lengths[0]
    d = _hypot(target[0], target[1])
    # A target at the exact origin keeps the current heading.
    raw = [current_angles[0] if d < 1e-12 else math.atan2(target[1], target[0])]
    cand = _make_candidate(bone_lengths, limits, raw, target)
    reachable = abs(d - L) <= tolerance + REACH_EPS
    return _finish(cand, tolerance, reachable)


def solve_two_bone(bone_lengths, limits, target, current_angles, tolerance):
    """Exact 2-bone (two-link planar) law-of-cosines solver.

    ``+acos`` candidate is A, ``-acos`` is B. (1) If exactly one satisfies the
    limits, take it. (2) If both do, take the one closest to the current pose
    (tie -> A). (3) If neither does, clamp both and take the smaller FK error,
    then closest to current, then A."""
    L1 = bone_lengths[0]
    L2 = bone_lengths[1]
    tx = target[0]
    ty = target[1]
    d = _hypot(tx, ty)
    outer = L1 + L2
    inner = abs(L1 - L2)
    geometrically_reachable = d <= outer + REACH_EPS and d >= inner - REACH_EPS

    cos_t2 = _clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1.0, 1.0)
    t2 = math.acos(cos_t2)
    heading = math.atan2(ty, tx)  # atan2(0, 0) == 0 for a target at the base

    candidates = []
    for elbow in (t2, -t2):
        t1 = heading - math.atan2(L2 * math.sin(elbow), L1 + L2 * math.cos(elbow))
        candidates.append(_make_candidate(bone_lengths, limits, [t1, elbow], target))
    a, b = candidates

    if a["free"] != b["free"]:
        best = a if a["free"] else b
    elif a["free"]:
        # Both satisfy limits: prefer the pose closest to the current one.
        if pose_distance(b["angles"], current_angles) < pose_distance(a["angles"], current_angles) - 1e-12:
            best = b
        else:
            best = a
    else:
        # Neither satisfies limits: smaller clamped FK error, then closest, then A.
        if b["error"] < a["error"] - 1e-12:
            best = b
        elif a["error"] < b["error"] - 1e-12:
            best = a
        elif pose_distance(b["angles"], current_angles) < pose_distance(a["angles"], current_angles) - 1e-12:
            best = b
        else:
            best = a
    return _finish(best, tolerance, geometrically_reachable)


# ---------------------------------------------------------------------------
# FABRIK solver — mirror src/shared/ik/fabrik.ts
# ---------------------------------------------------------------------------


def _place(to, frm, length):
    """Move from ``frm`` towards ``to``, landing exactly ``length`` from ``to``."""
    dx = frm[0] - to[0]
    dy = frm[1] - to[1]
    r = _hypot(dx, dy)
    if r < 1e-12:
        return (to[0] + length, to[1])  # degenerate: pick +X
    s = length / r
    return (to[0] + dx * s, to[1] + dy * s)


def _project_to_limits(bone_lengths, limits, points):
    """Project joint positions onto the joint limits; returns (angles, points)."""
    angles = clamp_angles(limits, angles_from_positions(points))
    return angles, joint_positions(bone_lengths, angles)


def _run_passes(bone_lengths, limits, target, seed, tolerance, max_iterations):
    """Phases 1-2: FABRIK iterations then CCD refinement, from ``seed`` angles."""
    n = len(bone_lengths)
    angles = clamp_angles(limits, seed)
    points = joint_positions(bone_lengths, angles)
    error = _distance(points[n], target)
    iterations = 0

    # Phase 1 — FABRIK backward/forward passes with limit projection.
    while error > tolerance and iterations < max_iterations:
        iterations += 1
        back = [None] * (n + 1)
        back[n] = (target[0], target[1])
        for i in range(n - 1, -1, -1):
            back[i] = _place(back[i + 1], points[i], bone_lengths[i])
        fwd = [None] * (n + 1)
        fwd[0] = (0.0, 0.0)
        for i in range(n):
            fwd[i + 1] = _place(fwd[i], back[i + 1], bone_lengths[i])
        angles, points = _project_to_limits(bone_lengths, limits, fwd)
        error = _distance(points[n], target)

    # Phase 2 — CCD refinement (helps near-boundary + limit-pinned poses).
    sweeps = 0
    while error > tolerance and sweeps < max_iterations:
        sweeps += 1
        for j in range(n - 1, -1, -1):
            pivot = points[j]
            eff = points[n]
            to_eff = _hypot(eff[0] - pivot[0], eff[1] - pivot[1])
            to_target = _hypot(target[0] - pivot[0], target[1] - pivot[1])
            if to_eff < 1e-12 or to_target < 1e-12:
                continue  # undefined rotation
            delta = wrap_to_pi(
                math.atan2(target[1] - pivot[1], target[0] - pivot[0])
                - math.atan2(eff[1] - pivot[1], eff[0] - pivot[0])
            )
            lo, hi = _limit_of(limits, j)
            angles[j] = _clamp(wrap_to_pi(angles[j] + delta), lo, hi)
            points = joint_positions(bone_lengths, angles)
        new_error = _distance(points[n], target)
        improved = new_error < error - 1e-15
        error = new_error
        if not improved:
            break  # stalled — local minimum (or done)

    return {
        "angles": angles,
        "position": points[n],
        "error": error,
        "iterations": iterations + sweeps,
    }


def _two_group_candidate(bone_lengths, limits, target, tolerance):
    """Phase 3 — exact two-group reduction: straight segment A (first k bones)
    and B (the rest) solved as a 2-bone arm. Returns the first clamped candidate
    that reaches (<= tolerance), else the best found, or None."""
    n = len(bone_lengths)
    d = _hypot(target[0], target[1])
    heading = math.atan2(target[1], target[0])
    best = None
    for k in range(1, n):
        A = 0.0
        for i in range(k):
            A += bone_lengths[i]
        B = 0.0
        for i in range(k, n):
            B += bone_lengths[i]
        if d > A + B + REACH_EPS or d < abs(A - B) - REACH_EPS:
            continue
        cos_t2 = _clamp((d * d - A * A - B * B) / (2 * A * B), -1.0, 1.0)
        t2 = math.acos(cos_t2)
        for elbow in (t2, -t2):
            t1 = heading - math.atan2(B * math.sin(elbow), A + B * math.cos(elbow))
            raw = [0.0] * n
            raw[0] = t1
            raw[k] = elbow
            angles = clamp_angles(limits, raw)
            points = joint_positions(bone_lengths, angles)
            error = _distance(points[n], target)
            attempt = {"angles": angles, "position": points[n], "error": error, "iterations": 0}
            if error <= tolerance:
                return attempt
            if best is None or error < best["error"]:
                best = attempt
    return best


def solve_fabrik(bone_lengths, limits, target, current_angles, tolerance, max_iterations):
    """FABRIK + CCD + analytic two-group fallback + perturbed-seed retry, for
    chains of 3+ bones. Deterministic pipeline mirroring fabrik.ts."""
    n = len(bone_lengths)
    total_length = 0.0
    for length in bone_lengths:
        total_length += length
    d = _hypot(target[0], target[1])

    if d > total_length + REACH_EPS:
        # Phase 0 — unreachable: stretch every bone straight at the target, then
        # project onto the limits once — the best-effort "point at it" pose.
        stretched = [(0.0, 0.0)]
        for i in range(n):
            p = stretched[i]
            r = _hypot(target[0] - p[0], target[1] - p[1])
            s = 0.0 if r < 1e-12 else bone_lengths[i] / r
            stretched.append((p[0] + (target[0] - p[0]) * s, p[1] + (target[1] - p[1]) * s))
        angles, points = _project_to_limits(bone_lengths, limits, stretched)
        position = points[n]
        return _result("out_of_reach", angles, position, _distance(position, target), 0)

    # Phases 1-2 from the current pose.
    best = _run_passes(bone_lengths, limits, target, current_angles, tolerance, max_iterations)

    # Phase 3 — analytic two-group fallback.
    if best["error"] > tolerance:
        cand = _two_group_candidate(bone_lengths, limits, target, tolerance)
        if cand is not None and cand["error"] < best["error"]:
            cand["iterations"] = best["iterations"]
            best = cand

    # Phase 4 — retry from a deterministic bent seed (escapes singular seeds).
    if best["error"] > tolerance:
        bent_seed = [
            wrap_to_pi(current_angles[i] + (0.5 if i % 2 == 0 else -0.5))
            for i in range(len(current_angles))
        ]
        retry = _run_passes(bone_lengths, limits, target, bent_seed, tolerance, max_iterations)
        if retry["error"] < best["error"]:
            retry["iterations"] = best["iterations"] + retry["iterations"]
            best = retry

    status = "reached" if best["error"] <= tolerance else "blocked_by_limits"
    return _result(status, best["angles"], best["position"], best["error"], best["iterations"])


# ---------------------------------------------------------------------------
# Public solver entry point — mirror src/shared/ik/index.ts solveIk
# ---------------------------------------------------------------------------


def solve_ik(
    bone_lengths,
    target,
    limits=None,
    current_angles=None,
    tolerance=DEFAULT_TOLERANCE,
    max_iterations=DEFAULT_MAX_ITERATIONS,
):
    """Solve a planar chain for ``target``.

    Raises ``ValueError`` with one of ``invalid_chain`` / ``invalid_bone_length``
    / ``invalid_limits`` / ``invalid_angles`` on bad input; otherwise always
    returns a limit-respecting pose plus a status. Dispatch by bone count:
    1 -> analytical aim, 2 -> exact law-of-cosines, 3+ -> FABRIK.

    Returns a dict ``{status, angles, position, error, iterations}`` mirroring the
    shared solver's ``IkResult``. ``status`` is ``reached`` / ``out_of_reach`` /
    ``blocked_by_limits``."""
    validate_chain(bone_lengths, limits, current_angles)
    n = len(bone_lengths)
    current = list(current_angles) if current_angles is not None else [0.0] * n

    if n == 1:
        return solve_one_bone(bone_lengths, limits, target, current, tolerance)
    if n == 2:
        return solve_two_bone(bone_lengths, limits, target, current, tolerance)
    return solve_fabrik(bone_lengths, limits, target, current, tolerance, max_iterations)


# ---------------------------------------------------------------------------
# Skeleton — loads skeleton.json (#537) and drives the snakie_motion rig
# ---------------------------------------------------------------------------


class ServoBinding:
    """A joint's servo binding parsed from ``skeleton.json`` (pin + calibration).

    Mirrors ``SkeletonServo`` in ``src/shared/skeleton.ts``: ``pin`` is the bare
    GPIO string (e.g. ``"16"``), the sweep maps ``[servo_min, servo_max]`` deg
    onto the joint range ``[joint_min, joint_max]`` (deg for revolute, mm for
    prismatic), optionally inverted."""

    def __init__(self, pin, servo_min=0, servo_max=180, joint_min=0.0, joint_max=180.0, invert=False):
        self.pin = pin
        self.servo_min = servo_min
        self.servo_max = servo_max
        self.joint_min = joint_min
        self.joint_max = joint_max
        self.invert = invert

    @classmethod
    def from_dict(cls, data):
        return cls(
            pin=str(data.get("pin", "")),
            servo_min=data.get("servo_min", 0),
            servo_max=data.get("servo_max", 180),
            joint_min=data.get("joint_min", 0.0),
            joint_max=data.get("joint_max", 180.0),
            invert=bool(data.get("invert", False)),
        )


class Joint:
    """One skeleton joint (mirrors ``SkeletonJoint`` in skeleton.ts)."""

    def __init__(self, data):
        self.name = data.get("name", "")
        self.type = data.get("type", "fixed")
        self.parent = data.get("parent", "")
        self.child = data.get("child", "")
        self.origin_xyz = list(data.get("origin_xyz", [0.0, 0.0, 0.0]))
        self.origin_rpy = list(data.get("origin_rpy", [0.0, 0.0, 0.0]))
        self.bone_length_mm = data.get("bone_length_mm", 0.0)
        self.axis = list(data["axis"]) if data.get("axis") is not None else None
        lim = data.get("limits")
        self.limits = {"min": lim["min"], "max": lim["max"]} if lim else None
        self.servo = ServoBinding.from_dict(data["servo"]) if data.get("servo") else None
        self.mimic = data.get("mimic")

    @property
    def is_rotational(self):
        return self.type in ("revolute", "continuous")

    def limit_radians(self):
        """The joint's ``<limit>`` as a relative-angle ``(min, max)`` in radians,
        or ``None`` when free. Revolute/continuous limits are stored in degrees
        (skeleton.ts display units); a continuous joint or a joint with no limit
        is unconstrained. Non-rotational (prismatic/fixed) joints have no angular
        limit here."""
        if not self.is_rotational or self.type == "continuous" or self.limits is None:
            return None
        return (self.limits["min"] * DEG2RAD, self.limits["max"] * DEG2RAD)


class Skeleton:
    """The device-side skeleton: bones, joint limits and servo bindings loaded
    from the auto-generated ``skeleton.json`` (#537 schema, ``schema_version`` 1).

    ``Skeleton.load("skeleton.json")`` parses the file; ``solve(chain,
    target_xyz)`` turns a named joint chain into joint angles via the shared
    solver; ``apply(angles)`` drives the bound servos through the
    ``snakie_motion`` rig where one is present."""

    def __init__(self, doc):
        self.schema_version = doc.get("schema_version", 0)
        self.urdf_hash = doc.get("urdf_hash", "")
        self.robot = doc.get("robot", "")
        self.joints = [Joint(j) for j in doc.get("joints", [])]
        self.joints_by_name = {}
        for j in self.joints:
            # First occurrence wins (matches the generator's dedupe by name).
            if j.name not in self.joints_by_name:
                self.joints_by_name[j.name] = j
        self.links = dict(doc.get("links", {}))
        self._last_chain = None
        self._rig = None

    # ── Loading ──────────────────────────────────────────────────────────────
    @classmethod
    def load(cls, path):
        """Load a skeleton from a ``skeleton.json`` file path."""
        import json

        with open(path) as fh:
            return cls(json.load(fh))

    @classmethod
    def from_json(cls, text):
        """Load a skeleton from a JSON string."""
        import json

        return cls(json.loads(text))

    @classmethod
    def from_dict(cls, doc):
        """Load a skeleton from an already-parsed document dict."""
        return cls(doc)

    # ── Chain geometry ───────────────────────────────────────────────────────
    def joint(self, name):
        """The :class:`Joint` named ``name`` (KeyError if unknown)."""
        return self.joints_by_name[name]

    def chain_bone_lengths(self, chain):
        """Bone lengths (mm) for a chain of joint names.

        A chain ``[j0, j1, ..., jN]`` has ``N`` bones; bone i spans joint i ->
        joint i+1 and its length is ``bone_length_mm`` of joint i+1 (which the
        #537 schema stores as the distance from a joint's parent origin to its
        own origin). Joints ``j0..jN-1`` are the actuated joints; ``jN`` is the
        tip that closes the last bone."""
        lengths = []
        for i in range(1, len(chain)):
            lengths.append(self.joints_by_name[chain[i]].bone_length_mm)
        return lengths

    def chain_limits(self, chain):
        """Per-bone limits (radians relative angle) for a chain: one entry per
        bone, taken from the actuated joint at the base of that bone. ``None``
        for a free / continuous joint."""
        limits = []
        for i in range(len(chain) - 1):
            limits.append(self.joints_by_name[chain[i]].limit_radians())
        # All-free collapses to None so the solver skips limit handling entirely.
        if all(l is None for l in limits):
            return None
        return limits

    # ── Solve ────────────────────────────────────────────────────────────────
    def solve(self, chain, target_xyz, current_angles=None, tolerance=DEFAULT_TOLERANCE, max_iterations=DEFAULT_MAX_ITERATIONS):
        """Solve the named ``chain`` for ``target_xyz`` (mm), returning the shared
        solver's result dict ``{status, angles, position, error, iterations}``.

        ``chain`` is a list of joint names ``[base, ..., tip]``; there is one
        returned angle per actuated joint (``len(chain) - 1``). The solve is
        planar in the XY plane (epic §3): ``target_xyz`` may be a 2- or 3-vector
        and only its X/Y are used, matching the shared 2D solver. The last chain
        is remembered so :meth:`apply` can map angles back to joints."""
        bone_lengths = self.chain_bone_lengths(chain)
        limits = self.chain_limits(chain)
        target = (target_xyz[0], target_xyz[1])
        self._last_chain = list(chain)
        return solve_ik(
            bone_lengths,
            target,
            limits=limits,
            current_angles=current_angles,
            tolerance=tolerance,
            max_iterations=max_iterations,
        )

    # ── Drive servos ─────────────────────────────────────────────────────────
    def build_rig(self):
        """Build a ``snakie_motion.Rig`` from this skeleton's bound servos, or
        return ``None`` when ``snakie_motion`` isn't importable (no rig). Each
        bound joint becomes a calibrated ``snakie_motion.Servo`` keyed by joint
        name, so :meth:`apply` and the whole Motion Studio runtime share one
        servo layer + the ``machine`` guard."""
        try:
            import snakie_motion
        except ImportError:  # pragma: no cover - exercised via degrade path
            return None
        servos = {}
        for j in self.joints:
            sb = j.servo
            if sb is None:
                continue
            servos[j.name] = snakie_motion.Servo(
                sb.pin,
                joint=j.name,
                servo_min=sb.servo_min,
                servo_max=sb.servo_max,
                joint_min=sb.joint_min,
                joint_max=sb.joint_max,
                invert=sb.invert,
            )
        if not servos:
            return None
        return snakie_motion.Rig(servos)

    def _servo_map(self, rig):
        """Map joint name -> servo from a rig (``snakie_motion.Rig``-shaped: a
        ``.servos()`` returning name->servo where each servo has ``.joint`` and
        ``.write_joint(rad)``). Also accepts a plain ``{joint: servo}`` dict."""
        servos = {}
        if rig is None:
            return servos
        pool = rig.servos() if hasattr(rig, "servos") else rig
        for entry in pool.values():
            joint = getattr(entry, "joint", None)
            if joint is not None:
                servos[joint] = entry
        return servos

    def apply(self, angles, chain=None, rig=None):
        """Drive the bound servos so each actuated joint reaches its solved angle.

        ``angles`` are RELATIVE joint angles in radians (as returned by
        :meth:`solve`), paired with ``chain`` (defaults to the last solved
        chain). Uses ``rig`` when given, else the skeleton's own
        ``snakie_motion`` rig (built lazily); if no rig can be built (no
        ``snakie_motion``, or nothing bound) it degrades to a no-op. Returns the
        list of joint names actually driven."""
        chain = chain if chain is not None else self._last_chain
        if chain is None:
            return []
        if rig is None:
            if self._rig is None:
                self._rig = self.build_rig()
            rig = self._rig
        servos = self._servo_map(rig)
        if not servos:
            return []
        driven = []
        # chain[i] is the actuated joint that owns bone i / angles[i]; the final
        # tip joint has no angle, so zip naturally drops it.
        for i in range(min(len(angles), len(chain))):
            servo = servos.get(chain[i])
            if servo is not None:
                servo.write_joint(angles[i])
                driven.append(chain[i])
        return driven
