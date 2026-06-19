/**
 * GitHub Copilot token exchange.
 *
 * The Copilot chat endpoint (`api.githubcopilot.com`) does NOT authenticate with
 * a GitHub credential directly — it needs a short-lived "Copilot token". Per the
 * GitHub Copilot SDK, the accepted inputs are GitHub OAuth / app-user tokens and
 * **personal access tokens** (`gho_…`, `ghu_…`, `github_pat_…`, or a classic
 * PAT) on an account with an active Copilot subscription. We mirror the
 * documented editor flow: exchange the GitHub token at
 * `GET https://api.github.com/copilot_internal/v2/token`, then reuse the
 * returned token until just before it expires.
 *
 * Both the GitHub token (the user's PAT) and the exchanged Copilot token stay in
 * the main process and are never logged.
 */

const TOKEN_EXCHANGE_URL = 'https://api.github.com/copilot_internal/v2/token'

/** Refresh this many seconds before the token's stated expiry, to avoid races. */
const EXPIRY_SKEW_SECONDS = 60

interface CachedToken {
  token: string
  /** Unix epoch seconds at which the Copilot token expires. */
  expiresAt: number
}

/** In-memory cache keyed by the GitHub token, so a changed PAT re-exchanges. */
const cache = new Map<string, CachedToken>()

/**
 * Resolve a usable Copilot bearer token from a GitHub token (PAT/OAuth),
 * exchanging + caching as needed. Throws a friendly error when the GitHub token
 * is rejected (e.g. no Copilot subscription).
 */
export async function getCopilotToken(githubToken: string, signal?: AbortSignal): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const cached = cache.get(githubToken)
  if (cached && cached.expiresAt - EXPIRY_SKEW_SECONDS > nowSeconds) {
    return cached.token
  }

  const res = await fetch(TOKEN_EXCHANGE_URL, {
    method: 'GET',
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/json',
      'User-Agent': 'Snakie/1',
      'Editor-Version': 'Snakie/1',
      'Editor-Plugin-Version': 'Snakie/1'
    },
    signal
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `GitHub Copilot token exchange failed (HTTP ${res.status}). Use a GitHub ` +
        `personal access token (or OAuth token) for an account with an active ` +
        `Copilot subscription.` +
        (detail ? ` ${detail.slice(0, 160)}` : '')
    )
  }

  const json = (await res.json()) as { token?: string; expires_at?: number }
  if (!json.token) {
    throw new Error('GitHub Copilot token exchange returned no token.')
  }
  const expiresAt =
    typeof json.expires_at === 'number' ? json.expires_at : nowSeconds + 25 * 60
  cache.set(githubToken, { token: json.token, expiresAt })
  return json.token
}

/** Drop all cached Copilot tokens (e.g. after the stored GitHub token changes). */
export function clearCopilotTokenCache(): void {
  cache.clear()
}

// ── GitHub OAuth device flow ────────────────────────────────────────────────
//
// A plain personal access token can't reach the Copilot token-exchange endpoint
// (it returns 404). The working path — used by open-source editor Copilot
// integrations — is GitHub's OAuth **device flow**: the user approves a short
// code at github.com/login/device, we receive a `gho_` user-access token bound
// to GitHub's first-party Copilot OAuth app, and THAT token exchanges cleanly
// via `getCopilotToken` above. We use GitHub's public Copilot client id (it is
// not a secret — it ships in those editor integrations).

const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'

/** The device-code grant the user must approve in their browser. */
export interface CopilotDeviceCode {
  /** Opaque code we poll the token endpoint with. Never shown to the user. */
  deviceCode: string
  /** The short code the user types at the verification URL. */
  userCode: string
  /** Where the user enters {@link userCode} (e.g. https://github.com/login/device). */
  verificationUri: string
  /** Minimum seconds between poll attempts. */
  intervalSeconds: number
  /** Seconds until the device code expires. */
  expiresInSeconds: number
}

/** Outcome of one poll of the device-flow token endpoint. */
export type CopilotPollStatus =
  | 'pending'
  | 'slow_down'
  | 'authorized'
  | 'denied'
  | 'expired'
  | 'error'

export interface CopilotPollResult {
  status: CopilotPollStatus
  /** The `gho_` user token — only present (and only handled in main) when authorized. */
  token?: string
  message?: string
}

/** Begin the device flow: request a user code + verification URL to show. */
export async function startCopilotDeviceFlow(): Promise<CopilotDeviceCode> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Snakie/1'
    },
    body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: 'read:user' })
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `GitHub device-code request failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`
    )
  }
  const json = (await res.json()) as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    interval?: number
    expires_in?: number
  }
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error('GitHub device-code response was missing required fields.')
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    intervalSeconds: typeof json.interval === 'number' ? json.interval : 5,
    expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : 900
  }
}

/**
 * Poll once for the access token. Returns `pending`/`slow_down` while the user
 * hasn't approved yet, `authorized` (with the `gho_` token) once they have, or a
 * terminal `denied`/`expired`/`error`.
 */
export async function pollCopilotDeviceFlow(deviceCode: string): Promise<CopilotPollResult> {
  const res = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Snakie/1'
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  })
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error?: string
    error_description?: string
  }
  if (json.access_token) return { status: 'authorized', token: json.access_token }
  switch (json.error) {
    case 'authorization_pending':
      return { status: 'pending' }
    case 'slow_down':
      return { status: 'slow_down' }
    case 'expired_token':
      return { status: 'expired' }
    case 'access_denied':
      return { status: 'denied' }
    default:
      return {
        status: 'error',
        message: json.error_description || json.error || `HTTP ${res.status}`
      }
  }
}
