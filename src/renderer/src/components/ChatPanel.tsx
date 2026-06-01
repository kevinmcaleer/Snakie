import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { LlmKeyStatus, LlmMessage, LlmStreamEvent } from '../../../preload/index.d'
import { useWorkspace } from '../store/workspace'
import './ChatPanel.css'

/**
 * CHAT TAB (issue #18)
 * ====================
 *
 * An in-app Claude chat assistant. The message thread, an input box, a settings
 * affordance for the Anthropic API key, and a toggle to attach the active
 * editor file as context.
 *
 * All Anthropic API calls run in the MAIN process (the renderer CSP blocks
 * external requests), so this panel only talks to `window.api.llm`. Replies are
 * streamed: `sendMessage` resolves with the full text, but we also subscribe to
 * `onStream` deltas so the assistant bubble fills in live.
 *
 * If no API key is stored, the panel prompts for one rather than crashing.
 */

interface ChatTurn extends LlmMessage {
  /** Stable key for React lists. */
  id: string
}

export function ChatPanel(): JSX.Element {
  const { openFiles, activeId } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId)

  const [keyStatus, setKeyStatus] = useState<LlmKeyStatus | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [includeFile, setIncludeFile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Live-streaming assistant text for the in-flight reply. */
  const [streaming, setStreaming] = useState<string | null>(null)

  const threadRef = useRef<HTMLDivElement>(null)
  const streamingRef = useRef('')

  // Load whether a key is configured on mount.
  const refreshKeyStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api.llm.getKeyStatus()
      setKeyStatus(status)
      // Open settings automatically the first time if no key is set.
      if (!status.hasKey) setShowSettings(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

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
      setSavingKey(true)
      setError(null)
      try {
        await window.api.llm.setKey(keyInput)
        setKeyInput('')
        await refreshKeyStatus()
        setShowSettings(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSavingKey(false)
      }
    },
    [keyInput, refreshKeyStatus]
  )

  const send = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault()
      const text = input.trim()
      if (!text || busy) return
      setError(null)

      const userTurn: ChatTurn = { id: `u-${Date.now()}`, role: 'user', content: text }
      const history = [...turns, userTurn]
      setTurns(history)
      setInput('')
      setBusy(true)
      setStreaming('')
      streamingRef.current = ''

      try {
        const reply = await window.api.llm.sendMessage({
          messages: history.map((t) => ({ role: t.role, content: t.content })),
          activeFile:
            includeFile && activeFile
              ? { name: activeFile.name, content: activeFile.content }
              : undefined
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
    [input, busy, turns, includeFile, activeFile]
  )

  const clearThread = useCallback((): void => {
    setTurns([])
    setError(null)
    setStreaming(null)
  }, [])

  return (
    <div className="chat">
      <div className="chat__toolbar">
        <span className="chat__status">
          {keyStatus?.hasKey ? 'Claude ready' : 'No API key'}
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

      {showSettings && (
        <form className="chat__settings" onSubmit={saveKey}>
          <label className="chat__settings-label" htmlFor="chat-key">
            Anthropic API key
          </label>
          <input
            id="chat-key"
            type="password"
            className="chat__input-key"
            placeholder={keyStatus?.hasKey ? '•••••••• (stored)' : 'sk-ant-...'}
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
                  await window.api.llm.setKey('')
                  await refreshKeyStatus()
                }}
                disabled={savingKey}
              >
                Remove
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
            Your key is stored locally and used only to call the Claude API from this app.
          </p>
        </form>
      )}

      <div className="chat__thread" ref={threadRef}>
        {turns.length === 0 && !streaming && (
          <p className="chat__empty">
            Ask Claude about your MicroPython code. Toggle “Include active file” below to send the
            current editor file as context.
          </p>
        )}
        {turns.map((t) => (
          <Bubble key={t.id} role={t.role} content={t.content} />
        ))}
        {streaming !== null && <Bubble role="assistant" content={streaming} streaming />}
      </div>

      {error && <p className="chat__error">{error}</p>}

      <form className="chat__composer" onSubmit={send}>
        <label className="chat__include">
          <input
            type="checkbox"
            checked={includeFile}
            onChange={(e) => setIncludeFile(e.target.checked)}
            disabled={!activeFile}
          />
          Include active file{activeFile ? ` (${activeFile.name})` : ''}
        </label>
        <div className="chat__composer-row">
          <textarea
            className="chat__input"
            placeholder={keyStatus?.hasKey ? 'Message Claude…' : 'Set an API key to start'}
            value={input}
            rows={2}
            disabled={busy || !keyStatus?.hasKey}
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
            disabled={busy || !input.trim() || !keyStatus?.hasKey}
          >
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
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
  streaming
}: {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}): JSX.Element {
  const segments = parseSegments(content)
  return (
    <div className={`chat__bubble chat__bubble--${role}`}>
      <div className="chat__bubble-head">
        <span className="chat__bubble-role">{role === 'user' ? 'You' : 'Claude'}</span>
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
