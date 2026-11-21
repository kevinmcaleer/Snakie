import { describe, expect, it } from 'vitest'
import {
  KR_ACCOUNTS_URL,
  KR_PROJECTS_API,
  KevsrobotsClient,
  authorizeUrl,
  exchangeCode,
  githubWebUrl,
  parseCallback,
  pkceChallenge,
  randomUrlSafe,
  type KrTokens,
  type TokenStore
} from '../src/shared/kevsrobots-account'

/** A token store that is just a variable. */
function memoryStore(initial: KrTokens | null = null): TokenStore & { tokens: KrTokens | null } {
  const s = {
    tokens: initial,
    async load() {
      return s.tokens
    },
    async save(t: KrTokens | null) {
      s.tokens = t
    }
  }
  return s
}

const NOW = 1_800_000_000_000

function tokens(over: Partial<KrTokens> = {}): KrTokens {
  return { accessToken: 'a1', refreshToken: 'r1', expiresAt: NOW + 3_600_000, scope: 'profile projects:read projects:write', ...over }
}

interface Call {
  url: string
  init?: RequestInit
}

/** A fetch that answers from a list of handlers, recording every call. */
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const call = { url, init }
    calls.push(call)
    const { status = 200, body = {} } = handler(call)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { fn, calls }
}

const auth = (c: Call): string | undefined => (c.init?.headers as Record<string, string> | undefined)?.Authorization
const form = (c: Call): URLSearchParams => new URLSearchParams(String(c.init?.body ?? ''))

describe('PKCE and the authorize address', () => {
  it('makes URL-safe random strings long enough for a verifier', () => {
    const v = randomUrlSafe(48)
    expect(v).toMatch(/^[A-Za-z0-9_-]{64}$/)
    expect(randomUrlSafe(48)).not.toBe(v)
  })

  it('computes the RFC 7636 S256 challenge', async () => {
    // The worked example from RFC 7636 appendix B.
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('asks accounts.kevsrobots.com for the snakie client with S256', () => {
    const url = new URL(authorizeUrl({ redirectUri: 'http://127.0.0.1:5000/callback', challenge: 'c', state: 's' }))
    expect(url.origin + url.pathname).toBe(`${KR_ACCOUNTS_URL}/oauth/authorize`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'snakie',
      redirect_uri: 'http://127.0.0.1:5000/callback',
      scope: 'profile projects:read projects:write',
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256'
    })
  })
})

describe('reading the redirect back', () => {
  it('takes the code when state matches', () => {
    expect(parseCallback('https://app.snakie.org/auth/callback/?code=abc&state=s1', 's1')).toEqual({ code: 'abc' })
  })
  it('refuses a different state', () => {
    expect(parseCallback('https://x/cb?code=abc&state=other', 's1')).toHaveProperty('error')
  })
  it('says Cancel plainly', () => {
    expect(parseCallback('https://x/cb?error=access_denied&state=s1', 's1')).toEqual({ error: 'Sign-in was cancelled.' })
  })
  it('passes other errors on', () => {
    expect(parseCallback('https://x/cb?error=invalid_scope&error_description=Nope&state=s1', 's1')).toEqual({ error: 'Nope' })
  })
  it('copes with no code and a bad address', () => {
    expect(parseCallback('https://x/cb?state=s1', 's1')).toHaveProperty('error')
    expect(parseCallback('not a url', 's1')).toHaveProperty('error')
  })
})

describe('the token endpoint', () => {
  it('swaps a code and verifier for tokens', async () => {
    const f = fakeFetch(() => ({ body: { access_token: 'A', refresh_token: 'R', expires_in: 3600, scope: 'profile' } }))
    const t = await exchangeCode(f.fn, { code: 'C', verifier: 'V', redirectUri: 'http://127.0.0.1:1/callback' }, NOW)
    expect(t).toEqual({ accessToken: 'A', refreshToken: 'R', expiresAt: NOW + 3_600_000, scope: 'profile' })
    expect(f.calls[0].url).toBe(`${KR_ACCOUNTS_URL}/oauth/token`)
    expect(Object.fromEntries(form(f.calls[0]))).toEqual({
      client_id: 'snakie',
      grant_type: 'authorization_code',
      code: 'C',
      code_verifier: 'V',
      redirect_uri: 'http://127.0.0.1:1/callback'
    })
  })

  it('throws the server description on an error', async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant', error_description: 'The code has expired' } }))
    await expect(exchangeCode(f.fn, { code: 'C', verifier: 'V', redirectUri: 'x' })).rejects.toThrow('The code has expired')
  })
})

describe('GitHub links from git remotes', () => {
  it.each([
    ['git@github.com:me/robot.git', 'https://github.com/me/robot'],
    ['https://github.com/me/robot.git', 'https://github.com/me/robot'],
    ['https://github.com/me/robot', 'https://github.com/me/robot'],
    ['https://token@github.com/me/robot.git', 'https://github.com/me/robot'],
    ['ssh://git@github.com/me/my.robot', 'https://github.com/me/my.robot'],
    ['https://gitlab.com/me/robot.git', null],
    ['', null],
    [null, null]
  ])('%s → %s', (remote, web) => {
    expect(githubWebUrl(remote)).toBe(web)
  })
})

describe('KevsrobotsClient', () => {
  it('is signed out with no tokens and calls nothing', async () => {
    const f = fakeFetch(() => ({}))
    const client = new KevsrobotsClient(memoryStore(), f.fn, () => NOW)
    expect(await client.status()).toEqual({ signedIn: false })
    const res = await client.listProjects()
    expect(res).toMatchObject({ ok: false, signedOut: true })
    expect(f.calls).toHaveLength(0)
  })

  it('reads who is signed in', async () => {
    const f = fakeFetch(() => ({
      body: { username: 'kev', name: 'Kev M', picture: null, profile_url: 'https://www.kevsrobots.com/profile/kev' }
    }))
    const client = new KevsrobotsClient(memoryStore(tokens()), f.fn, () => NOW)
    expect(await client.status()).toEqual({
      signedIn: true,
      user: { username: 'kev', name: 'Kev M', picture: null, profileUrl: 'https://www.kevsrobots.com/profile/kev' }
    })
    expect(f.calls[0].url).toBe(`${KR_ACCOUNTS_URL}/oauth/userinfo`)
    expect(auth(f.calls[0])).toBe('Bearer a1')
  })

  it('lists projects with the access token', async () => {
    const f = fakeFetch(() => ({
      body: [{ id: 7, title: 'Rover', slug: 'rover', status: 'wip', has_unpublished_changes: true }]
    }))
    const client = new KevsrobotsClient(memoryStore(tokens()), f.fn, () => NOW)
    expect(await client.listProjects()).toEqual({
      ok: true,
      value: [{ id: 7, title: 'Rover', slug: 'rover', status: 'wip', hasUnpublishedChanges: true }]
    })
    expect(f.calls[0].url).toBe(`${KR_PROJECTS_API}/api/projects/my/list`)
  })

  it('refreshes an access token that has run out, and keeps the new pair', async () => {
    const store = memoryStore(tokens({ expiresAt: NOW - 1 }))
    const f = fakeFetch((c) =>
      c.url.endsWith('/oauth/token')
        ? { body: { access_token: 'a2', refresh_token: 'r2', expires_in: 3600, scope: 'projects:read' } }
        : { body: [] }
    )
    const client = new KevsrobotsClient(store, f.fn, () => NOW)
    expect(await client.listProjects()).toEqual({ ok: true, value: [] })
    expect(form(f.calls[0]).get('grant_type')).toBe('refresh_token')
    expect(form(f.calls[0]).get('refresh_token')).toBe('r1')
    expect(auth(f.calls[1])).toBe('Bearer a2')
    expect(store.tokens?.refreshToken).toBe('r2')
  })

  it('refreshes once when the API turns the access token down', async () => {
    let first = true
    const f = fakeFetch((c) => {
      if (c.url.endsWith('/oauth/token')) return { body: { access_token: 'a2', refresh_token: 'r2', expires_in: 3600, scope: '' } }
      if (first) {
        first = false
        return { status: 401, body: { detail: 'expired' } }
      }
      return { body: [] }
    })
    const client = new KevsrobotsClient(memoryStore(tokens()), f.fn, () => NOW)
    expect(await client.listProjects()).toEqual({ ok: true, value: [] })
    expect(f.calls.map((c) => c.url.split('/').pop())).toEqual(['list', 'token', 'list'])
  })

  it('signs out when the refresh token is refused (revoked, reused or expired)', async () => {
    const store = memoryStore(tokens({ expiresAt: NOW - 1 }))
    const f = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }))
    const client = new KevsrobotsClient(store, f.fn, () => NOW)
    expect(await client.listProjects()).toMatchObject({ ok: false, signedOut: true })
    expect(store.tokens).toBeNull()
  })

  it('keeps the tokens when kevsrobots simply cannot be reached', async () => {
    const store = memoryStore(tokens({ expiresAt: NOW - 1 }))
    const client = new KevsrobotsClient(
      store,
      async () => {
        throw new TypeError('Failed to fetch')
      },
      () => NOW
    )
    const res = await client.listProjects()
    expect(res.ok).toBe(false)
    expect(res).not.toHaveProperty('signedOut')
    expect(store.tokens).not.toBeNull()
  })

  it('sends the wiring, picture and GitHub link', async () => {
    const f = fakeFetch(() => ({
      body: {
        project_id: 7,
        title: 'Rover',
        url: 'https://www.kevsrobots.com/projects/kev/rover',
        repo_url: 'https://github.com/kev/rover',
        added_wiring_section: true
      }
    }))
    const client = new KevsrobotsClient(memoryStore(tokens()), f.fn, () => NOW)
    const robot = { name: 'Rover', parts: [], connections: [] }
    const res = await client.sendWiring({ projectId: 7, robot, svg: '<svg/>', repoUrl: 'https://github.com/kev/rover' })
    expect(res).toEqual({
      ok: true,
      value: {
        projectId: 7,
        title: 'Rover',
        url: 'https://www.kevsrobots.com/projects/kev/rover',
        repoUrl: 'https://github.com/kev/rover',
        addedWiringSection: true
      }
    })
    expect(f.calls[0].url).toBe(`${KR_PROJECTS_API}/api/projects/7/wiring/send`)
    expect(f.calls[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({
      data: robot,
      svg: '<svg/>',
      repo_url: 'https://github.com/kev/rover'
    })
  })

  it('makes a draft project for the Share sheet', async () => {
    const f = fakeFetch(() => ({
      status: 201,
      body: { id: 9, title: 'openduck', slug: 'openduck', status: 'draft', editor_url: 'https://www.kevsrobots.com/projects/editor.html?id=9' }
    }))
    const client = new KevsrobotsClient(memoryStore(tokens()), f.fn, () => NOW)
    const res = await client.createProject({ title: 'openduck', repoUrl: 'https://github.com/kev/openduck' })
    expect(res).toEqual({
      ok: true,
      value: {
        id: 9,
        title: 'openduck',
        slug: 'openduck',
        status: 'draft',
        hasUnpublishedChanges: false,
        editorUrl: 'https://www.kevsrobots.com/projects/editor.html?id=9'
      }
    })
    expect(f.calls[0].url).toBe(`${KR_PROJECTS_API}/api/projects/app/new`)
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ title: 'openduck', code_repo_url: 'https://github.com/kev/openduck' })
  })

  it('sends the robot model as a form, without a JSON content type', async () => {
    const f = fakeFetch(() => ({
      body: {
        project_id: 9,
        title: 'openduck',
        url: null,
        editor_url: 'https://www.kevsrobots.com/projects/editor.html?id=9',
        files: [{ filename: 'openduck.urdf' }, { filename: 'body.stl' }],
        cover: true
      }
    }))
    const client = new KevsrobotsClient(memoryStore(tokens()), f.fn, () => NOW)
    const res = await client.sendRobot({
      projectId: 9,
      files: [
        { name: 'openduck.urdf', bytes: new TextEncoder().encode('<robot/>') },
        { name: 'body.stl', bytes: new Uint8Array([1, 2, 3]) }
      ],
      cover: { name: 'cover.png', bytes: new Uint8Array([137, 80, 78, 71]) }
    })
    expect(res).toMatchObject({ ok: true, value: { projectId: 9, files: ['openduck.urdf', 'body.stl'], cover: true } })
    expect(f.calls[0].url).toBe(`${KR_PROJECTS_API}/api/projects/9/robot/send`)
    expect(f.calls[0].init?.method).toBe('PUT')
    const body = f.calls[0].init?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.getAll('files').map((x) => (x as File).name)).toEqual(['openduck.urdf', 'body.stl'])
    expect((body.get('cover') as File).name).toBe('cover.png')
    const headers = f.calls[0].init?.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers.Authorization).toMatch(/^Bearer /)
  })

  it('explains the terms gate and other refusals', async () => {
    const terms = fakeFetch(() => ({ status: 403, body: { detail: { detail: 'terms_not_accepted', current_version: '1.0' } } }))
    const c1 = new KevsrobotsClient(memoryStore(tokens()), terms.fn, () => NOW)
    expect(await c1.sendWiring({ projectId: 1, robot: {} })).toMatchObject({ ok: false, error: expect.stringContaining('terms') })
    const notYours = fakeFetch(() => ({ status: 403, body: { detail: 'Not the project owner' } }))
    const c2 = new KevsrobotsClient(memoryStore(tokens()), notYours.fn, () => NOW)
    expect(await c2.sendWiring({ projectId: 1, robot: {} })).toEqual({ ok: false, error: 'Not the project owner' })
  })

  it('signs out by forgetting the tokens and revoking them', async () => {
    const store = memoryStore(tokens())
    const f = fakeFetch(() => ({}))
    const client = new KevsrobotsClient(store, f.fn, () => NOW)
    await client.signOut()
    expect(store.tokens).toBeNull()
    expect(f.calls[0].url).toBe(`${KR_ACCOUNTS_URL}/oauth/revoke`)
    expect(form(f.calls[0]).get('token')).toBe('r1')
  })
})
