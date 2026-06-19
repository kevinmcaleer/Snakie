import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { LlmMessage, LlmStreamEvent } from '../../../preload/index.d'
import { useWorkspace } from '../store/workspace'
import { useConsole } from '../store/console'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useChatProviders } from '../hooks/useChatProviders'
import { openSettings } from './settingsBus'
import './ChatPanel.css'

/**
 * CHAT TAB (issue #18, generalized in #77 + #78; settings moved out in #83)
 * ========================================================================
 *
 * An in-app multi-provider chat assistant. The message thread, an input box, a
 * subtle footer bar to pick provider / model / effort / speed (plus Clear and a
 * ⚙ that opens the Settings dialog's Chat tab), and toggles to attach the active
 * editor file and recent console output as context.
 *
 * The redundant title bar and the inline key-settings form were removed in
 * issue #83 — the per-provider API keys, the GitHub Copilot sign-in and the
 * autocomplete settings now live in the Settings dialog's Chat tab
 * ({@link ChatSettings}). Provider/model/key state is shared via
 * {@link useChatProviders} so the footer here and that tab stay in sync.
 *
 * All provider API calls run in the MAIN process (the renderer CSP blocks
 * external requests), so this panel only talks to `window.api.llm`. Replies are
 * streamed: `sendMessage` resolves with the full text, but we also subscribe to
 * `onStream` deltas so the assistant bubble fills in live.
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

  // ── Shared provider registry + selection + key status (issue #83) ─────────
  // The per-provider keys, Copilot sign-in and autocomplete settings now live in
  // the Settings dialog's Chat tab; this panel keeps the quick footer selectors,
  // reading/writing the same persisted values via the shared hook so the two
  // stay in sync.
  const {
    providers,
    provider,
    setProviderId,
    model,
    setModel,
    effort,
    setEffort,
    speed,
    setSpeed,
    keyStatus,
    error: providerError
  } = useChatProviders()

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

  const ready = keyStatus?.hasKey ?? false
  const providerLabel = provider?.label ?? 'Loading…'
  // Surface a provider-load error or an in-flight send error (whichever is set).
  const shownError = error ?? providerError

  return (
    <div className="chat">
      <div className="chat__thread" ref={threadRef}>
        {turns.length === 0 && !streaming && (
          <p className="chat__empty">
            {ready
              ? 'Ask the assistant about your MicroPython code. Use the toggles below to attach the current editor file or recent console output as context.'
              : `No API key for ${providerLabel}. Open ⚙ Settings → Chat to add one.`}
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

      {shownError && <p className="chat__error">{shownError}</p>}

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
          {/* Quick actions: clear the thread + open the Settings dialog's Chat
              tab (keys, Copilot sign-in, autocomplete — moved here in #83). */}
          <div className="chat__footer-actions">
            {!ready && <span className="chat__footer-warn">no key</span>}
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
              onClick={() => openSettings('chat')}
              title="Open chat settings (API keys, sign-in, autocomplete)"
              aria-label="Open chat settings"
            >
              ⚙
            </button>
          </div>
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
