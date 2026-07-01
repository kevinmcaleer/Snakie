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
 * AUTH CAVEAT: the feedback endpoint authenticates the reporter (a Chatter JWT
 * sent as a cookie by the website widget). A desktop app has no such session, so
 * we send an optional bearer token from `SNAKIE_FEEDBACK_TOKEN` when configured;
 * without it the endpoint returns 401/403 and we surface a clear message.
 * `SNAKIE_FEEDBACK_URL` overrides the endpoint. Provisioning a token — or an
 * anonymous `_SNAKIE_` path on the server — makes submissions land without a
 * user session.
 */

const DEFAULT_FEEDBACK_URL = 'https://projects.kevsrobots.com/api/feedback'
const TIMEOUT_MS = 20_000
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024 // server cap: 4 MB
const MAX_MESSAGE = 2000 // server cap on `message`

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
