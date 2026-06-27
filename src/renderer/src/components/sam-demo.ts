/**
 * The SAM (Software Automated Mouth) demo program the IDE offers to open + run
 * for the SAM instrument (#167). Kept in sync with the reference copy at
 * `examples/sam_demo.py`.
 *
 * SAM synthesises speech on a SINGLE buzzer/speaker pin. The instrument speaks by
 * exec-ing `SAM(pin=N).say("…")` on demand, but this standalone demo lets the
 * user run + edit it directly. Library: https://github.com/kevinmcaleer/sam
 */
export const SAM_DEMO_NAME = 'sam_demo.py'

export const SAM_DEMO = `"""SAM text-to-speech demo for Snakie.

Open & Run this, then type into the SAM instrument and press SPEAK — or edit the
text below and run it directly. SAM synthesises speech on a single buzzer /
speaker pin (it uses the sam_render.mpy native accelerator if installed, else
falls back to pure Python). Library: https://github.com/kevinmcaleer/sam
"""
from sam import SAM

BUZZER_PIN = 0  # the GPIO your buzzer / speaker is wired to

sam = SAM(pin=BUZZER_PIN)
sam.say("Hello, I am Sam")
`
