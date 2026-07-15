/**
 * WEB bug reporting (#206 / #513) — real submissions from app.snakie.org.
 * =============================================================================
 * Mirrors the desktop handler (src/main/feedback/ipc.ts): the same feedback
 * endpoint, `_SNAKIE_` message prefix, field caps and error copy — but posted
 * straight from the browser. The shared app key is baked in at build time
 * (`VITE_SNAKIE_FEEDBACK_KEY`, from the same CI secret as the desktop builds);
 * it is post-only, rate-limited and behind Cloudflare on the server side, so
 * exposing it in the bundle is an accepted trade-off. The web CSP allowlists
 * the endpoint origin (vite.web.config.ts).
 */

const FEEDBACK_URL = 'https://projects.kevsrobots.com/api/feedback'
const TIMEOUT_MS = 20_000
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024 // server cap: 4 MB
const MAX_MESSAGE = 16_000 // server cap on `message`

interface BugReportPayload {
  title: string
  description: string
  email?: string
  screenshot?: string
}
interface BugReportResult {
  ok: boolean
  status?: number
  error?: string
}

/** Decode a `data:image/png;base64,…` URL to raw bytes (or null if not one). */
function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/[\w.+-]+;base64,(.+)$/s.exec(dataUrl)
  if (!m) return null
  try {
    const bin = atob(m[1])
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** Build the web `feedback` + `diagnostics` API surfaces. */
export function createWebFeedbackApi(version: string): {
  feedback: { submitBugReport: (payload: BugReportPayload) => Promise<BugReportResult> }
  diagnostics: () => Promise<{
    platform: string
    arch: string
    osVersion: string
    electron: string
    snakieVersion: string
  }>
} {
  const appKey =
    (import.meta.env as unknown as { VITE_SNAKIE_FEEDBACK_KEY?: string }).VITE_SNAKIE_FEEDBACK_KEY ?? ''

  return {
    diagnostics: async () => ({
      platform: 'web',
      arch: '',
      // The closest a browser offers: its UA string (bounded — it's for a report).
      osVersion: navigator.userAgent.slice(0, 200),
      electron: '',
      snakieVersion: version
    }),

    feedback: {
      submitBugReport: async (payload: BugReportPayload): Promise<BugReportResult> => {
        const title = (payload?.title ?? '').trim()
        const description = (payload?.description ?? '').trim()
        if (!title || !description) {
          return { ok: false, error: 'Please add a title and a description.' }
        }
        // `_SNAKIE_` prefix so Snakie bugs are filterable in the shared feedback DB.
        const message = `_SNAKIE_ ${title}\n\n${description}`.slice(0, MAX_MESSAGE)

        const form = new FormData()
        form.append('sentiment', 'issue')
        form.append('message', message)
        form.append('page_url', window.location.origin || 'https://app.snakie.org')
        form.append('user_agent', `Snakie/${version} (web) ${navigator.userAgent}`.slice(0, 320))
        const email = (payload?.email ?? '').trim()
        if (email) form.append('email', email.slice(0, 320))

        if (payload?.screenshot) {
          const bytes = decodeDataUrl(payload.screenshot)
          if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_SCREENSHOT_BYTES) {
            form.append('screenshot', new Blob([bytes as BlobPart], { type: 'image/png' }), 'screenshot.png')
          }
        }

        const headers: Record<string, string> = {}
        if (appKey) headers['X-Snakie-Key'] = appKey

        try {
          const res = await fetch(FEEDBACK_URL, {
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
          if (res.status === 429) {
            return { ok: false, status: 429, error: 'Too many reports right now — please try again in a minute.' }
          }
          return { ok: false, status: res.status, error: `The bug service returned HTTP ${res.status}.` }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          return { ok: false, error: `Couldn't reach the bug service: ${reason}` }
        }
      }
    }
  }
}

/**
 * Web screenshot capture for the Report Bug panel: the desktop app composites
 * Electron windows, which a browser can't do — but the Screen Capture API can
 * grab the tab. The browser shows its own picker (we hint "this tab"); we pull
 * ONE frame, downscale to keep the PNG under the server's 4 MB cap, and stop
 * the track immediately. Cancelling the picker yields [] (no screenshot).
 */
export async function captureTabScreenshot(): Promise<{ title: string; dataUrl: string }[]> {
  const md = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (opts?: unknown) => Promise<MediaStream>
  }
  if (!md?.getDisplayMedia) return []
  let stream: MediaStream | null = null
  const video = document.createElement('video')
  try {
    stream = await md.getDisplayMedia({
      video: true,
      audio: false,
      // Chromium hints: offer the Snakie tab first, and allow picking ourselves.
      preferCurrentTab: true,
      selfBrowserSurface: 'include'
    })
    video.srcObject = stream
    video.muted = true
    await video.play()
    // Wait until real pixels exist (videoWidth is 0 until the first frame).
    if (!video.videoWidth) {
      await new Promise<void>((res, rej) => {
        video.onloadeddata = (): void => res()
        video.onerror = (): void => rej(new Error('no frame'))
        window.setTimeout(() => rej(new Error('capture timed out')), 5000)
      })
    }
    const scale = Math.min(1, 1600 / Math.max(1, video.videoWidth))
    const w = Math.max(2, Math.round(video.videoWidth * scale))
    const h = Math.max(2, Math.round(video.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return []
    ctx.drawImage(video, 0, 0, w, h)
    return [{ title: 'Snakie (tab capture)', dataUrl: canvas.toDataURL('image/png') }]
  } catch {
    return [] // picker cancelled / capture unavailable — the panel just has no shot
  } finally {
    video.srcObject = null
    stream?.getTracks().forEach((t) => t.stop())
  }
}
