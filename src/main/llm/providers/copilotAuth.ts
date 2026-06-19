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
