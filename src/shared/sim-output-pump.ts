/**
 * The simulator's stdout pump — shared by the desktop worker and the web worker.
 * =============================================================================
 *
 * Both simulators run the MicroPython WASM interpreter in a worker and post its
 * output to the UI in batches. Batching matters: `linebuffer: false` hands us one
 * byte per callback, and a message per byte would swamp the terminal.
 *
 * The trap is WHEN to post. A timer alone is not enough: `time.sleep` in this
 * build of the port is a busy-wait inside `runPython`, so a program such as
 *
 *     while True:
 *         led.value(1); time.sleep(1); led.value(0); print('hello')
 *
 * never returns to the worker's event loop, the timer never fires, and every
 * `hello` sits in the buffer until Stop. That is exactly the "click Run and
 * nothing happens" the web simulator showed: the program WAS running, and its
 * output was stuck in here. The desktop worker had learned this lesson and the
 * web worker had not — hence one pump, used by both, so they cannot drift again.
 *
 * So the pump also posts from inside the stdout callback itself: on every
 * newline, and once a line has grown past {@link FLUSH_BYTES} without one (a
 * progress bar drawn with `end=''`). The timer stays for the tail of a line a
 * program leaves behind (`print('x', end='')` right before a sleep).
 *
 * Capture mode is for the filesystem/probe snippets the app runs behind the
 * scenes: their output is an answer to the app, not text for the terminal, so
 * while a capture is open nothing is posted and everything collects into it.
 */

/** Post a partial line once it reaches this many bytes without a newline. */
export const FLUSH_BYTES = 256

export class SimOutputPump {
  private pending: number[] = []
  private capturing: number[] | null = null

  constructor(private readonly post: (bytes: Uint8Array) => void) {}

  /** The interpreter's `stdout` / `stderr` sink. */
  collect = (bytes: Uint8Array): void => {
    if (this.capturing) {
      for (const b of bytes) this.capturing.push(b)
      return
    }
    let sawNewline = false
    for (const b of bytes) {
      this.pending.push(b)
      if (b === 10) sawNewline = true
    }
    if (sawNewline || this.pending.length >= FLUSH_BYTES) this.flush()
  }

  /** Post whatever has collected for the terminal. A no-op during a capture. */
  flush = (): void => {
    if (this.capturing || this.pending.length === 0) return
    const chunk = Uint8Array.from(this.pending)
    this.pending = []
    this.post(chunk)
  }

  /** Start diverting output into a capture. Terminal output so far goes out first. */
  beginCapture(): void {
    this.flush()
    this.capturing = []
  }

  /** What the capture has collected so far, decoded. */
  captured(): string {
    return new TextDecoder().decode(Uint8Array.from(this.capturing ?? []))
  }

  /** Close the capture; output goes back to the terminal. */
  endCapture(): void {
    this.capturing = null
  }
}
