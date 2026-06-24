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

# Library version. Bump this on ANY change to this file — the IDE compares it
# against the copy installed on the board and offers a one-click UPDATE when they
# differ (a legacy copy with no __version__ reads as out-of-date). Keep the
# `__version__ = "X.Y.Z"` literal form so the IDE can parse it without importing.
__version__ = "0.5.0"

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


def _decode_adv_name(adv_data):
    """Extract the local name from BLE advertising data, or ``''``.

    Advertising data is a run of AD structures ``<len><type><payload…>``; AD type
    ``0x09`` is the Complete Local Name and ``0x08`` the Shortened Local Name.
    Pure + side-effect-free so it is unit-testable under CPython.
    """
    try:
        i = 0
        n = len(adv_data)
        while i + 1 < n:
            length = adv_data[i]
            if length == 0:
                break
            ad_type = adv_data[i + 1]
            if ad_type in (0x09, 0x08):
                return bytes(adv_data[i + 2:i + 1 + length]).decode("utf-8", "replace")
            i += 1 + length
    except Exception:
        pass
    return ""


def bt_scan(ms=4000):
    """Scan for Bluetooth (BLE) devices for ~``ms`` and emit one line per device.

    Uses the low-level ``bluetooth`` module: actives the radio, registers a scan
    IRQ that collects each advertisement's (address, rssi, payload), runs an
    ACTIVE ``gap_scan`` for ``ms`` (active so devices return their names), then
    emits one ``SNK BT <name> <mac> <rssi>`` per unique device (strongest RSSI
    kept). Blocks for ~``ms`` — call it on demand, not in a tight loop. Degrades
    to no output (returns ``[]``) when ``bluetooth`` / the BLE radio is absent.
    """
    try:
        import bluetooth
    except ImportError:
        return []
    import time

    _IRQ_SCAN_RESULT = 5
    _IRQ_SCAN_DONE = 6
    found = {}        # addr bytes -> (rssi, adv payload bytes)
    done = [False]

    def _irq(event, data):
        # Scheduled (soft) callback, so small allocations are OK. Copy the addr +
        # payload (they're only valid during the call); keep the strongest RSSI.
        if event == _IRQ_SCAN_RESULT:
            addr_type, addr, adv_type, rssi, adv_data = data
            key = bytes(addr)
            prev = found.get(key)
            if prev is None or rssi > prev[0]:
                found[key] = (rssi, bytes(adv_data))
        elif event == _IRQ_SCAN_DONE:
            done[0] = True

    try:
        ble = bluetooth.BLE()
        ble.active(True)
        ble.irq(_irq)
        # gap_scan(duration_ms, interval_us, window_us, active=True): active scan
        # solicits scan responses so we get device names where advertised.
        ble.gap_scan(int(ms), 30000, 30000, True)
    except Exception:
        return []

    t0 = time.ticks_ms()
    while not done[0] and time.ticks_diff(time.ticks_ms(), t0) < int(ms) + 1500:
        time.sleep_ms(50)
    try:
        ble.gap_scan(None)  # stop scanning if it's still going
    except Exception:
        pass

    out = []
    for addr, (rssi, adv) in found.items():
        mac = ":".join("%02X" % b for b in addr)
        name = _decode_adv_name(adv) or "?"
        emit_bt(name, mac, rssi)
        out.append((name, mac, rssi))
    return out


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
        self._last_beat = None   # ticks of the last SNK READY heartbeat
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
        """Return any bytes/str currently waiting on stdin, or '' (never blocks).

        Reads ONE byte at a time, gated by ``poll(0)`` each iteration. This is
        the critical bit on a Pico: ``stream.read(64)`` on USB-CDC stdin BLOCKS
        until 64 bytes arrive (there's no EOF), which would wedge the polling
        loop; ``read(1)`` after ``poll(0)`` confirms a byte is ready returns at
        once, so a burst is drained byte-by-byte without ever blocking.
        """
        if self._poll is None:
            return ""
        uselect, poller, stream = self._poll
        chunks = []
        while poller.poll(0):
            try:
                data = stream.read(1)
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
        """Service the control channel: drain pending commands + heartbeat.

        Call once per main-loop iteration. It reads any waiting ``SNKCMD`` lines
        (non-blocking) AND emits a ``SNK READY`` heartbeat ~every 2 s so the IDE
        knows this program is alive and servicing control. Safe inside a tight
        ``while True:`` — it never blocks.
        """
        text = self._read_available()
        if text:
            self.feed(text)
        self._beat()

    def _beat(self):
        """Emit a ``SNK READY`` heartbeat ~every 2 s (the IDE's presence signal).

        Caps are the registered handler targets (``scan:wifi``, ``buzzer``, …).
        Hidden from the console like all ``SNK …`` lines.
        """
        try:
            import time
            now = time.ticks_ms() if hasattr(time, "ticks_ms") else int(time.time() * 1000)
            if self._last_beat is not None:
                if hasattr(time, "ticks_diff"):
                    if time.ticks_diff(now, self._last_beat) < 2000:
                        return
                elif (now - self._last_beat) < 2000:
                    return
            self._last_beat = now
            print("%s READY %s" % (SENTINEL, " ".join(self._handlers)))
        except Exception:
            pass

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
READY_CAPS = ("scan:wifi", "scan:bt", "teleop", "led", "buzzer", "range", "screen")

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


def start(i2c=None, buzzer_pin=None, range_trig=None, range_echo=None,
          screen_sda=None, screen_scl=None, screen_addr=0x3C,
          background=False, hz=50):
    """Register the built-in control handlers + attach the buzzer, then announce.

    Then call ``control.poll()`` in your main loop to SERVICE commands — it drains
    the control channel non-blockingly AND emits the ``SNK READY`` heartbeat the
    IDE uses to detect a running program. Registers:

      * ``scan:wifi`` / ``scan:bt`` (and ``scan:i2c`` when you pass an ``i2c`` bus),
      * the ``buzzer`` receiver when you pass ``buzzer_pin`` — attaches the shared
        :data:`buzzer` to ``PWM(Pin(n))`` so the IDE's Buzzer panel can drive a
        speaker (``tone``/``seq``/``stop``/``pin``),
      * the ``range`` receiver when you pass BOTH ``range_trig`` and ``range_echo`` —
        attaches the shared :data:`ranger` to an HC-SR04 so the IDE's Range panel
        can retarget the wiring (``pins <trig> <echo>``); call ``inst.ranger.read()``
        in your loop + ``inst.distance(mm)`` to feed the radar,
      * the ``screen`` receiver when you pass BOTH ``screen_sda`` and ``screen_scl``
        — builds the shared :data:`display` on an I²C SSD1306 OLED so the IDE's
        Display panel can retarget the SDA/SCL pins + address and push text
        (``pins <sda> <scl>`` / ``addr <0xNN>`` / ``text <row> …``),
      * ``ping`` → an immediate ``SNK READY`` reply.

    The typical loop::

        inst.start(buzzer_pin=0)
        while True:
            inst.control.poll()
            time.sleep(0.02)

    ``background=True`` is EXPERIMENTAL: it spawns a second-core thread that polls
    for you, so the main loop needn't call ``control.poll()``. It is UNRELIABLE on
    RP2040 — the thread shares stdin with the REPL, which can wedge the board on
    Stop / soft-reset — so it is OFF by default. Prefer main-loop polling above.
    """
    extra = ()
    control.on("scan:wifi", lambda payload: wifi_scan())
    control.on("scan:bt", lambda payload: bt_scan())
    if i2c is not None:
        control.on("scan:i2c", lambda payload: i2c_scan(i2c))
        extra = ("scan:i2c",)
    if buzzer_pin is not None:
        buzzer.set_pin(buzzer_pin)
        control.on("buzzer", lambda payload: buzzer_command(payload, buzzer))
    if range_trig is not None and range_echo is not None:
        ranger.set_pins(range_trig, range_echo)
        control.on("range", lambda payload: range_command(payload, ranger))
    if screen_sda is not None and screen_scl is not None:
        display.set_pins(screen_sda, screen_scl, screen_addr)
        control.on("screen", lambda payload: screen_command(payload, display))
    control.on("ping", lambda payload: ready(extra))
    ready(extra)
    if background:
        _start_thread(hz)


def _start_thread(hz):
    """EXPERIMENTAL: poll the control channel on the second core (see ``start``)."""
    global _service_running
    if _service_running:
        return
    try:
        import _thread
    except ImportError:
        return  # no second core here — call control.poll() in your own loop
    _service_running = True
    _thread.start_new_thread(_service_loop, (hz,))


def _service_loop(hz):
    """Core-1 loop: just poll() (which drains commands + heartbeats) until stop()."""
    delay = max(1, int(1000 / hz)) if hz else 20
    while _service_running:
        try:
            control.poll()
        except Exception:
            pass
        _sleep_ms(delay)
        _sleep_ms(delay)


def stop():
    """Stop the background service + silence the buzzer.

    Sets the run flag false (the core-1 thread exits on its next tick) and aborts
    any in-progress buzzer sequence. Safe to call from the main loop's
    ``KeyboardInterrupt`` handler so Snakie's Stop button leaves the board quiet
    and the REPL usable.
    """
    global _service_running
    _service_running = False
    try:
        buzzer.stop()
    except Exception:
        pass


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
        # Set by stop() (possibly from the OTHER core) to abort an in-progress
        # play_seq between notes — so Snakie's Stop silences a long melody at once.
        self._abort = False
        # PWM duty (0..65535) used while a note sounds — the IDE's VOLUME slider
        # sets it via the `vol` command (set_volume); 32768 = 50% by default.
        self._duty = 32768

    def set_volume(self, level):
        """Set the sounding duty from a 0..1 ``level`` (the IDE VOLUME slider)."""
        try:
            self._duty = max(0, min(65535, int(float(level) * 65535)))
        except (ValueError, TypeError):
            pass

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
        self._pwm.duty_u16(self._duty)
        time.sleep_ms(int(ms)) if hasattr(time, "sleep_ms") else time.sleep(ms / 1000)
        self._pwm.duty_u16(0)

    def stop(self):
        """Silence the buzzer NOW (duty 0) and abort any running sequence.

        Safe without a PWM pin, and safe to call from the OTHER core (it only
        flips a flag + zeroes the duty), so the main loop's Ctrl-C handler can
        cut a melody that's mid-play on the service core.
        """
        self._abort = True
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
        self._abort = False
        for freq, ms in pairs:
            if self._abort:  # stop() was called (maybe from the other core)
                break
            freq = int(freq)
            ms = int(ms)
            if freq > 0:
                self._pwm.freq(freq)
                self._pwm.duty_u16(self._duty)
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
      * ``vol <0..1>``       → ``buz.set_volume(level)`` (PWM duty)

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
        elif verb == "vol":
            buz.set_volume(float(args.split()[0]))
        else:
            return None
    except (ValueError, IndexError, TypeError):
        return None
    return verb


def _us_to_mm(us):
    """Convert an HC-SR04 echo pulse width (µs) to a distance in mm.

    Sound travels ~343 m/s ≈ 0.343 mm/µs; the echo pulse times the round trip
    (out + back), so halve it: ``0.343 / 2 = 0.1715`` mm per µs. Pure + integer
    result so it is cheap to call in a loop and easy to unit-test under CPython.
    """
    return int(us * 0.1715)


class Rangefinder:
    """Read an HC-SR04 ultrasonic distance sensor from ``range`` control commands.

    Two pins: ``trig`` (an OUTPUT the board pulses ~10 µs high to fire a ping) and
    ``echo`` (an INPUT that goes high for the round-trip flight time). ``read()``
    fires a ping and times the echo with ``machine.time_pulse_us``, returning the
    distance in **mm** (or ``None`` on a timeout / no pins). ``set_pins(trig, echo)``
    (re)targets the wiring; the IDE's Range panel sends ``range pins <trig> <echo>``
    when its TRIG/ECHO selectors change. Guards the ``machine`` import so the module
    stays importable/testable under CPython — with no hardware ``read()`` returns
    ``None`` and every call is a safe no-op.
    """

    def __init__(self, trig=None, echo=None):
        self._trig = None
        self._echo = None
        if trig is not None and echo is not None:
            self.set_pins(trig, echo)

    def set_pins(self, trig, echo):
        """(Re)target the trig (OUT) + echo (IN) pins; idle trig low.

        Builds ``Pin(int(trig), Pin.OUT)`` + ``Pin(int(echo), Pin.IN)`` and drops
        trig low so the next ``read()`` starts from a clean state. Guards the
        ``machine`` import so the module stays importable under CPython — when
        ``machine`` is unavailable this is inert and the pins are left as-is.
        """
        try:
            from machine import Pin
        except ImportError:
            return
        self._trig = Pin(int(trig), Pin.OUT)
        self._echo = Pin(int(echo), Pin.IN)
        self._trig.value(0)

    def read(self):
        """Fire one ping and return the distance in mm, or ``None``.

        Pulses trig high ~10 µs to launch a burst, then times the echo pulse with
        ``machine.time_pulse_us(echo, 1, 30000)`` (a 30 ms ≈ 5 m timeout). Returns
        ``None`` when there are no pins, ``machine`` is unavailable, or the pulse
        times out (``time_pulse_us`` returns a negative value); otherwise converts
        the round-trip µs to mm via :func:`_us_to_mm`. Safe to call in a loop.
        """
        if self._trig is None or self._echo is None:
            return None
        try:
            import machine
            import time
        except ImportError:
            return None
        self._trig.value(0)
        time.sleep_us(2) if hasattr(time, "sleep_us") else time.sleep(0.000002)
        self._trig.value(1)
        time.sleep_us(10) if hasattr(time, "sleep_us") else time.sleep(0.00001)
        self._trig.value(0)
        try:
            dur = machine.time_pulse_us(self._echo, 1, 30000)
        except Exception:
            return None
        if dur < 0:
            return None
        return _us_to_mm(dur)


def range_command(payload, rf=None):
    """Drive ``rf`` (a :class:`Rangefinder`) from one ``range`` control payload.

    Parses the ``<verb> <args>`` grammar and actuates:

      * ``pins <trig> <echo>`` → ``rf.set_pins(trig, echo)`` (retarget the wiring)

    Defaults ``rf`` to the shared :data:`ranger` singleton. Never raises on a
    malformed payload (it is fed from the IDE). Returns the verb it handled (or
    ``None``), which keeps it easy to unit-test against a fake/real Rangefinder.
    """
    rf = rf if rf is not None else ranger
    if not payload:
        return None
    payload = payload.strip()
    sp = payload.find(" ")
    if sp == -1:
        verb, args = payload, ""
    else:
        verb, args = payload[:sp], payload[sp + 1:].strip()
    try:
        if verb == "pins":
            parts = args.split()
            rf.set_pins(int(parts[0]), int(parts[1]))
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


# ---------------------------------------------------------------------------
# I²C display (SSD1306 OLED) — pin mux + a real driver + the `screen` receiver.
# ---------------------------------------------------------------------------

# The RP2040 (Pico) I²C pin mux: each block exposes SDA/SCL on a fixed set of
# GPIOs. A pair is valid iff BOTH pins belong to the SAME block (SDA from its SDA
# set AND SCL from its SCL set). These tables back :func:`_i2c_block_for_pins` and
# the IDE's invalid-pin warning, so keep them in lock-step with the panel's mux.
_I2C0_SDA = (0, 4, 8, 12, 16, 20)
_I2C0_SCL = (1, 5, 9, 13, 17, 21)
_I2C1_SDA = (2, 6, 10, 14, 18, 26)
_I2C1_SCL = (3, 7, 11, 15, 19, 27)


def _i2c_block_for_pins(sda, scl):
    """Return the RP2040 I²C block (0 or 1) a ``(sda, scl)`` pair selects, or None.

    A pair is valid only when both pins live in the SAME block's SDA/SCL sets
    (see the mux tables above): block 0 wants SDA∈{0,4,8,12,16,20} & SCL∈{1,5,9,
    13,17,21}; block 1 wants SDA∈{2,6,10,14,18,26} & SCL∈{3,7,11,15,19,27}. Any
    cross-block pair or an unknown pin yields ``None`` (the IDE then warns and the
    driver falls back to block 0). Pure + side-effect-free for unit tests.
    """
    try:
        sda = int(sda)
        scl = int(scl)
    except (TypeError, ValueError):
        return None
    if sda in _I2C0_SDA and scl in _I2C0_SCL:
        return 0
    if sda in _I2C1_SDA and scl in _I2C1_SCL:
        return 1
    return None


# The standard SSD1306 init sequence (matches the canonical MicroPython driver).
_SSD1306_INIT = (
    0xAE, 0x20, 0x00, 0x40, 0xA1, 0xA8, 0x3F, 0xC8, 0xD3, 0x00,
    0xDA, 0x12, 0xD5, 0x80, 0xD9, 0xF1, 0xDB, 0x20, 0x81, 0xFF,
    0xA4, 0xA6, 0x8D, 0x14, 0xAF,
)


class _SSD1306:
    """A minimal bundled SSD1306 I²C OLED driver (fallback for no ``ssd1306``).

    Uses ``framebuf`` (MONO_VLSB, the SSD1306 page format) for ``fill``/``text``
    and pushes the buffer with ``i2c.writeto`` in the standard init + addressing
    sequence. Built ONLY when both ``framebuf`` and a working ``machine.I2C`` are
    present (guarded by the caller), so the module still imports under CPython.
    """

    def __init__(self, w, h, i2c, addr=0x3C):
        import framebuf
        self.w = w
        self.h = h
        self._i2c = i2c
        self._addr = addr
        self._buf = bytearray((h // 8) * w)
        self._fb = framebuf.FrameBuffer(self._buf, w, h, framebuf.MONO_VLSB)
        for cmd in _SSD1306_INIT:
            self._cmd(cmd)
        self.fill(0)
        self.show()

    def _cmd(self, c):
        self._i2c.writeto(self._addr, bytes((0x80, c)))

    def fill(self, c):
        self._fb.fill(c)

    def text(self, s, x, y, c=1):
        self._fb.text(s, x, y, c)

    def show(self):
        # Window the column/page address to the full panel, then stream the buffer.
        for c in (0x21, 0, self.w - 1, 0x22, 0, (self.h // 8) - 1):
            self._cmd(c)
        self._i2c.writeto(self._addr, b"\x40" + self._buf)


class Display:
    """Drive a real I²C SSD1306 OLED from ``screen`` commands + echo to the IDE.

    ``set_pins(sda, scl, addr=0x3C, w=128, h=64)`` derives the RP2040 I²C block
    from the pins (via :func:`_i2c_block_for_pins`, block 0 if the pair is invalid
    — the IDE warns), builds ``I2C(block, sda=Pin(sda), scl=Pin(scl))``, then a
    panel: the installed ``ssd1306.SSD1306_I2C`` if present, else the bundled
    :class:`_SSD1306`. ``text(lines)`` draws each row (``y = i*10``) on the real
    panel AND emits a ``SNK SCR <addr> text …`` line so the IDE mirrors it.

    Every hardware import is guarded so the module stays importable/testable under
    CPython — with no ``machine``/``framebuf`` ``set_pins`` is inert (no panel) and
    ``text`` is purely the telemetry echo (exactly like the legacy :class:`Screen`).
    """

    def __init__(self, addr="0x3C"):
        self._i2c = None
        self._oled = None
        self._addr = addr  # the bus-address LABEL for the SCR echo (e.g. "0x3C")

    def set_pins(self, sda, scl, addr=0x3C, w=128, h=64):
        """(Re)build the I²C bus + the SSD1306 panel on ``sda``/``scl``.

        Derives the I²C block from the pins (block 0 when the pair is invalid).
        Prefers an installed ``ssd1306`` driver, falling back to the bundled
        :class:`_SSD1306`. Guards every hardware import so it is inert under
        CPython (the panel is left unbuilt; ``text`` still echoes telemetry).
        """
        self._addr = "0x%02X" % int(addr) if isinstance(addr, int) else str(addr)
        block = _i2c_block_for_pins(sda, scl)
        if block is None:
            block = 0  # invalid pair → fall back to block 0 (the IDE warns)
        try:
            from machine import Pin, I2C
        except ImportError:
            return  # no hardware (CPython) — inert; text() still echoes telemetry
        self._i2c = I2C(block, sda=Pin(int(sda)), scl=Pin(int(scl)))
        try:
            import ssd1306
            self._oled = ssd1306.SSD1306_I2C(w, h, self._i2c, int(addr))
            return
        except Exception:
            pass
        try:
            self._oled = _SSD1306(w, h, self._i2c, int(addr))
        except Exception:
            self._oled = None  # no framebuf / panel — telemetry-only

    def set_addr(self, addr):
        """Set the bus-address label used in the ``SNK SCR`` echo (e.g. ``0x3D``)."""
        self._addr = "0x%02X" % int(addr) if isinstance(addr, int) else str(addr)

    def text(self, lines):
        """Draw + echo ``lines`` (an iterable of row strings).

        Renders each row at ``y = i*10`` on the real SSD1306 (``fill(0)`` →
        ``text`` per row → ``show``) when a panel is attached, then ALWAYS emits a
        ``SNK SCR <addr> text …`` line so the IDE mirrors it. No-op on the panel
        without hardware; never raises.
        """
        rows = list(lines)
        oled = self._oled
        if oled is not None:
            try:
                oled.fill(0)
                for i, row in enumerate(rows):
                    oled.text(str(row), 0, i * 10)
                oled.show()
            except Exception:
                pass
        screen(rows, addr=self._addr)


def screen_command(payload, disp=None):
    """Drive ``disp`` (a :class:`Display`) from one ``screen`` control payload.

    Parses the ``<verb> <args>`` grammar and actuates:

      * ``pins <sda> <scl>`` → ``disp.set_pins(sda, scl)`` (retarget the I²C bus)
      * ``addr <0xNN>``      → ``disp.set_addr(addr)`` (the SCR echo address)
      * ``text <row> [<row> …]`` → ``disp.text(rows)`` (each row is ``_``-encoded ↔
        spaces, matching the ``SNK SCR text`` packing)

    Defaults ``disp`` to the shared :data:`display` singleton. Never raises on a
    malformed payload (it is fed from the IDE). Returns the verb it handled (or
    ``None``), which keeps it easy to unit-test against a fake/real Display.
    """
    disp = disp if disp is not None else display
    if not payload:
        return None
    payload = payload.strip()
    sp = payload.find(" ")
    if sp == -1:
        verb, args = payload, ""
    else:
        verb, args = payload[:sp], payload[sp + 1:].strip()
    try:
        if verb == "pins":
            parts = args.split()
            disp.set_pins(int(parts[0]), int(parts[1]))
        elif verb == "addr":
            if not args:
                return None
            disp.set_addr(int(args, 0) if args[:2].lower() == "0x" else int(args))
        elif verb == "text":
            rows = [tok.replace("_", " ") for tok in args.split(" ")] if args else []
            disp.text(rows)
        else:
            return None
    except (ValueError, IndexError, TypeError):
        return None
    return verb


# Shared, ready-to-use (hardware-less) singletons — attach hardware as needed,
# e.g. ``inst.led = inst.Led(pwm=PWM(Pin(15)))``. NOTE: the rangefinder singleton
# is ``ranger`` (NOT ``range`` — that would shadow the Python builtin).
buzzer = Buzzer()
led = Led()
ranger = Rangefinder()
display = Display()
