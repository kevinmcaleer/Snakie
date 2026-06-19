import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LlmKeyStatus,
  LlmMessage,
  LlmProviderInfo,
  LlmStreamEvent
} from '../../../preload/index.d'
import { useWorkspace } from '../store/workspace'
import { useConsole } from '../store/console'
import { useLocalStorage } from '../hooks/useLocalStorage'
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
  const { openFiles, activeId } = useWorkspace()
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

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? providers[0],
    [providers, providerId]
  )
  const model = (provider && modelByProvider[provider.id]) || provider?.defaultModel || ''
  const effort = provider ? effortByProvider[provider.id] : undefined
  const speed = provider ? speedByProvider[provider.id] : undefined

  // ── Key settings ────────────────────────────────────────────────────────
  const [keyStatus, setKeyStatus] = useState<LlmKeyStatus | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  // ── Thread state ──────────────────────────────────────────────────────────
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [includeFile, setIncludeFile] = useState(false)
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

      {showSettings && provider && (
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
          <Bubble key={t.id} role={t.role} content={t.content} assistantLabel={providerLabel} />
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
        </div>
      )}
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
 * styled `<pre>` blocks (each with a Copy button); a Copy button also covers the
 * whole assistant message. Markdown beyond fenced code is rendered as plain text.
 */
function Bubble({
  role,
  content,
  assistantLabel,
  streaming
}: {
  role: 'user' | 'assistant'
  content: string
  assistantLabel: string
  streaming?: boolean
}): JSX.Element {
  const segments = parseSegments(content)
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
              <CopyButton text={seg.text} label="Copy" className="chat__code-copy" />
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
