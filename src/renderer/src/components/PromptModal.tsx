import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './PromptModal.css'

/**
 * In-app text prompt — a Promise-based replacement for `window.prompt`.
 *
 * Electron's renderer does NOT implement `window.prompt()` (it returns null and
 * does nothing), so the file trees' New File / New Folder / Rename actions used
 * to silently fail. This provider renders a small modal (text input + OK/Cancel)
 * and exposes a `prompt(message, defaultValue?)` function that resolves to the
 * entered string, or null if the user cancels.
 *
 * Keyboard: Enter confirms, Esc cancels; the input autofocuses (and selects its
 * default text) so a user can immediately type a replacement name.
 *
 * Styling follows the NES/JetBrains-Mono app chrome via PromptModal.css; this
 * keeps the shared index.css untouched.
 */

type PromptFn = (message: string, defaultValue?: string) => Promise<string | null>

const PromptContext = createContext<PromptFn | null>(null)

interface PromptRequest {
  message: string
  defaultValue: string
  resolve: (value: string | null) => void
}

export function PromptProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<PromptRequest | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Trap Tab focus within the modal and restore focus to the trigger on close.
  const dialogRef = useFocusTrap<HTMLDivElement>(!!request)

  const prompt = useCallback<PromptFn>((message, defaultValue = '') => {
    return new Promise<string | null>((resolve) => {
      setValue(defaultValue)
      setRequest({ message, defaultValue, resolve })
    })
  }, [])

  // Autofocus + select the default text once the modal mounts for a request.
  useEffect(() => {
    if (request) {
      const input = inputRef.current
      if (input) {
        input.focus()
        input.select()
      }
    }
  }, [request])

  const settle = useCallback(
    (result: string | null): void => {
      if (request) request.resolve(result)
      setRequest(null)
      setValue('')
    },
    [request]
  )

  const onConfirm = useCallback((): void => settle(value), [settle, value])
  const onCancel = useCallback((): void => settle(null), [settle])

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {request && (
        <div
          className="prompt-overlay"
          onMouseDown={(e) => {
            // Click on the backdrop (not the modal) cancels.
            if (e.target === e.currentTarget) onCancel()
          }}
        >
          <div
            className="prompt-modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={request.message}
            onKeyDown={(e) => {
              // Escape cancels from anywhere in the dialog (not just the input).
              if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
              }
            }}
          >
            <label className="prompt-modal__label" htmlFor="prompt-modal-input">
              {request.message}
            </label>
            <input
              id="prompt-modal-input"
              ref={inputRef}
              className="prompt-modal__input"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onConfirm()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  onCancel()
                }
              }}
            />
            <div className="prompt-modal__actions">
              <button type="button" className="btn btn--ghost" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={onConfirm}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </PromptContext.Provider>
  )
}

/**
 * Access the in-app prompt. Returns a function that resolves to the entered
 * string (or null on cancel). Must be used within <PromptProvider>.
 */
export function usePrompt(): PromptFn {
  const ctx = useContext(PromptContext)
  if (!ctx) throw new Error('usePrompt must be used within a PromptProvider')
  return ctx
}
