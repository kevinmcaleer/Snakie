import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CopilotDeviceCode,
  LlmKeyStatus,
  LlmMessage,
  LlmProviderInfo,
  LlmStreamEvent
} from '../../../preload/index.d'
import { useWorkspace } from '../store/workspace'
import { useConsole } from '../store/console'
import { useLocalStorage } from '../hooks/useLocalStorage'
import {
  COMPLETION_ENABLED_KEY,
  COMPLETION_MODELS_KEY,
  notifyCompletionConfigChanged
} from '../store/completionConfig'
import { invalidateCompletionKeyStatus } from './inline-completions'
import './ChatPanel.css'

/**
 * CHAT TAB (issue #18, generalized in #77 + #78)
 * ==============================================
 *
 * An in-app multi-provider chat assistant. The message thread, an input box,
 * per-provider API-key settings, a subtle footer bar to pick provider / model /
 * effort / speed, and toggles to attach the active editor file and recent
 * console output as context.
 *
 * All provider API calls run in the MAIN process (the renderer CSP blocks
 * external requests), so this panel only talks to `window.api.llm`. Replies are
 * streamed: `sendMessage` resolves with the full text, but we also subscribe to
 * `onStream` deltas so the assistant bubble fills in live.
 *
 * If no API key is stored for the selected provider, the panel prompts for one
 * rather than crashing.
 */

/** Window CustomEvent name the ShellPanel "Send to chat" button dispatches (issue #78). */
export const SEND_CONSOLE_EVENT = 'snakie:send-console-to-chat'

interface ChatTurn extends LlmMessage {
  /** Stable key for React lists. */
  id: string
}

export function ChatPanel(): JSX.Element {
  const { openFiles, activeId, updateContent } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId)
  const { getSinceRun } = useConsole()

  // ── Provider registry + persisted selection ────────────────────────────
  const [providers, setProviders] = useState<LlmProviderInfo[]>([])
  const [providerId, setProviderId] = useLocalStorage<string>('snakie.chat.provider', 'anthropic')
  // Per-provider model selection, persisted under snakie.chat.model.<provider>.
  const [modelByProvider, setModelByProvider] = useLocalStorage<Record<string, string>>(
    'snakie.chat.models',
    {}
  )
  const [effortByProvider, setEffortByProvider] = useLocalStorage<Record<string, string>>(
    'snakie.chat.efforts',
    {}
  )
  const [speedByProvider, setSpeedByProvider] = useLocalStorage<Record<string, string>>(
    'snakie.chat.speeds',
    {}
  )
  // Inline autocomplete (issue #82): master on/off (default OFF — opt-in, since
  // it spends tokens on every typing pause) and a per-provider FAST completion
  // model, separate from the chat model. Read live by the Monaco provider via
  // the matching localStorage keys in store/completionConfig.
  const [completionEnabled, setCompletionEnabled] = useLocalStorage<boolean>(
    COMPLETION_ENABLED_KEY,
    false
  )
  const [completionModelByProvider, setCompletionModelByProvider] = useLocalStorage<
    Record<string, string>
  >(COMPLETION_MODELS_KEY, {})

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? providers[0],
    [providers, providerId]
  )
  const model = (provider && modelByProvider[provider.id]) || provider?.defaultModel || ''
  const effort = provider ? effortByProvider[provider.id] : undefined
  const speed = provider ? speedByProvider[provider.id] : undefined
  // The fast completion model: per-provider override, else the provider's
  // declared fast default (issue #82).
  const completionModel =
    (provider && completionModelByProvider[provider.id]) ||
    provider?.defaultCompletionModel ||
    provider?.defaultModel ||
    ''

  // ── Key settings ────────────────────────────────────────────────────────
  const [keyStatus, setKeyStatus] = useState<LlmKeyStatus | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  // ── Thread state ──────────────────────────────────────────────────────────
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  // AI-first default (issue #82): include the active file ON by default so the
  // model always sees the up-to-date editor content. Persisted so a user who
  // turns it off keeps it off.
  const [includeFile, setIncludeFile] = useLocalStorage<boolean>(
    'snakie.chat.includeActiveFile',
    true
  )
  const [includeConsole, setIncludeConsole] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Live-streaming assistant text for the in-flight reply. */
  const [streaming, setStreaming] = useState<string | null>(null)

  const threadRef = useRef<HTMLDivElement>(null)
  const streamingRef = useRef('')

  // Load the provider registry once on mount.
  useEffect(() => {
    void window.api.llm
      .listProviders()
      .then(setProviders)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  // Load whether a key is configured for the selected provider (and re-check
  // whenever the selection changes).
  const refreshKeyStatus = useCallback(async (): Promise<void> => {
    if (!provider) return
    try {
      const status = await window.api.llm.getKeyStatus(provider.id)
      setKeyStatus(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [provider])

  useEffect(() => {
    void refreshKeyStatus()
  }, [refreshKeyStatus])

  // Subscribe to streamed deltas for the in-flight request.
  useEffect(() => {
    const unsub = window.api.llm.onStream((event: LlmStreamEvent) => {
      if (event.type === 'start') {
        streamingRef.current = ''
        setStreaming('')
      } else if (event.type === 'delta') {
        streamingRef.current += event.text
        setStreaming(streamingRef.current)
      }
      // `done` / `error` are handled by the sendMessage promise below.
    })
    return unsub
  }, [])

  // Keep the thread scrolled to the bottom as content grows.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, streaming])

  const saveKey = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault()
      if (!provider) return
      setSavingKey(true)
      setError(null)
      try {
        await window.api.llm.setKey(provider.id, keyInput)
        // The inline-completion provider caches "has key" per provider; a freshly
        // saved key must invalidate that so suggestions start working at once.
        invalidateCompletionKeyStatus(provider.id)
        setKeyInput('')
        await refreshKeyStatus()
        setShowSettings(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSavingKey(false)
      }
    },
    [keyInput, provider, refreshKeyStatus]
  )

  const sendText = useCallback(
    async (text: string, console?: string): Promise<void> => {
      if (!text || busy || !provider) return
      setError(null)

      const userTurn: ChatTurn = { id: `u-${Date.now()}`, role: 'user', content: text }
      const history = [...turns, userTurn]
      setTurns(history)
      setInput('')
      setBusy(true)
      setStreaming('')
      streamingRef.current = ''

      const consoleOutput =
        console ?? (includeConsole ? getSinceRun() || undefined : undefined)

      try {
        const reply = await window.api.llm.sendMessage({
          providerId: provider.id,
          model,
          effort,
          speed,
          messages: history.map((t) => ({ role: t.role, content: t.content })),
          activeFile:
            includeFile && activeFile
              ? { name: activeFile.name, content: activeFile.content }
              : undefined,
          consoleOutput
        })
        setTurns((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: reply }])
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
        setStreaming(null)
        streamingRef.current = ''
      }
    },
    [busy, turns, provider, model, effort, speed, includeFile, activeFile, includeConsole, getSinceRun]
  )

  const send = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault()
      await sendText(input.trim())
    },
    [input, sendText]
  )

  // Listen for "Send to chat" from the ShellPanel: stage the console output into
  // the composer prefilled with a prompt (issue #78). We stage rather than
  // auto-submit so the user can add a question before sending.
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<string>).detail ?? ''
      setIncludeConsole(true)
      setInput((prev) =>
        prev.trim()
          ? prev
          : detail.trim()
            ? 'Here is my console output — can you help me understand it?'
            : ''
      )
      // Reveal the staged output context to the user via the toggle; the actual
      // text is grabbed fresh from the console store at send time.
      const el = threadRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
    window.addEventListener(SEND_CONSOLE_EVENT, handler)
    return () => window.removeEventListener(SEND_CONSOLE_EVENT, handler)
  }, [])

  const clearThread = useCallback((): void => {
    setTurns([])
    setError(null)
    setStreaming(null)
  }, [])

  /**
   * Apply an assistant code block to the ACTIVE file (issue #82). Writes the code
   * through the workspace store; Monaco is bound to the active file and syncs on
   * drift, so the editor updates live and the change is undoable (Ctrl-Z). We
   * REPLACE the file's contents with the block — predictable and easy to undo —
   * rather than trying to merge/splice (the model already sees the whole file
   * since "Include active file" defaults on, so blocks are usually full files).
   */
  const applyToEditor = useCallback(
    (code: string): void => {
      if (!activeId) return
      updateContent(activeId, code)
    },
    [activeId, updateContent]
  )

  const setModel = useCallback(
    (next: string): void => {
      if (!provider) return
      setModelByProvider({ ...modelByProvider, [provider.id]: next })
    },
    [provider, modelByProvider, setModelByProvider]
  )
  const setEffort = useCallback(
    (next: string): void => {
      if (!provider) return
      setEffortByProvider({ ...effortByProvider, [provider.id]: next })
    },
    [provider, effortByProvider, setEffortByProvider]
  )
  const setSpeed = useCallback(
    (next: string): void => {
      if (!provider) return
      setSpeedByProvider({ ...speedByProvider, [provider.id]: next })
    },
    [provider, speedByProvider, setSpeedByProvider]
  )
  const setCompletionModel = useCallback(
    (next: string): void => {
      if (!provider) return
      setCompletionModelByProvider({ ...completionModelByProvider, [provider.id]: next })
      notifyCompletionConfigChanged()
    },
    [provider, completionModelByProvider, setCompletionModelByProvider]
  )
  const toggleCompletionEnabled = useCallback(
    (next: boolean): void => {
      setCompletionEnabled(next)
      notifyCompletionConfigChanged()
    },
    [setCompletionEnabled]
  )

  const ready = keyStatus?.hasKey ?? false
  const providerLabel = provider?.label ?? 'Loading…'

  return (
    <div className="chat">
      <div className="chat__toolbar">
        <span className="chat__status">
          {ready ? `${providerLabel} ready` : 'No API key'}
          {provider?.experimental && <span className="chat__badge">experimental</span>}
        </span>
        <div className="chat__toolbar-actions">
          <button
            type="button"
            className="chat__btn"
            onClick={clearThread}
            disabled={turns.length === 0 || busy}
          >
            Clear
          </button>
          <button
            type="button"
            className="chat__btn"
            onClick={() => setShowSettings((s) => !s)}
            aria-expanded={showSettings}
          >
            ⚙ Key
          </button>
        </div>
      </div>

      {showSettings && provider && provider.id === 'copilot' && (
        <div className="chat__settings">
          <CopilotSignIn
            providerLabel={provider.label}
            signedIn={!!keyStatus?.hasKey}
            onChange={async () => {
              invalidateCompletionKeyStatus(provider.id)
              await refreshKeyStatus()
            }}
          />
        </div>
      )}

      {showSettings && provider && provider.id !== 'copilot' && (
        <form className="chat__settings" onSubmit={saveKey}>
          <label className="chat__settings-label" htmlFor="chat-key">
            {provider.label} API key
          </label>
          <input
            id="chat-key"
            type="password"
            className="chat__input-key"
            placeholder={
              keyStatus?.hasKey ? '•••••••• (stored)' : provider.keyHint || 'API key'
            }
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoComplete="off"
          />
          <div className="chat__settings-row">
            <button type="submit" className="chat__btn chat__btn--primary" disabled={savingKey}>
              {savingKey ? 'Saving…' : 'Save key'}
            </button>
            {keyStatus?.hasKey && (
              <button
                type="button"
                className="chat__btn"
                onClick={async () => {
                  await window.api.llm.setKey(provider.id, '')
                  invalidateCompletionKeyStatus(provider.id)
                  await refreshKeyStatus()
                }}
                disabled={savingKey}
              >
                Remove
              </button>
            )}
            {provider.keyUrl && (
              <button
                type="button"
                className="chat__btn"
                onClick={() => void window.api.openExternal(provider.keyUrl as string)}
              >
                Get a key
              </button>
            )}
          </div>
          {keyStatus && !keyStatus.secure && (
            <p className="chat__settings-warn">
              Secure OS encryption is unavailable on this system; the key is stored obfuscated but
              not encrypted.
            </p>
          )}
          <p className="chat__settings-hint">
            Your key is stored locally and used only to call the {provider.label} API from this app.
          </p>
        </form>
      )}

      <div className="chat__thread" ref={threadRef}>
        {turns.length === 0 && !streaming && (
          <p className="chat__empty">
            Ask the assistant about your MicroPython code. Use the toggles below to attach the
            current editor file or recent console output as context.
          </p>
        )}
        {turns.map((t) => (
          <Bubble
            key={t.id}
            role={t.role}
            content={t.content}
            assistantLabel={providerLabel}
            onApply={activeFile ? applyToEditor : undefined}
          />
        ))}
        {streaming !== null && (
          <Bubble role="assistant" content={streaming} assistantLabel={providerLabel} streaming />
        )}
      </div>

      {error && <p className="chat__error">{error}</p>}

      <form className="chat__composer" onSubmit={send}>
        <div className="chat__includes">
          <label className="chat__include">
            <input
              type="checkbox"
              checked={includeFile}
              onChange={(e) => setIncludeFile(e.target.checked)}
              disabled={!activeFile}
            />
            Include active file{activeFile ? ` (${activeFile.name})` : ''}
          </label>
          <label className="chat__include">
            <input
              type="checkbox"
              checked={includeConsole}
              onChange={(e) => setIncludeConsole(e.target.checked)}
            />
            Attach console (since last Run)
          </label>
        </div>
        <div className="chat__composer-row">
          <textarea
            className="chat__input"
            placeholder={ready ? `Message ${providerLabel}…` : 'Set an API key to start'}
            value={input}
            rows={2}
            disabled={busy || !ready}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(e)
              }
            }}
          />
          <button
            type="submit"
            className="chat__btn chat__btn--primary chat__send"
            disabled={busy || !input.trim() || !ready}
          >
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </form>

      {/* Subtle footer bar: active provider + model with clickable dropdowns. */}
      {provider && (
        <div className="chat__footer" aria-label="Model selection">
          <FooterSelect
            label="Provider"
            value={provider.id}
            onChange={setProviderId}
            options={providers.map((p) => ({ value: p.id, label: p.label }))}
          />
          <FooterSelect
            label="Model"
            value={model}
            onChange={setModel}
            options={provider.models.map((m) => ({ value: m.id, label: m.label }))}
          />
          {provider.efforts && provider.efforts.length > 0 && (
            <FooterSelect
              label="Effort"
              value={effort ?? ''}
              onChange={setEffort}
              options={[
                { value: '', label: 'auto' },
                ...provider.efforts.map((v) => ({ value: v, label: v }))
              ]}
            />
          )}
          {provider.speeds && provider.speeds.length > 0 && (
            <FooterSelect
              label="Speed"
              value={speed ?? ''}
              onChange={setSpeed}
              options={[
                { value: '', label: 'auto' },
                ...provider.speeds.map((v) => ({ value: v, label: v }))
              ]}
            />
          )}
          {/* Inline autocomplete (issue #82): opt-in toggle + the FAST model used
              for ghost-text completions, separate from the chat model above. */}
          <label
            className="chat__footer-toggle"
            title="Suggest code as you type (uses the completion model below)"
          >
            <input
              type="checkbox"
              checked={completionEnabled}
              onChange={(e) => toggleCompletionEnabled(e.target.checked)}
            />
            <span className="chat__footer-label">Autocomplete</span>
          </label>
          {completionEnabled && (
            <FooterSelect
              label="Completion"
              value={completionModel}
              onChange={setCompletionModel}
              options={provider.models.map((m) => ({ value: m.id, label: m.label }))}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * GitHub Copilot sign-in via the OAuth device flow. A plain personal access
 * token can't reach the Copilot token endpoint, so the user approves a short
 * code at github.com/login/device; the main process then holds the resulting
 * GitHub token (never exposed here) and exchanges it for the Copilot token.
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

  // Stop polling if the panel unmounts mid-flow.
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
      <div className="chat__copilot">
        <p className="chat__settings-hint">✓ Signed in to {providerLabel}.</p>
        <div className="chat__settings-row">
          <button
            type="button"
            className="chat__btn"
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
    <div className="chat__copilot">
      {phase === 'awaiting' && device ? (
        <>
          <p className="chat__settings-hint">
            A GitHub page opened — enter this code to authorize Snakie:
          </p>
          <div className="chat__copilot-code">
            <code>{device.userCode}</code>
            <button
              type="button"
              className="chat__btn"
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
          <div className="chat__settings-row">
            <button
              type="button"
              className="chat__btn"
              onClick={() => void window.api.openExternal(device.verificationUri)}
            >
              Reopen github.com/login/device
            </button>
          </div>
          <p className="chat__settings-hint">Waiting for you to authorize…</p>
        </>
      ) : (
        <>
          <p className="chat__settings-hint">
            Sign in with your GitHub account (needs an active Copilot subscription) — no personal
            access token required.
          </p>
          <div className="chat__settings-row">
            <button
              type="button"
              className="chat__btn chat__btn--primary"
              onClick={() => void start()}
              disabled={phase === 'starting'}
            >
              {phase === 'starting' ? 'Starting…' : 'Sign in to GitHub Copilot'}
            </button>
          </div>
        </>
      )}
      {error && <p className="chat__error">{error}</p>}
    </div>
  )
}

/** A compact labelled `<select>` used in the chat footer bar. */
function FooterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}): JSX.Element {
  return (
    <label className="chat__footer-select" title={label}>
      <span className="chat__footer-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * A single chat bubble. Renders text with fenced code blocks broken out into
 * styled `<pre>` blocks (each with a Copy button — and, when `onApply` is given,
 * an Apply button that writes the block into the active editor file, issue #82);
 * a Copy button also covers the whole assistant message. Markdown beyond fenced
 * code is rendered as plain text.
 *
 * `onApply` is only supplied for completed ASSISTANT bubbles when there is an
 * active file, so Apply never appears on user messages, while streaming, or with
 * no file to apply to.
 */
function Bubble({
  role,
  content,
  assistantLabel,
  streaming,
  onApply
}: {
  role: 'user' | 'assistant'
  content: string
  assistantLabel: string
  streaming?: boolean
  onApply?: (code: string) => void
}): JSX.Element {
  const segments = parseSegments(content)
  const canApply = role === 'assistant' && !streaming && !!onApply
  return (
    <div className={`chat__bubble chat__bubble--${role}`}>
      <div className="chat__bubble-head">
        <span className="chat__bubble-role">{role === 'user' ? 'You' : assistantLabel}</span>
        {role === 'assistant' && content && !streaming && <CopyButton text={content} label="Copy" />}
      </div>
      <div className="chat__bubble-body">
        {segments.map((seg, i) =>
          seg.type === 'code' ? (
            <div className="chat__code" key={i}>
              <div className="chat__code-actions">
                {canApply && <ApplyButton code={seg.text} onApply={onApply!} />}
                <CopyButton text={seg.text} label="Copy" />
              </div>
              <pre className="chat__code-pre">{seg.text}</pre>
            </div>
          ) : (
            <p className="chat__text" key={i}>
              {seg.text}
              {streaming && i === segments.length - 1 && <span className="chat__caret">▍</span>}
            </p>
          )
        )}
      </div>
    </div>
  )
}

/**
 * Apply a code block to the active editor file (issue #82). Calls `onApply`
 * (which writes the block via the workspace store) and shows a brief "Applied"
 * confirmation, mirroring the Copy button's affordance.
 */
function ApplyButton({
  code,
  onApply
}: {
  code: string
  onApply: (code: string) => void
}): JSX.Element {
  const [applied, setApplied] = useState(false)
  return (
    <button
      type="button"
      className="chat__copy chat__code-apply"
      title="Replace the active file's contents with this code (undo with Ctrl-Z)"
      onClick={() => {
        onApply(code)
        setApplied(true)
        setTimeout(() => setApplied(false), 1200)
      }}
    >
      {applied ? 'Applied' : 'Apply'}
    </button>
  )
}

/** A button that copies `text` to the clipboard, with brief confirmation. */
function CopyButton({
  text,
  label,
  className
}: {
  text: string
  label: string
  className?: string
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={`chat__copy${className ? ` ${className}` : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          // Clipboard unavailable — ignore.
        }
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

type Segment = { type: 'text' | 'code'; text: string }

/**
 * Split a message into alternating text and fenced-code segments. Handles
 * ```lang fences; the optional language tag on the opening fence is dropped.
 * Empty text segments are omitted.
 */
function parseSegments(content: string): Segment[] {
  const segments: Segment[] = []
  const fence = /```[^\n]*\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fence.exec(content)) !== null) {
    if (m.index > last) {
      const text = content.slice(last, m.index)
      if (text.trim()) segments.push({ type: 'text', text: text.trim() })
    }
    segments.push({ type: 'code', text: m[1].replace(/\n$/, '') })
    last = fence.lastIndex
  }
  if (last < content.length) {
    const text = content.slice(last)
    if (text.trim() || segments.length === 0) segments.push({ type: 'text', text: text })
  }
  return segments.length > 0 ? segments : [{ type: 'text', text: content }]
}
