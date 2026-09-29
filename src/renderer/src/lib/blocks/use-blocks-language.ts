import { useCallback, useEffect, useRef, useState } from 'react'
import {
  languageFromSearch,
  languageInfo,
  normaliseLanguage,
  resolveLanguage
} from '../../../../shared/languages'
import { useEditorSettings } from '../../store/settings'
import { useWorkspaceOptional } from '../../store/workspace'
import { blocksLanguage, setBlocksLanguage } from './locale'

/**
 * WHICH LANGUAGE THE BLOCKS ARE IN, AND GETTING THEM THERE (multilingual blocks).
 * =============================================================================
 *
 * The three voices `resolveLanguage` weighs — the web address, the project's
 * robot.yml, the learner's own setting — gathered in one place, with the
 * Blockly pack loaded before anybody is told the language changed.
 */

/**
 * `?lang=` from the address the app was opened at, read ONCE.
 *
 * Once, because it is a statement about how this session was opened ("open
 * this in Deutsch"), not a setting: navigating inside the app must not lose
 * it, and it is never written to anyone's settings. On the desktop the page is
 * a `file://` with no query, so this is simply null.
 */
const URL_LANGUAGE: string | null =
  typeof window === 'undefined' ? null : languageFromSearch(window.location.search)

/** The `?lang=` the app was opened with, if any. */
export function urlLanguage(): string | null {
  return URL_LANGUAGE
}

/** The computer's own language, as the browser reports it. */
export function systemLanguage(): string | null {
  return typeof navigator === 'undefined' ? null : normaliseLanguage(navigator.language)
}

/**
 * The open project's robot.yml `language:` — `null` when it names none, or
 * there is no project — and a way to set it.
 *
 * Re-read whenever robot.yml is saved anywhere (the Board View, another
 * window, a `git pull`), because the language travelling with the project is
 * the point of putting it there.
 */
export function useProjectLanguage(): {
  language: string | null
  folder: string | null
  setLanguage: (code: string | null) => Promise<void>
} {
  const folder = useWorkspaceOptional()?.currentFolder ?? null
  const [language, setLanguage] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => window.api.robot.onChanged(() => setNonce((n) => n + 1)), [])

  useEffect(() => {
    if (!folder) {
      setLanguage(null)
      return
    }
    let live = true
    window.api.robot
      .load(folder)
      .then((def) => live && setLanguage(normaliseLanguage(def.language)))
      .catch(() => live && setLanguage(null))
    return () => {
      live = false
    }
  }, [folder, nonce])

  const write = useCallback(
    async (code: string | null): Promise<void> => {
      if (!folder) return
      const def = await window.api.robot.load(folder)
      const next = { ...def, language: normaliseLanguage(code) ?? undefined }
      const res = await window.api.robot.save(folder, next)
      if (!res.ok) throw new Error(res.error ?? 'Could not save robot.yml')
      setLanguage(next.language ?? null)
      setNonce((n) => n + 1)
    },
    [folder]
  )

  return { language, folder, setLanguage: write }
}

/**
 * The language the block canvas should be drawn in, once it can be.
 *
 * `language` only moves AFTER its Blockly pack and Snakie catalogue have
 * loaded, so a canvas keyed on it re-injects exactly once, with every message
 * already in place. Two quick changes in a row settle on the last one.
 */
export function useBlocksLanguage(): { language: string; rtl: boolean } {
  const { language: preference } = useEditorSettings()
  const { language: project } = useProjectLanguage()
  const wanted = resolveLanguage({
    url: URL_LANGUAGE,
    project,
    preference,
    system: systemLanguage()
  })
  const [loaded, setLoaded] = useState(blocksLanguage)
  const seqRef = useRef(0)

  useEffect(() => {
    const seq = ++seqRef.current
    void setBlocksLanguage(wanted).then(() => {
      if (seq === seqRef.current) setLoaded(blocksLanguage())
    })
  }, [wanted])

  // Screen readers, spell-checkers and hyphenation follow the page's `lang`.
  useEffect(() => {
    document.documentElement.lang = loaded
  }, [loaded])

  return { language: loaded, rtl: languageInfo(loaded).rtl === true }
}
