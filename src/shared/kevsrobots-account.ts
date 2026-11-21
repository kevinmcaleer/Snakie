/**
 * SIGN IN WITH KEVSROBOTS (#1310, kevsrobots.com#582, Chatter#80)
 * =============================================================================
 * Optional. Snakie works offline and signed out exactly as before; signing in
 * only exists so you can send a wiring diagram to one of your kevsrobots
 * projects. Code never goes to kevsrobots (GitHub keeps it).
 *
 * The flow is OAuth 2 authorization code + PKCE against Chatter
 * (accounts.kevsrobots.com), with no client secret:
 *
 *   1. make a random `code_verifier` and `state`, open {@link authorizeUrl};
 *   2. the browser comes back to the redirect URI with `?code=&state=`
 *      ({@link parseCallback}) — app.snakie.org/auth/callback on the web, a
 *      loopback http://127.0.0.1:<port>/callback on the desktop (RFC 8252);
 *   3. {@link exchangeCode} swaps code + verifier for a 1-hour access token and
 *      a 90-day refresh token, rotated on every refresh.
 *
 * {@link KevsrobotsClient} then calls the projects API with
 * `Authorization: Bearer`, refreshing when the access token runs out. Where the
 * tokens live is the platform's business ({@link TokenStore}): the OS keychain
 * via Electron safeStorage on the desktop, localStorage on the web.
 *
 * Pure: no DOM, no Node. `fetch` is passed in and `crypto` is the WebCrypto
 * global both Electron's main process and browsers have, so main, renderer and
 * the unit tests share this one file.
 */

export const KR_ACCOUNTS_URL = 'https://accounts.kevsrobots.com'
export const KR_PROJECTS_API = 'https://projects.kevsrobots.com'
export const KR_CLIENT_ID = 'snakie'
/** Name and avatar, list your projects, make one, send wiring and the robot model. No scope touches code. */
export const KR_SCOPES = 'profile projects:read projects:write'
export const KR_WEB_REDIRECT_URI = 'https://app.snakie.org/auth/callback'
/** The desktop's loopback redirect; Chatter accepts it on any port. */
export const KR_LOOPBACK_PATH = '/callback'

const TIMEOUT_MS = 20_000
/** Refresh a little before the access token actually runs out. */
const EXPIRY_MARGIN_MS = 60_000

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface KrTokens {
  accessToken: string
  refreshToken: string
  /** When the access token runs out, in ms since the epoch. */
  expiresAt: number
  scope: string
}

export interface KrUser {
  username: string
  name: string
  picture: string | null
  profileUrl: string
}

export interface KrStatus {
  signedIn: boolean
  user?: KrUser
}

export interface KrProject {
  id: number
  title: string
  slug: string | null
  status: string
  /** Has the working copy changed since the live version? (author's list only) */
  hasUnpublishedChanges: boolean
}

export interface KrSendWiring {
  projectId: number
  /** The RobotDefinition (board, parts, connections), as robot.yml holds it. */
  robot: unknown
  /** The wiring picture, an SVG string. */
  svg?: string
  /** The code's GitHub address, if the project folder has one. */
  repoUrl?: string
}

export interface KrSent {
  projectId: number
  title: string
  /** The project page on kevsrobots.com, when it has one yet. */
  url: string | null
  repoUrl: string | null
  addedWiringSection: boolean
}

/** A new kevsrobots project for a Snakie project that has none yet (Share sheet). */
export interface KrNewProject {
  title: string
  repoUrl?: string
}

/** A project just made from Snakie: a private draft until its author publishes it. */
export interface KrCreated extends KrProject {
  /** Where the author writes it up and publishes it. */
  editorUrl: string
}

/** One file of the robot model, as bytes. */
export interface KrFile {
  name: string
  bytes: Uint8Array
}

export interface KrSendRobot {
  projectId: number
  /** The URDF and its STL meshes. Never code. */
  files: KrFile[]
  /** A picture of the robot for the project's cover (PNG). */
  cover?: KrFile
}

export interface KrRobotSent {
  projectId: number
  title: string
  url: string | null
  editorUrl: string
  files: string[]
  cover: boolean
}

/** Every call resolves; nothing throws across the IPC bridge. */
export type KrResult<T> = { ok: true; value: T } | { ok: false; error: string; signedOut?: boolean }

/** What the renderer sees as `window.api.kevsrobots`, on both platforms. */
export interface KevsrobotsApi {
  status(): Promise<KrStatus>
  signIn(): Promise<KrResult<KrStatus>>
  signOut(): Promise<void>
  listProjects(): Promise<KrResult<KrProject[]>>
  sendWiring(payload: KrSendWiring): Promise<KrResult<KrSent>>
  /** Make a private draft project (Share sheet). Optional: older hosts lack it. */
  createProject?(payload: KrNewProject): Promise<KrResult<KrCreated>>
  /** Send the robot model and a cover picture to a project (Share sheet). */
  sendRobot?(payload: KrSendRobot): Promise<KrResult<KrRobotSent>>
}

export interface TokenStore {
  load(): Promise<KrTokens | null>
  save(tokens: KrTokens | null): Promise<void>
}

// --- PKCE --------------------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A random URL-safe string, for the PKCE verifier (43+ chars) and `state`. */
export function randomUrlSafe(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64Url(buf)
}

/** BASE64URL(SHA-256(verifier)), RFC 7636's S256 challenge. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export function authorizeUrl(opts: { redirectUri: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: KR_CLIENT_ID,
    redirect_uri: opts.redirectUri,
    scope: KR_SCOPES,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256'
  })
  return `${KR_ACCOUNTS_URL}/oauth/authorize?${q.toString()}`
}

/** Read the redirect back: the code, or a sentence saying why there isn't one. */
export function parseCallback(url: string, expectedState: string): { code: string } | { error: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { error: 'Sign-in came back with an address Snakie could not read.' }
  }
  const q = parsed.searchParams
  if (q.get('state') !== expectedState) {
    return { error: 'Sign-in came back for a different request. Try again.' }
  }
  const error = q.get('error')
  if (error === 'access_denied') return { error: 'Sign-in was cancelled.' }
  if (error) return { error: q.get('error_description') || `Sign-in failed (${error}).` }
  const code = q.get('code')
  return code ? { code } : { error: 'Sign-in came back without a code. Try again.' }
}

// --- Token endpoint ----------------------------------------------------------

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
}

async function postForm(fetchFn: FetchFn, url: string, form: Record<string, string>): Promise<Response> {
  return fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
}

async function tokenRequest(fetchFn: FetchFn, form: Record<string, string>, now: number): Promise<KrTokens> {
  const res = await postForm(fetchFn, `${KR_ACCOUNTS_URL}/oauth/token`, { client_id: KR_CLIENT_ID, ...form })
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string }
  if (!res.ok || !body.access_token || !body.refresh_token) {
    const err = new Error(body.error_description || body.error || `kevsrobots answered ${res.status}`)
    ;(err as Error & { oauthError?: string }).oauthError = body.error
    throw err
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
    scope: body.scope ?? ''
  }
}

export function exchangeCode(
  fetchFn: FetchFn,
  opts: { code: string; verifier: string; redirectUri: string },
  now = Date.now()
): Promise<KrTokens> {
  return tokenRequest(
    fetchFn,
    { grant_type: 'authorization_code', code: opts.code, code_verifier: opts.verifier, redirect_uri: opts.redirectUri },
    now
  )
}

export function refreshTokens(fetchFn: FetchFn, refreshToken: string, now = Date.now()): Promise<KrTokens> {
  return tokenRequest(fetchFn, { grant_type: 'refresh_token', refresh_token: refreshToken }, now)
}

// --- GitHub address ----------------------------------------------------------

/**
 * A git remote as the GitHub page for the repo, or null when it isn't GitHub:
 * `git@github.com:me/robot.git`, `ssh://git@github.com/me/robot` and
 * `https://github.com/me/robot.git` all give `https://github.com/me/robot`.
 */
export function githubWebUrl(remote: string | null | undefined): string | null {
  const s = (remote ?? '').trim()
  const m =
    /^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(s) ??
    /^(?:ssh:\/\/git@|https:\/\/(?:[^@/]+@)?)github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(s)
  return m ? `https://github.com/${m[1]}/${m[2]}` : null
}

// --- The client --------------------------------------------------------------

const SIGNED_OUT = 'Your kevsrobots sign-in has ended. Sign in again to send.'

/** Projects API and userinfo calls with the stored tokens, refreshed as needed. */
export class KevsrobotsClient {
  constructor(
    private readonly store: TokenStore,
    private readonly fetchFn: FetchFn,
    private readonly now: () => number = Date.now
  ) {}

  /** Store fresh tokens from a sign-in and read who signed in. */
  async signedIn(tokens: KrTokens): Promise<KrStatus> {
    await this.store.save(tokens)
    return this.status()
  }

  async status(): Promise<KrStatus> {
    if (!(await this.store.load())) return { signedIn: false }
    const res = await this.call<{ username: string; name: string; picture: string | null; profile_url: string }>(
      `${KR_ACCOUNTS_URL}/oauth/userinfo`
    )
    if (!res.ok) return { signedIn: !res.signedOut }
    const u = res.value
    return { signedIn: true, user: { username: u.username, name: u.name, picture: u.picture, profileUrl: u.profile_url } }
  }

  async signOut(): Promise<void> {
    const tokens = await this.store.load()
    await this.store.save(null)
    if (!tokens) return
    // Tell kevsrobots too, so the app disappears from Connected apps. Best effort.
    await postForm(this.fetchFn, `${KR_ACCOUNTS_URL}/oauth/revoke`, {
      token: tokens.refreshToken,
      client_id: KR_CLIENT_ID
    }).catch(() => undefined)
  }

  async listProjects(): Promise<KrResult<KrProject[]>> {
    const res = await this.call<
      { id: number; title: string; slug?: string | null; status: string; has_unpublished_changes?: boolean | null }[]
    >(`${KR_PROJECTS_API}/api/projects/my/list`)
    if (!res.ok) return res
    return {
      ok: true,
      value: res.value.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug ?? null,
        status: p.status,
        hasUnpublishedChanges: !!p.has_unpublished_changes
      }))
    }
  }

  async sendWiring(payload: KrSendWiring): Promise<KrResult<KrSent>> {
    const res = await this.call<{
      project_id: number
      title: string
      url: string | null
      repo_url: string | null
      added_wiring_section: boolean
    }>(`${KR_PROJECTS_API}/api/projects/${encodeURIComponent(String(payload.projectId))}/wiring/send`, {
      method: 'PUT',
      body: JSON.stringify({ data: payload.robot, svg: payload.svg ?? null, repo_url: payload.repoUrl || null })
    })
    if (!res.ok) return res
    const v = res.value
    return {
      ok: true,
      value: {
        projectId: v.project_id,
        title: v.title,
        url: v.url,
        repoUrl: v.repo_url,
        addedWiringSection: v.added_wiring_section
      }
    }
  }

  async createProject(payload: KrNewProject): Promise<KrResult<KrCreated>> {
    const res = await this.call<{ id: number; title: string; slug: string | null; status: string; editor_url: string }>(
      `${KR_PROJECTS_API}/api/projects/app/new`,
      {
        method: 'POST',
        body: JSON.stringify({ title: payload.title, code_repo_url: payload.repoUrl || null })
      }
    )
    if (!res.ok) return res
    const v = res.value
    return {
      ok: true,
      value: {
        id: v.id,
        title: v.title,
        slug: v.slug ?? null,
        status: v.status,
        hasUnpublishedChanges: false,
        editorUrl: v.editor_url
      }
    }
  }

  async sendRobot(payload: KrSendRobot): Promise<KrResult<KrRobotSent>> {
    const form = new FormData()
    for (const f of payload.files) form.append('files', new Blob([f.bytes as Uint8Array<ArrayBuffer>]), f.name)
    if (payload.cover) form.append('cover', new Blob([payload.cover.bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), payload.cover.name)
    const res = await this.call<{
      project_id: number
      title: string
      url: string | null
      editor_url: string
      files: { filename: string }[]
      cover: boolean
    }>(`${KR_PROJECTS_API}/api/projects/${encodeURIComponent(String(payload.projectId))}/robot/send`, {
      method: 'PUT',
      body: form
    })
    if (!res.ok) return res
    const v = res.value
    return {
      ok: true,
      value: {
        projectId: v.project_id,
        title: v.title,
        url: v.url,
        editorUrl: v.editor_url,
        files: (v.files ?? []).map((f) => f.filename),
        cover: !!v.cover
      }
    }
  }

  /** A valid access token, refreshing first if it has (nearly) run out. */
  private async accessToken(forceRefresh = false): Promise<string | null> {
    const tokens = await this.store.load()
    if (!tokens) return null
    if (!forceRefresh && tokens.expiresAt - EXPIRY_MARGIN_MS > this.now()) return tokens.accessToken
    try {
      const fresh = await refreshTokens(this.fetchFn, tokens.refreshToken, this.now())
      await this.store.save(fresh)
      return fresh.accessToken
    } catch (err) {
      // invalid_grant: expired, revoked or reused. Anything else (offline) keeps the tokens for next time.
      if ((err as { oauthError?: string }).oauthError === 'invalid_grant') await this.store.save(null)
      return null
    }
  }

  private async call<T>(url: string, init: RequestInit = {}): Promise<KrResult<T>> {
    try {
      for (const forceRefresh of [false, true]) {
        const token = await this.accessToken(forceRefresh)
        if (!token) {
          return (await this.store.load())
            ? { ok: false, error: "Couldn't reach kevsrobots. Check you're online and try again." }
            : { ok: false, error: SIGNED_OUT, signedOut: true }
        }
        const res = await this.fetchFn(url, {
          ...init,
          headers: {
            Accept: 'application/json',
            // A form sets its own multipart boundary.
            ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`
          },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
        if (res.status === 401 && !forceRefresh) continue // the access token was turned down: refresh once
        const body = (await res.json().catch(() => null)) as unknown
        if (res.ok) return { ok: true, value: body as T }
        if (res.status === 401) {
          await this.store.save(null)
          return { ok: false, error: SIGNED_OUT, signedOut: true }
        }
        return { ok: false, error: describeError(res.status, body) }
      }
      return { ok: false, error: SIGNED_OUT, signedOut: true }
    } catch {
      return { ok: false, error: "Couldn't reach kevsrobots. Check you're online and try again." }
    }
  }
}

function describeError(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (detail && typeof detail === 'object' && (detail as { detail?: string }).detail === 'terms_not_accepted') {
    return 'Accept the kevsrobots terms on kevsrobots.com first, then send again.'
  }
  if (typeof detail === 'string' && detail) return detail
  if (status === 403) return "kevsrobots didn't allow that. Is it your project?"
  if (status === 404) return "That project isn't on kevsrobots any more."
  return `kevsrobots answered ${status}. Try again in a moment.`
}
