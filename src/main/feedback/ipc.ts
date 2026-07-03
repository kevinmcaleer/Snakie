import { app, ipcMain } from 'electron'

/**
 * Bug-report submission (issue #206).
 *
 * Snakie's "Report Bug" form POSTs here; we forward it to kevsrobots.com's
 * existing feedback API — the SAME database that backs the website's feedback
 * widget — as a multipart/form-data submission, tagging the message with
 * `_SNAKIE_` so Snakie bugs are filterable from site feedback. Network access
 * lives in the MAIN process because the renderer's CSP forbids outbound requests
 * (mirrors packages/search.ts + parts/registry.ts): main-process `fetch`,
 * `AbortSignal.timeout`, and we NEVER throw — always return `{ ok, error? }`.
 *
 * AUTH: the website widget posts with a logged-in cookie, which a desktop app
 * has no equivalent for. Two configurable options let reports land without a
 * user session: `SNAKIE_FEEDBACK_KEY` is sent as `X-Snakie-Key` for the server's
 * anonymous, key-gated `_SNAKIE_` path (the primary route); `SNAKIE_FEEDBACK_TOKEN`
 * is sent as `Authorization: Bearer …` if a service token is used instead.
 * `SNAKIE_FEEDBACK_URL` overrides the endpoint. With neither configured the
 * endpoint returns 401/403 and we surface a clear message.
 *
 * The key is normally BAKED IN at build time (`__SNAKIE_FEEDBACK_KEY__`, from the
 * `SNAKIE_FEEDBACK_KEY` CI secret) so packaged apps carry it; the runtime env var
 * still overrides that for dev / self-hosting.
 */

// Build-time-baked shared app key (electron.vite.config.ts `define`). Lets a
// PACKAGED app carry the key without a user having to set an env var; the
// runtime env var below still wins, so dev can override it. Declared here so
// tsc is happy — Vite replaces the identifier with a string literal at build.
declare const __SNAKIE_FEEDBACK_KEY__: string

const DEFAULT_FEEDBACK_URL = 'https://projects.kevsrobots.com/api/feedback'
const TIMEOUT_MS = 20_000
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024 // server cap: 4 MB
// Server cap on `message`. Raised alongside the API (kevsrobots.com #216) so a
// report can carry the diagnostics block + opt-in console output, not just a
// couple of sentences. The renderer already bounds the console tail it appends.
const MAX_MESSAGE = 16_000

/** Payload the renderer sends. `screenshot` is a PNG **data URL**, if attached. */
export interface BugReportPayload {
  title: string
  description: string
  email?: string
  screenshot?: string
}

export interface BugReportResult {
  ok: boolean
  status?: number
  error?: string
}

/** Decode a `data:image/png;base64,…` URL to raw bytes (or null if not one).
 *  Returns a Uint8Array over a plain ArrayBuffer so it's a valid Blob part. */
function decodeDataUrl(dataUrl: string): Uint8Array<ArrayBuffer> | null {
  const m = /^data:image\/[\w.+-]+;base64,(.+)$/s.exec(dataUrl)
  if (!m) return null
  try {
    const buf = Buffer.from(m[1], 'base64')
    // Copy into a fresh ArrayBuffer-backed view so it's an unambiguous BlobPart
    // (Buffer's backing store is typed as ArrayBufferLike, which Blob rejects).
    const out = new Uint8Array(buf.byteLength)
    out.set(buf)
    return out
  } catch {
    return null
  }
}

export function registerFeedbackIpc(): void {
  ipcMain.handle(
    'feedback:submitBugReport',
    async (_e, payload: BugReportPayload): Promise<BugReportResult> => {
      const title = (payload?.title ?? '').trim()
      const description = (payload?.description ?? '').trim()
      if (!title || !description) {
        return { ok: false, error: 'Please add a title and a description.' }
      }

      const url = process.env.SNAKIE_FEEDBACK_URL || DEFAULT_FEEDBACK_URL
      const token = process.env.SNAKIE_FEEDBACK_TOKEN
      // Runtime env wins (dev/self-host override); otherwise fall back to the
      // key baked into the build so packaged apps can report bugs (#206).
      const appKey = process.env.SNAKIE_FEEDBACK_KEY || __SNAKIE_FEEDBACK_KEY__

      // `_SNAKIE_` prefix so Snakie bugs are filterable in the shared feedback DB.
      const message = `_SNAKIE_ ${title}\n\n${description}`.slice(0, MAX_MESSAGE)

      const form = new FormData()
      form.append('sentiment', 'issue') // the API's bug/issue sentiment
      form.append('message', message)
      form.append('page_url', 'snakie://app') // required; no web page in a desktop app
      form.append('user_agent', `Snakie/${app.getVersion()} (${process.platform} ${process.arch})`)
      const email = (payload?.email ?? '').trim()
      if (email) form.append('email', email.slice(0, 320))

      if (payload?.screenshot) {
        const bytes = decodeDataUrl(payload.screenshot)
        if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_SCREENSHOT_BYTES) {
          form.append('screenshot', new Blob([bytes], { type: 'image/png' }), 'screenshot.png')
        }
      }

      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      // App key for the anonymous, key-gated `_SNAKIE_` feedback path on the
      // server (no user session): the endpoint accepts the report when this
      // matches, so desktop bug reports can land without a logged-in user.
      if (appKey) headers['X-Snakie-Key'] = appKey

      try {
        const res = await fetch(url, {
          method: 'POST',
          body: form,
          headers,
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
        if (res.ok) return { ok: true, status: res.status }
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            status: res.status,
            error:
              "Couldn't send — the bug service isn't accepting reports from Snakie yet " +
              '(not authorised). A maintainer needs to provision access.'
          }
        }
        return { ok: false, status: res.status, error: `The bug service returned HTTP ${res.status}.` }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Couldn't reach the bug service: ${reason}` }
      }
    }
  )
}
