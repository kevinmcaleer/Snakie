"""Snakie Instruments — the on-device robotics telemetry + control toolkit.

Copy this file onto your MicroPython board (a Pico, etc.) and ``import`` it.
Instead of the IDE polling the board over the raw REPL (which interrupts a
running program), your program *prints* readings with these helpers and the
IDE *parses the serial stream* — so it works non-invasively, even inside a
tight ``while True:`` loop. The reverse direction (IDE → board) is the
**control channel**: the IDE writes ``SNKCMD …`` lines and the ``control``
helper here polls stdin non-blockingly and hands you the latest values.

Quick start
-----------

::

    import time
    from machine import ADC, PWM, Pin
    import instruments as inst

    pwm = PWM(Pin(0)); pwm.freq(1000); pwm.duty_u16(32768)
    adc = ADC(26)

    while True:
        inst.read_pwm(pwm, ch="pwm")        # -> Oscilloscope
        inst.read_adc(adc, ch="adc0")       # -> Multimeter
        inst.plot(temp=21.4, light=80)      # -> Plotter
        inst.imu(0.0, 1.2, 90.0)            # -> 3-D attitude
        inst.distance(123)                  # -> range view
        inst.control.poll()                 # <- read IDE commands
        ax = inst.control.axes("teleop")    # {'lx': 0.5, 'ly': -0.2, ...}
        time.sleep(0.1)

The telemetry protocol
----------------------

Each emitter does a single ``print()`` of ONE line, prefixed with the sentinel
token ``SNK`` so the IDE can route the line to the right instrument and hide it
from the console. One reading per line, ASCII, space-delimited::

    SNK SCOPE <ch> <value>
    SNK METER <ch> <value> [<unit>]
    SNK PLOT  <tok> [<tok> ...]                 # each <tok> is name=value or a number
    SNK IMU   <ch> <roll> <pitch> <yaw>         # Euler angles, degrees
    SNK IMUQ  <ch> <w> <x> <y> <z>              # orientation quaternion
    SNK DIST  <ch> <mm> [<angle>]               # range mm, optional bearing deg
    SNK BTN   <name> <0|1>                       # button up(0)/down(1)
    SNK ENC   <ch> <count> [<0|1>]               # encoder count, optional press
    SNK SCR   <addr> text <row> [<row> ...]      # rows: spaces encoded as '_'
    SNK SCR   <addr> fb <w> <h> <enc> <data>     # framebuffer, enc in {b64,rle}
    SNK I2C   <addr> [<addr> ...]                # one bus-scan result set
    SNK WIFI  <ssid> <rssi> <ch> <sec>           # one network (SSID spaces -> '_')
    SNK BT    <name> <mac> <rssi>                # one BLE device (name spaces -> '_')

``<ch>``/``<name>`` are user labels the IDE uses to match a reading to an open
instrument. The emitters are pure ``str`` formatting + one ``print`` (no
allocation-heavy work, no blocking) so they are safe to call at speed in a loop.
The **scanners** (``i2c_scan``/``wifi_scan``/``bt_scan``) block briefly to run
the scan, then emit the result set — call them occasionally, not every loop.

The control protocol (IDE -> board)
-----------------------------------

The IDE writes one line per command, mirroring the ``SNK`` sentinel so the
Terminal hides it::

    SNKCMD <target> <payload>

``<target>`` names what to drive (``teleop``, ``led``, ``buzzer``, ``screen``,
or a scan trigger like ``scan:i2c``); ``<payload>`` is free-form for that
target. ``control`` stores the LATEST payload per target; poll it in your loop::

    inst.control.poll()                       # drain pending SNKCMD lines (non-blocking)
    inst.control.get("led")                   # latest raw payload string, or None
    inst.control.axes("teleop")               # {'lx': 0.5, ...} from axes=lx:0.5,...
    inst.control.pressed("teleop", "a")       # True if 'btn:a=1' present
"""

import sys

# The sentinel that prefixes every telemetry line. Kept short + ASCII so it is
# cheap to print and easy for the IDE to detect / strip.
SENTINEL = "SNK"

# The sentinel that prefixes IDE -> board control lines (issue #115). Mirrors
# SENTINEL so the IDE's Terminal hides the echo exactly as it hides telemetry.
CONTROL_SENTINEL = "SNKCMD"


# ---------------------------------------------------------------------------
# Emitters — telemetry, board -> IDE (read). Each is a single cheap print().
# ---------------------------------------------------------------------------

def scope(value, ch="ch1"):
    """Emit one oscilloscope sample ``value`` for channel ``ch``.

    Prints ``SNK SCOPE <ch> <value>``. Call repeatedly in a loop to feed a live
    waveform to an open Oscilloscope whose source matches ``ch``.
    """
    print("%s SCOPE %s %s" % (SENTINEL, ch, value))


def meter(value, ch="adc0", unit="V"):
    """Emit one multimeter reading ``value`` (with ``unit``) for channel ``ch``.

    Prints ``SNK METER <ch> <value> <unit>``. The IDE shows the latest value and
    folds it into the meter's MIN/MAX/AVG.
    """
    print("%s METER %s %s %s" % (SENTINEL, ch, value, unit))


def plot(*args, **kwargs):
    """Emit one plotter row of bare numbers and/or named series.

    ``plot(1, 2, 3)`` prints ``SNK PLOT 1 2 3``; ``plot(temp=21.4, light=80)``
    prints ``SNK PLOT temp=21.4 light=80``; the two styles can be mixed. Each
    token uses the Plotter's own ``name=value`` / bare-number grammar.
    """
    toks = [str(a) for a in args]
    # `kwargs` preserves insertion order on MicroPython + CPython 3.7+, so the
    # series appear in the order the caller named them.
    for name, val in kwargs.items():
        toks.append("%s=%s" % (name, val))
    print("%s PLOT %s" % (SENTINEL, " ".join(toks)))


def imu(roll, pitch, yaw, ch="imu"):
    """Emit one IMU orientation as Euler angles (degrees) on channel ``ch``.

    Prints ``SNK IMU <ch> <roll> <pitch> <yaw>`` for a live 3-D attitude view.
    """
    print("%s IMU %s %s %s %s" % (SENTINEL, ch, roll, pitch, yaw))


def imu_quat(w, x, y, z, ch="imu"):
    """Emit one IMU orientation as a quaternion (drift/gimbal-lock free).

    Prints ``SNK IMUQ <ch> <w> <x> <y> <z>``.
    """
    print("%s IMUQ %s %s %s %s %s" % (SENTINEL, ch, w, x, y, z))


def distance(mm, angle=None, ch="dist"):
    """Emit one distance reading in millimetres, with an optional bearing.

    Prints ``SNK DIST <ch> <mm>`` (or ``… <mm> <angle>`` when ``angle`` is given,
    e.g. a sweeping servo's degrees) for a range / proximity view.
    """
    if angle is None:
        print("%s DIST %s %s" % (SENTINEL, ch, mm))
    else:
        print("%s DIST %s %s %s" % (SENTINEL, ch, mm, angle))


def button(name, state):
    """Emit a button event ``name`` as down(1)/up(0).

    Prints ``SNK BTN <name> <0|1>`` — ``state`` is coerced to ``1`` if truthy.
    """
    print("%s BTN %s %s" % (SENTINEL, name, 1 if state else 0))


def encoder(count, ch="enc", pressed=None):
    """Emit a rotary-encoder ``count`` for channel ``ch``, optionally its press.

    Prints ``SNK ENC <ch> <count>`` (or ``… <count> <0|1>`` when ``pressed`` is
    not ``None``, for an encoder with an integrated push switch).
    """
    if pressed is None:
        print("%s ENC %s %s" % (SENTINEL, ch, count))
    else:
        print("%s ENC %s %s %s" % (SENTINEL, ch, count, 1 if pressed else 0))


def _scr_token(text):
    """Encode one screen row as a single ASCII token (spaces -> '_')."""
    return str(text).replace(" ", "_")


def screen(lines, addr="0x3C"):
    """Emit a small display's TEXT contents as rows.

    ``lines`` is an iterable of strings (one per row). Prints
    ``SNK SCR <addr> text <row> [<row> ...]`` with each row's spaces encoded as
    ``_`` so a row stays a single token (the IDE decodes them back). ``addr`` is
    the bus address label (default ``0x3C``, a common SSD1306 OLED).
    """
    rows = " ".join(_scr_token(line) for line in lines)
    print("%s SCR %s text %s" % (SENTINEL, addr, rows))


def screen_fb(data, w, h, addr="0x3C", encoding="b64"):
    """Emit a small display's FRAMEBUFFER (a compact monochrome bitmap).

    ``data`` is the already-packed payload string; ``encoding`` documents the
    packing so the IDE can unpack it: ``b64`` (base64 of the raw 1-bpp buffer,
    row-major, MSB-first within each byte) or ``rle`` (a simple run-length form
    ``<count>x<0|1>`` repeated). Prints ``SNK SCR <addr> fb <w> <h> <enc> <data>``.
    """
    print("%s SCR %s fb %s %s %s %s" % (SENTINEL, addr, w, h, encoding, data))


# ---------------------------------------------------------------------------
# Scanners — run a scan, then emit the result set. These BLOCK briefly; call
# them occasionally (emit-on-complete), not inside a tight loop. They tolerate a
# missing radio (no network/bluetooth) by degrading to no output.
# ---------------------------------------------------------------------------

def i2c_scan(i2c):
    """Scan an I²C bus and emit the responding addresses as one result set.

    Calls ``i2c.scan()`` and prints ``SNK I2C <addr> <addr> …`` (addresses as
    ``0x..`` hex; an empty bus prints a bare ``SNK I2C``). ``i2c`` is a
    ``machine.I2C``/``SoftI2C``.
    """
    addrs = list(i2c.scan())
    toks = " ".join("0x%02X" % a for a in addrs)
    print("%s I2C %s" % (SENTINEL, toks) if toks else "%s I2C" % SENTINEL)
    return addrs


def wifi_scan():
    """Scan for Wi-Fi networks (STA mode) and emit one line per network.

    Activates ``network.WLAN(STA_IF)``, runs ``.scan()`` and prints one
    ``SNK WIFI <ssid> <rssi> <ch> <sec>`` per network (SSID spaces -> ``_``).
    Degrades to no output (returns ``[]``) when ``network`` is unavailable.
    """
    try:
        import network
    except ImportError:
        return []
    sta = network.WLAN(network.STA_IF)
    sta.active(True)
    nets = sta.scan()  # (ssid, bssid, channel, rssi, security, hidden)
    out = []
    for net in nets:
        ssid = net[0]
        if isinstance(ssid, (bytes, bytearray)):
            ssid = ssid.decode("utf-8", "replace")
        ssid = ssid or "?"
        ch = net[2]
        rssi = net[3]
        sec = net[4]
        print("%s WIFI %s %s %s %s" % (SENTINEL, _scr_token(ssid), rssi, ch, sec))
        out.append((ssid, rssi, ch, sec))
    return out


def bt_scan(ms=4000):
    """Scan for Bluetooth (BLE) devices for ``ms`` and emit one line per device.

    Prefers ``aioble`` if present; prints one ``SNK BT <name> <mac> <rssi>`` per
    device (name spaces -> ``_``; missing name/mac -> ``?``). Degrades to no
    output (returns ``[]``) when no BLE stack is available — running a real scan
    needs an async context, so the default no-op keeps this importable + safe to
    call from synchronous code; pass results in via :func:`emit_bt` if you scan
    yourself.
    """
    try:
        import bluetooth  # noqa: F401  (presence check only)
    except ImportError:
        return []
    # A real BLE scan is async (aioble) / IRQ-driven (ubluetooth); we don't drive
    # it here to stay synchronous + non-blocking-by-default. Use emit_bt() to
    # report each device you discover from your own scan loop.
    return []


def emit_bt(name, mac, rssi):
    """Emit one Bluetooth device result (use from your own BLE scan callback).

    Prints ``SNK BT <name> <mac> <rssi>`` (name spaces -> ``_``).
    """
    print("%s BT %s %s %s" % (SENTINEL, _scr_token(name or "?"), mac or "?", rssi))


# ---------------------------------------------------------------------------
# Convenience read helpers — the only ones that touch hardware.
# ---------------------------------------------------------------------------

def read_adc(adc, ch="adc0"):
    """Read ``adc`` (a ``machine.ADC``), emit a meter reading, and return volts.

    Converts the 16-bit ``read_u16()`` count to volts against a 3.3 V reference,
    ``meter``s it on channel ``ch`` (unit ``V``), and returns the volts so the
    caller can also use the value.
    """
    volts = adc.read_u16() / 65535 * 3.3
    meter(volts, ch=ch, unit="V")
    return volts


def read_pwm(pwm, ch="pwm"):
    """Read ``pwm`` (a ``machine.PWM``), emit a scope sample, and return the duty.

    Reads ``duty_u16()`` as a 0..1 fraction (``/ 65535``), ``scope``s it on
    channel ``ch``, and returns the duty fraction.
    """
    duty = pwm.duty_u16() / 65535
    scope(duty, ch=ch)
    return duty


# ---------------------------------------------------------------------------
# Control channel — IDE -> board (write). Poll non-blockingly in your loop.
# ---------------------------------------------------------------------------

def parse_control_line(line):
    """Parse one ``SNKCMD <target> <payload>`` line -> ``(target, payload)``.

    Returns ``None`` for a non-control / malformed line. ``payload`` is the rest
    of the line after the target (may be empty). Pure + side-effect-free so it is
    unit-testable under CPython.
    """
    if not line:
        return None
    line = line.strip()
    if line == CONTROL_SENTINEL or not line.startswith(CONTROL_SENTINEL + " "):
        return None
    rest = line[len(CONTROL_SENTINEL) + 1:].strip()
    if not rest:
        return None
    sp = rest.find(" ")
    if sp == -1:
        return (rest, "")
    return (rest[:sp], rest[sp + 1:].strip())


def parse_axes(payload):
    """Parse an ``axes=lx:0.5,ly:-0.2 …`` token out of ``payload`` -> a dict.

    Returns ``{name: float}`` for each ``name:value`` in the ``axes=`` token
    (bad numbers skipped). An absent ``axes=`` token yields ``{}``. Pure.
    """
    out = {}
    if not payload:
        return out
    for tok in payload.split(" "):
        if not tok.startswith("axes="):
            continue
        for pair in tok[len("axes="):].split(","):
            if ":" not in pair:
                continue
            name, _, val = pair.partition(":")
            try:
                out[name] = float(val)
            except (ValueError, TypeError):
                pass
    return out


def parse_pressed(payload, btn):
    """Is ``btn:<btn>=1`` present in ``payload``? Returns a bool. Pure."""
    if not payload:
        return False
    needle = "btn:%s=1" % btn
    for tok in payload.split(" "):
        if tok == needle:
            return True
    return False


class Control:
    """Non-blocking reader for the IDE -> board control channel (issue #115).

    Call :meth:`poll` once per loop iteration: it drains any pending ``SNKCMD``
    lines from stdin WITHOUT blocking and stores the LATEST payload per target.
    Then read with :meth:`get` / :meth:`axes` / :meth:`pressed`. Designed to be
    safe inside ``while True:`` — it never blocks, never corrupts your own
    ``print()`` output, and degrades gracefully when stdin is not pollable
    (then it is simply inert until you feed it lines yourself via :meth:`feed`).
    """

    def __init__(self):
        self._latest = {}        # target -> latest payload string
        self._buf = ""           # partial trailing line between polls
        self._poll = None        # uselect.poll() over stdin, when available
        self._handlers = {}      # target -> callable(payload) registry
        self._setup_poll()

    def _setup_poll(self):
        """Wire up a non-blocking stdin poller if the platform supports one."""
        try:
            import uselect
            stream = getattr(sys.stdin, "buffer", sys.stdin)
            poller = uselect.poll()
            poller.register(stream, uselect.POLLIN)
            self._poll = (uselect, poller, stream)
        except Exception:
            # No uselect / un-pollable stdin (e.g. CPython host, USB CDC quirks):
            # stay inert; feed() can still drive it for tests / custom transports.
            self._poll = None

    def _read_available(self):
        """Return any bytes/str currently waiting on stdin, or '' (never blocks)."""
        if self._poll is None:
            return ""
        uselect, poller, stream = self._poll
        chunks = []
        # poll(0) returns immediately; loop while data is ready so a burst of
        # commands is drained in one poll() call.
        while poller.poll(0):
            try:
                data = stream.read(64)
            except Exception:
                break
            if not data:
                break
            if isinstance(data, (bytes, bytearray)):
                data = data.decode("utf-8", "replace")
            chunks.append(data)
        return "".join(chunks)

    def feed(self, text):
        """Feed raw stdin ``text`` into the parser (used by :meth:`poll`/tests).

        Buffers a partial trailing line across calls; for each COMPLETE line it
        parses a ``SNKCMD`` and records the latest payload per target (firing any
        registered handler). Non-control lines are ignored. Never blocks/throws.
        """
        self._buf += text
        while True:
            nl = self._buf.find("\n")
            if nl == -1:
                break
            line = self._buf[:nl]
            self._buf = self._buf[nl + 1:]
            parsed = parse_control_line(line)
            if parsed is None:
                continue
            target, payload = parsed
            self._latest[target] = payload
            handler = self._handlers.get(target)
            if handler is not None:
                try:
                    handler(payload)
                except Exception:
                    pass

    def poll(self):
        """Drain pending control lines from stdin (non-blocking). Call each loop."""
        text = self._read_available()
        if text:
            self.feed(text)

    def get(self, target):
        """The latest payload string for ``target``, or ``None`` if none yet."""
        return self._latest.get(target)

    def axes(self, target):
        """The parsed ``axes=…`` dict from ``target``'s latest payload (``{}``)."""
        return parse_axes(self._latest.get(target))

    def pressed(self, target, btn):
        """Is button ``btn`` currently pressed in ``target``'s latest payload?"""
        return parse_pressed(self._latest.get(target), btn)

    def on(self, target, handler):
        """Register ``handler(payload)`` to fire when ``target`` is updated.

        Handy for scan triggers (e.g. ``control.on('scan:i2c', do_scan)``); the
        handler runs inside :meth:`poll` when a matching command arrives.
        """
        self._handlers[target] = handler


# The shared singleton most programs use: ``inst.control.poll()`` each loop.
control = Control()


# ---------------------------------------------------------------------------
# Background service — run the control channel + built-in scan triggers on the
# SECOND CORE, so a robot's main loop stays responsive while the IDE drives
# scans / teleop. Built on MicroPython's ``_thread`` (RP2040 runs it on core 1).
# ---------------------------------------------------------------------------

# What the board can do, announced to the IDE as ``SNK READY <caps...>`` so a
# panel knows a Snakie program is live (and which triggers it services).
READY_CAPS = ("scan:wifi", "scan:bt", "teleop", "led", "buzzer", "screen")

_service_running = False


def _sleep_ms(ms):
    """Sleep ``ms`` milliseconds on MicroPython (``sleep_ms``) or CPython."""
    import time
    if hasattr(time, "sleep_ms"):
        time.sleep_ms(ms)
    else:
        time.sleep(ms / 1000.0)


def ready(extra=()):
    """Announce readiness to the IDE: ``SNK READY <caps...>``.

    The IDE listens for this to know a Snakie program is running and servicing
    the control channel — so a SCAN button can drive it instead of asking you to
    run a program. ``extra`` adds capability tokens (e.g. ``scan:i2c``).
    """
    caps = list(READY_CAPS) + list(extra)
    print("%s READY %s" % (SENTINEL, " ".join(caps)))


def start(i2c=None, hz=50, background=True, buzzer_pin=None):
    """Start the Snakie background service so scans run on the SECOND CORE.

    Registers the built-in scan triggers on the control channel — ``scan:wifi``
    and ``scan:bt`` always, plus ``scan:i2c`` when you pass an ``i2c`` bus —
    wires a ``ping`` → ``SNK READY`` reply, announces readiness, then (when
    ``background``) spawns a thread on the second core that polls the control
    channel ~``hz``×/sec and re-announces readiness periodically. Your main loop
    no longer needs to call ``control.poll()``.

    Pass ``buzzer_pin=<n>`` to attach the shared :data:`buzzer` to ``PWM(Pin(n))``
    and register the ``buzzer`` control receiver, so the IDE's Buzzer panel can
    drive a connected speaker (``tone``/``seq``/``stop``/``pin``) over the control
    channel — the playback runs on core 1, off your main loop.

    Returns immediately. Falls back to registration + announce with NO thread
    when ``_thread`` is unavailable or ``background`` is False — then poll the
    control channel yourself each loop.
    """
    global _service_running
    extra = ()
    control.on("scan:wifi", lambda payload: wifi_scan())
    control.on("scan:bt", lambda payload: bt_scan())
    if i2c is not None:
        control.on("scan:i2c", lambda payload: i2c_scan(i2c))
        extra = ("scan:i2c",)
    if buzzer_pin is not None:
        buzzer.set_pin(buzzer_pin)
        control.on("buzzer", lambda payload: buzzer_command(payload, buzzer))
    control.on("ping", lambda payload: ready(extra))
    ready(extra)
    if not background or _service_running:
        return
    try:
        import _thread
    except ImportError:
        return  # no second core here — call control.poll() in your own loop
    _service_running = True
    _thread.start_new_thread(_service_loop, (hz, extra))


def _service_loop(hz, extra):
    """Core-1 loop: drain the control channel + heartbeat readiness."""
    delay = max(1, int(1000 / hz)) if hz else 20
    beat = 0
    while _service_running:
        try:
            control.poll()
        except Exception:
            pass
        # Re-announce ~every 2 s so a panel opened AFTER start() still detects us.
        beat += delay
        if beat >= 2000:
            beat = 0
            try:
                ready(extra)
            except Exception:
                pass
        _sleep_ms(delay)


def stop():
    """Stop the background service (the core-1 thread exits on its next tick)."""
    global _service_running
    _service_running = False


# ---------------------------------------------------------------------------
# Receiver helpers — thin actuators driven by the control channel. The protocol
# (the SNKCMD payload grammar) is the deliverable; actuation is minimal/illustrative
# and guards its hardware import so the module still imports under CPython.
# ---------------------------------------------------------------------------

def teleop(target="teleop", ctrl=None):
    """Return ``(axes, buttons_payload)`` for ``target`` from the control channel.

    ``axes`` is the parsed ``{name: float}`` dict; the raw payload (for custom
    button checks via ``ctrl.pressed``) is the latest string. A thin convenience
    over :meth:`Control.axes` so a robot loop reads its joystick in one call.
    """
    ctrl = ctrl or control
    return ctrl.axes(target), ctrl.get(target)


class Buzzer:
    """Drive a passive buzzer/speaker from ``buzzer`` control commands.

    ``tone(freq, ms)`` plays a single tone; ``play_seq(pairs)`` plays a list of
    ``(freq, ms)`` notes in order (``freq`` 0 = a silent rest); ``stop()``
    silences immediately; ``set_pin(n)`` (re)targets the PWM pin. Pass a
    ``machine.PWM`` as ``pwm`` to actually sound, or build one with ``set_pin``;
    with no PWM every call is a no-op (still importable + testable under CPython).

    The IDE pre-parses melodies/RTTTL and sends a compact ``seq`` note list, so
    the board needs no RTTTL parser. ``play(rtttl)`` is kept as a thin legacy hook.
    """

    def __init__(self, pwm=None):
        self._pwm = pwm

    def set_pin(self, n):
        """(Re)target the PWM pin: build ``PWM(Pin(n))`` (no-op without hardware).

        Silences any current tone first. Guards the ``machine`` import so the
        module stays importable/testable under CPython — when ``machine`` is
        unavailable this is inert and ``_pwm`` is left as-is.
        """
        self.stop()
        try:
            from machine import Pin, PWM
        except ImportError:
            return
        self._pwm = PWM(Pin(int(n)))

    def tone(self, freq, ms=200):
        """Sound ``freq`` Hz for ``ms`` (no-op without a PWM pin)."""
        if self._pwm is None:
            return
        import time
        self._pwm.freq(int(freq))
        self._pwm.duty_u16(32768)
        time.sleep_ms(int(ms)) if hasattr(time, "sleep_ms") else time.sleep(ms / 1000)
        self._pwm.duty_u16(0)

    def stop(self):
        """Silence the buzzer NOW (duty 0). Safe without a PWM pin."""
        if self._pwm is not None:
            self._pwm.duty_u16(0)

    def play_seq(self, pairs):
        """Play a list of ``(freq, ms)`` notes in order; ``freq`` 0 is a rest.

        Blocking (runs on core 1 in the background service): for each note it
        sets the frequency + duty and sleeps ``ms``, then briefly silences before
        the next so adjacent same-pitch notes are distinct. A ``freq`` of 0 sleeps
        silently for ``ms``. No-op without a PWM pin.
        """
        if self._pwm is None:
            return
        import time
        sleep_ms = time.sleep_ms if hasattr(time, "sleep_ms") else (
            lambda ms: time.sleep(ms / 1000)
        )
        for freq, ms in pairs:
            freq = int(freq)
            ms = int(ms)
            if freq > 0:
                self._pwm.freq(freq)
                self._pwm.duty_u16(32768)
            else:
                self._pwm.duty_u16(0)
            sleep_ms(ms)
            self._pwm.duty_u16(0)
            sleep_ms(20)

    def play(self, rtttl):
        """Play an RTTTL string (legacy hook — the IDE prefers ``seq``).

        Left minimal on purpose: the IDE pre-parses RTTTL and sends a ``seq``
        note list, so a real RTTTL parser on-board is optional. Returns the input.
        """
        return rtttl


def parse_seq(payload):
    """Parse a ``seq`` payload (``<freq:ms>,<freq:ms>,…``) → ``[(freq, ms), …]``.

    Each pair is ``freq:ms`` (``freq`` 0 = a rest). Whitespace and malformed pairs
    are tolerated/skipped. Pure + side-effect-free so it is unit-testable under
    CPython. ``parse_seq("440:200,0:100")`` → ``[(440, 200), (0, 100)]``.
    """
    out = []
    if not payload:
        return out
    for tok in payload.replace(" ", "").split(","):
        if not tok or ":" not in tok:
            continue
        fs, _, ds = tok.partition(":")
        try:
            out.append((int(fs), int(ds)))
        except (ValueError, TypeError):
            continue
    return out


def buzzer_command(payload, buz=None):
    """Drive ``buz`` (a :class:`Buzzer`) from one ``buzzer`` control payload.

    Parses the ``<verb> <args>`` grammar and actuates:

      * ``tone <freq> <ms>`` → ``buz.tone(freq, ms)``
      * ``seq <freq:ms>,…``  → ``buz.play_seq([...])`` (``freq`` 0 = rest)
      * ``stop``             → ``buz.stop()``
      * ``pin <n>``          → ``buz.set_pin(n)``

    Defaults ``buz`` to the shared :data:`buzzer` singleton. Never raises on a
    malformed payload (it is fed from the IDE). Returns the verb it handled (or
    ``None``), which keeps it easy to unit-test against a fake PWM.
    """
    buz = buz if buz is not None else buzzer
    if not payload:
        return None
    payload = payload.strip()
    sp = payload.find(" ")
    if sp == -1:
        verb, args = payload, ""
    else:
        verb, args = payload[:sp], payload[sp + 1:].strip()
    try:
        if verb == "tone":
            parts = args.split()
            freq = int(parts[0]) if len(parts) >= 1 else 0
            ms = int(parts[1]) if len(parts) >= 2 else 200
            buz.tone(freq, ms)
        elif verb == "seq":
            buz.play_seq(parse_seq(args))
        elif verb == "stop":
            buz.stop()
        elif verb == "pin":
            buz.set_pin(int(args.split()[0]))
        else:
            return None
    except (ValueError, IndexError, TypeError):
        return None
    return verb


class Led:
    """Drive an LED (on/off, PWM brightness, or RGB) from ``led`` commands.

    ``set(on)`` toggles a digital pin; ``pwm(level)`` sets 0..1 brightness on a
    PWM pin; ``rgb(r,g,b)`` sets three 0..255 channels. Construct with whichever
    of ``pin`` (digital), ``pwm`` (single PWM), or ``rgb`` (3-tuple of PWMs) you
    have; missing hardware -> the matching call is a no-op.
    """

    def __init__(self, pin=None, pwm=None, rgb=None):
        self._pin = pin
        self._pwm = pwm
        self._rgb = rgb

    def set(self, on):
        """Turn the digital LED on/off (no-op without a pin)."""
        if self._pin is not None:
            self._pin.value(1 if on else 0)

    def pwm(self, level):
        """Set 0..1 brightness on the PWM LED (no-op without a PWM pin)."""
        if self._pwm is not None:
            level = max(0.0, min(1.0, float(level)))
            self._pwm.duty_u16(int(level * 65535))

    def rgb(self, r, g, b):
        """Set an RGB LED's 0..255 channels (no-op without 3 PWMs)."""
        if self._rgb is not None:
            chans = (r, g, b)
            for pwm, val in zip(self._rgb, chans):
                pwm.duty_u16(int(max(0, min(255, int(val))) / 255 * 65535))


class Screen:
    """Drive a text display from ``screen`` commands + echo to the IDE.

    ``text(lines, addr=...)`` both pushes the rows to an attached ``display``
    (anything with a ``.text``/``.show`` API, optional) AND emits a
    ``SNK SCR … text …`` telemetry line so the IDE mirrors it. With no display
    attached it is purely the telemetry echo.
    """

    def __init__(self, display=None, addr="0x3C"):
        self._display = display
        self._addr = addr

    def text(self, lines, addr=None):
        """Show + echo ``lines`` (an iterable of row strings)."""
        addr = addr or self._addr
        rows = list(lines)
        disp = self._display
        if disp is not None and hasattr(disp, "text") and hasattr(disp, "show"):
            try:
                disp.fill(0)
                for i, row in enumerate(rows):
                    disp.text(str(row), 0, i * 10)
                disp.show()
            except Exception:
                pass
        screen(rows, addr=addr)


# Shared, ready-to-use (hardware-less) singletons — attach hardware as needed,
# e.g. ``inst.led = inst.Led(pwm=PWM(Pin(15)))``.
buzzer = Buzzer()
led = Led()
