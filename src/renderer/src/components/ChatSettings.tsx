import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { CopilotDeviceCode } from '../../../preload/index.d'
import {
  useChatProviders,
  notifyChatConfigChanged,
  invalidateCompletionKeyStatus
} from '../hooks/useChatProviders'
import './ChatSettings.css'

/**
 * CHAT SETTINGS — the Settings dialog's Chat tab (issue #83)
 * =========================================================
 *
 * Everything that used to live in the chat panel's inline ⚙ settings now lives
 * here, so the chat panel keeps only its quick footer selectors:
 *
 *   - the per-provider API-key form (save / remove, key hint, "Get a key" link),
 *     OR the GitHub Copilot device-flow sign-in / sign-out for the Copilot
 *     provider (moved here intact);
 *   - the inline-autocomplete settings (the enable toggle + the per-provider
 *     completion-model selector, issue #82).
 *
 * All values are the SAME persisted keys the chat uses, read/written through
 * {@link useChatProviders} (which broadcasts changes so the chat footer and this
 * tab stay in sync). Provider selection itself is a dropdown here so the user
 * can configure a key for any provider, not just the chat's active one.
 */
export function ChatSettings(): JSX.Element {
  const {
    providers,
    provider,
    providerId,
    setProviderId,
    completionEnabled,
    setCompletionEnabled,
    completionModel,
    setCompletionModel,
    keyStatus,
    refreshKeyStatus,
    error
  } = useChatProviders()

  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Reset the key field when switching providers so a half-typed key never
  // leaks to another provider's form.
  useEffect(() => {
    setKeyInput('')
    setLocalError(null)
  }, [providerId])

  const saveKey = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault()
      if (!provider) return
      setSavingKey(true)
      setLocalError(null)
      try {
        await window.api.llm.setKey(provider.id, keyInput)
        invalidateCompletionKeyStatus(provider.id)
        setKeyInput('')
        await refreshKeyStatus()
        notifyChatConfigChanged()
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err))
      } finally {
        setSavingKey(false)
      }
    },
    [keyInput, provider, refreshKeyStatus]
  )

  const removeKey = useCallback(async (): Promise<void> => {
    if (!provider) return
    setSavingKey(true)
    try {
      await window.api.llm.setKey(provider.id, '')
      invalidateCompletionKeyStatus(provider.id)
      await refreshKeyStatus()
      notifyChatConfigChanged()
    } finally {
      setSavingKey(false)
    }
  }, [provider, refreshKeyStatus])

  const shown = localError ?? error

  return (
    <div className="chat-settings">
      <section className="settings-section">
        <h3 className="settings-section__title">Provider</h3>
        <p className="settings-section__hint">
          Pick a provider to configure its key. The chat&apos;s footer selects which provider and
          model a conversation uses.
        </p>
        <select
          className="chat-settings__select"
          value={provider?.id ?? providerId}
          onChange={(e) => setProviderId(e.target.value)}
          aria-label="Chat provider"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.experimental ? ' (experimental)' : ''}
            </option>
          ))}
        </select>
      </section>

      {provider && provider.id === 'copilot' ? (
        <section className="settings-section">
          <h3 className="settings-section__title">{provider.label} sign-in</h3>
          <CopilotSignIn
            providerLabel={provider.label}
            signedIn={!!keyStatus?.hasKey}
            onChange={async () => {
              invalidateCompletionKeyStatus(provider.id)
              await refreshKeyStatus()
              notifyChatConfigChanged()
            }}
          />
        </section>
      ) : (
        provider && (
          <form className="settings-section" onSubmit={saveKey}>
            <h3 className="settings-section__title">{provider.label} API key</h3>
            <input
              id="chat-settings-key"
              type="password"
              className="chat-settings__input-key"
              placeholder={keyStatus?.hasKey ? '•••••••• (stored)' : provider.keyHint || 'API key'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              autoComplete="off"
            />
            <div className="chat-settings__row">
              <button
                type="submit"
                className="chat-settings__btn chat-settings__btn--primary"
                disabled={savingKey || !keyInput}
              >
                {savingKey ? 'Saving…' : 'Save key'}
              </button>
              {keyStatus?.hasKey && (
                <button
                  type="button"
                  className="chat-settings__btn"
                  onClick={() => void removeKey()}
                  disabled={savingKey}
                >
                  Remove
                </button>
              )}
              {provider.keyUrl && (
                <button
                  type="button"
                  className="chat-settings__btn"
                  onClick={() => void window.api.openExternal(provider.keyUrl as string)}
                >
                  Get a key
                </button>
              )}
            </div>
            {keyStatus && !keyStatus.secure && (
              <p className="chat-settings__warn">
                Secure OS encryption is unavailable on this system; the key is stored obfuscated but
                not encrypted.
              </p>
            )}
            <p className="settings-section__hint">
              Your key is stored locally and used only to call the {provider.label} API from this
              app.
            </p>
          </form>
        )
      )}

      <section className="settings-section">
        <div className="settings-section__row">
          <h3 className="settings-section__title">Autocomplete</h3>
          <label className="chat-settings__switch" title="Suggest code as you type">
            <input
              type="checkbox"
              checked={completionEnabled}
              onChange={(e) => setCompletionEnabled(e.target.checked)}
            />
            <span>{completionEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <p className="settings-section__hint">
          Ghost-text suggestions as you type, using a fast completion model (separate from the chat
          model). Off by default — it spends tokens on every typing pause.
        </p>
        {completionEnabled && provider && (
          <label className="chat-settings__field">
            <span className="chat-settings__field-label">Completion model</span>
            <select
              className="chat-settings__select"
              value={completionModel}
              onChange={(e) => setCompletionModel(e.target.value)}
            >
              {provider.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {shown && <p className="chat-settings__error">{shown}</p>}
    </div>
  )
}

/**
 * GitHub Copilot sign-in via the OAuth device flow (moved from ChatPanel in
 * issue #83). A plain personal access token can't reach the Copilot token
 * endpoint, so the user approves a short code at github.com/login/device; the
 * main process then holds the resulting GitHub token (never exposed here) and
 * exchanges it for the Copilot token.
 */
function CopilotSignIn({
  providerLabel,
  signedIn,
  onChange
}: {
  providerLabel: string
  signedIn: boolean
  onChange: () => Promise<void>
}): JSX.Element {
  const [device, setDevice] = useState<CopilotDeviceCode | null>(null)
  const [phase, setPhase] = useState<'idle' | 'starting' | 'awaiting' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const cancelledRef = useRef(false)

  // Stop polling if the dialog unmounts mid-flow.
  useEffect(() => {
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const poll = useCallback(
    async (dc: CopilotDeviceCode): Promise<void> => {
      const deadline = Date.now() + dc.expiresInSeconds * 1000
      let intervalMs = Math.max(1, dc.intervalSeconds) * 1000
      while (!cancelledRef.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, intervalMs))
        if (cancelledRef.current) return
        let res: Awaited<ReturnType<typeof window.api.llm.copilotDevicePoll>>
        try {
          res = await window.api.llm.copilotDevicePoll(dc.deviceCode)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
          setPhase('error')
          setDevice(null)
          return
        }
        if (res.status === 'authorized') {
          setDevice(null)
          setPhase('idle')
          await onChange()
          return
        }
        if (res.status === 'slow_down') {
          intervalMs += 5000
          continue
        }
        if (res.status === 'pending') continue
        // denied / expired / error — terminal.
        setError(res.message || `Sign-in ${res.status}.`)
        setPhase('error')
        setDevice(null)
        return
      }
      if (!cancelledRef.current) {
        setError('Sign-in timed out — try again.')
        setPhase('error')
        setDevice(null)
      }
    },
    [onChange]
  )

  const start = useCallback(async (): Promise<void> => {
    setError(null)
    setPhase('starting')
    cancelledRef.current = false
    try {
      const dc = await window.api.llm.copilotDeviceStart()
      setDevice(dc)
      setPhase('awaiting')
      void window.api.openExternal(dc.verificationUri)
      void poll(dc)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }, [poll])

  if (signedIn && phase === 'idle') {
    return (
      <div className="chat-settings__copilot">
        <p className="settings-section__hint">✓ Signed in to {providerLabel}.</p>
        <div className="chat-settings__row">
          <button
            type="button"
            className="chat-settings__btn"
            onClick={async () => {
              await window.api.llm.setKey('copilot', '')
              await onChange()
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-settings__copilot">
      {phase === 'awaiting' && device ? (
        <>
          <p className="settings-section__hint">
            A GitHub page opened — enter this code to authorize Snakie:
          </p>
          <div className="chat-settings__copilot-code">
            <code>{device.userCode}</code>
            <button
              type="button"
              className="chat-settings__btn"
              onClick={() =>
                void navigator.clipboard
                  .writeText(device.userCode)
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1200)
                  })
                  .catch(() => undefined)
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="chat-settings__row">
            <button
              type="button"
              className="chat-settings__btn"
              onClick={() => void window.api.openExternal(device.verificationUri)}
            >
              Reopen github.com/login/device
            </button>
          </div>
          <p className="settings-section__hint">Waiting for you to authorize…</p>
        </>
      ) : (
        <>
          <p className="settings-section__hint">
            Sign in with your GitHub account (needs an active Copilot subscription) — no personal
            access token required.
          </p>
          <div className="chat-settings__row">
            <button
              type="button"
              className="chat-settings__btn chat-settings__btn--primary"
              onClick={() => void start()}
              disabled={phase === 'starting'}
            >
              {phase === 'starting' ? 'Starting…' : 'Sign in to GitHub Copilot'}
            </button>
          </div>
        </>
      )}
      {error && <p className="chat-settings__error">{error}</p>}
    </div>
  )
}
