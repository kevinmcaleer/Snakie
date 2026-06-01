import './HelpPanel.css'

/**
 * HELP TAB (issue #22)
 * ====================
 *
 * In-app, self-contained help. This deliberately keeps users IN the app rather
 * than punting them to GitHub (see docs/feedback.md): a welcoming overview, a
 * "getting started" walkthrough, and a MicroPython syntax quick reference with
 * copy-pasteable snippets.
 *
 * External links are rendered as plain anchors. Wiring them to open in the
 * system browser needs preload/IPC changes that are out of scope for this
 * issue, so they are intentionally NOT click-wired here — a later issue can add
 * a `shell.openExternal` bridge and upgrade these into real links.
 */
export function HelpPanel(): JSX.Element {
  return (
    <div className="help">
      <header className="help__hero">
        <span className="help__hero-mark" aria-hidden="true">
          🐍
        </span>
        <div>
          <h1 className="help__hero-title">Welcome to Snakie</h1>
          <p className="help__hero-sub">
            A friendly editor for writing and running MicroPython on your board.
          </p>
        </div>
      </header>

      <section className="help__section" aria-labelledby="help-start">
        <h2 id="help-start" className="help__h2">
          Getting started
        </h2>
        <ol className="help__steps">
          <li>
            <strong>Plug in your board</strong> over USB, then click{' '}
            <em>Connect</em> in the toolbar and pick its serial port.
          </li>
          <li>
            <strong>Write some code</strong> in the editor. Open a file from the
            left, or hit <kbd>+</kbd> on the tab strip for a fresh buffer.
          </li>
          <li>
            <strong>Run it</strong> with the Run control to execute the current
            file on the device, and watch the output in the terminal below.
          </li>
          <li>
            <strong>Save &amp; upload</strong> to copy files to the board so they
            persist (name it <code>main.py</code> to run automatically on boot).
          </li>
        </ol>
      </section>

      <section className="help__section" aria-labelledby="help-tips">
        <h2 id="help-tips" className="help__h2">
          Handy shortcuts
        </h2>
        <ul className="help__kbds">
          <li>
            <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>W</kbd> — close the active
            editor tab
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>Tab</kbd> — cycle between open editor tabs
          </li>
          <li>
            Right-click in a file tree for New File / Folder and other actions
          </li>
        </ul>
      </section>

      <section className="help__section" aria-labelledby="help-ref">
        <h2 id="help-ref" className="help__h2">
          MicroPython quick reference
        </h2>

        <h3 className="help__h3">Common statements</h3>
        <Snippet
          code={`# Variables, loops, functions
name = "Snakie"
for i in range(3):
    print(i, name)

def add(a, b):
    return a + b

if add(1, 2) == 3:
    print("ok")`}
        />

        <h3 className="help__h3">
          Blink an LED — <code>machine.Pin</code>
        </h3>
        <Snippet
          code={`from machine import Pin
from time import sleep

led = Pin("LED", Pin.OUT)   # or Pin(25, Pin.OUT) on a Pico

while True:
    led.toggle()
    sleep(0.5)`}
        />

        <h3 className="help__h3">
          Timing &amp; delays — <code>time</code>
        </h3>
        <Snippet
          code={`import time

time.sleep(1)          # seconds (float ok)
time.sleep_ms(250)     # milliseconds
start = time.ticks_ms()
# ... do work ...
elapsed = time.ticks_diff(time.ticks_ms(), start)
print(elapsed, "ms")`}
        />

        <h3 className="help__h3">
          Read an input pin &amp; analog — <code>machine</code>
        </h3>
        <Snippet
          code={`from machine import Pin, ADC

button = Pin(14, Pin.IN, Pin.PULL_UP)
print("pressed" if button.value() == 0 else "released")

sensor = ADC(Pin(26))           # ADC0 on a Pico
print(sensor.read_u16())         # 0..65535`}
        />

        <h3 className="help__h3">REPL tips</h3>
        <ul className="help__list">
          <li>
            The terminal below is a live MicroPython REPL — type Python and press
            Enter to run it immediately.
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>C</kbd> interrupts a running program (stops an
            infinite loop).
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>D</kbd> performs a soft reboot, re-running{' '}
            <code>main.py</code>.
          </li>
          <li>
            Paste a block of code with <kbd>Ctrl</kbd> + <kbd>E</kbd> (paste
            mode), then <kbd>Ctrl</kbd> + <kbd>D</kbd> to execute it.
          </li>
          <li>
            Call <code>help(&apos;modules&apos;)</code> to list every module
            available on your board.
          </li>
        </ul>
      </section>

      <section className="help__section" aria-labelledby="help-more">
        <h2 id="help-more" className="help__h2">
          Learn more
        </h2>
        <p className="help__muted">
          Official MicroPython docs (opens in your browser):{' '}
          <a className="help__link" href="https://docs.micropython.org/">
            docs.micropython.org
          </a>
        </p>
      </section>
    </div>
  )
}

/** Read-only code block for reference snippets. */
function Snippet({ code }: { code: string }): JSX.Element {
  return <pre className="help__snippet">{code}</pre>
}
