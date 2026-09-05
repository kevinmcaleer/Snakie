import { useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import {
  MpyReadError,
  formatSignature,
  parseMpy,
  type MpyInfo,
  type MpyScope
} from '../../../shared/mpy-info'
import './MpyView.css'

/**
 * BYTECODE VIEW (#875) — what is actually inside a `.mpy`.
 * =============================================================================
 *
 * Clicking a `.mpy` used to open it in Monaco, which showed a screenful of
 * replacement characters and taught the reader nothing. This shows the things
 * the container really does keep — and, just as importantly, says plainly which
 * things it does not, because "where is my source?" is the question anyone
 * opening one of these actually has.
 *
 * READ-ONLY BY CONSTRUCTION. There is no edit path and no save path: the file's
 * bytes are fetched here (via the BYTES channel — the text one would mangle
 * them) and never routed through the workspace buffer, so a `.mpy` tab can never
 * go dirty and can never be written back mangled.
 *
 * All the format knowledge lives in `src/shared/mpy-info.ts`, which is pure and
 * unit-tested against real `mpy-cross` output; this file only lays it out.
 */

/** What the pane is doing right now. */
type Load =
  | { state: 'loading' }
  | { state: 'ok'; info: MpyInfo }
  | { state: 'error'; message: string }

export function MpyView(): JSX.Element {
  const { openFiles, activeId } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const source = activeFile?.source
  const path = activeFile?.path

  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    if (!source || !path) return
    let cancelled = false
    setLoad({ state: 'loading' })
    void (async () => {
      try {
        const bytes =
          source === 'local'
            ? await window.api.fs.readFileBytes(path)
            : await window.api.device.readFileBytes(path)
        if (cancelled) return
        setLoad({ state: 'ok', info: parseMpy(bytes) })
      } catch (err) {
        if (cancelled) return
        // An MpyReadError already reads as a sentence about the FILE; anything
        // else came from the read itself (board busy, file gone) and is worth
        // distinguishing, because the fix is a different one.
        const message =
          err instanceof MpyReadError
            ? `This does not look like a readable .mpy — ${err.message}.`
            : `Could not read the file: ${err instanceof Error ? err.message : String(err)}`
        setLoad({ state: 'error', message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, path])

  if (load.state === 'loading') {
    return <Shell>Reading bytecode…</Shell>
  }
  if (load.state === 'error') {
    return <Shell tone="error">{load.message}</Shell>
  }
  return <MpyReport info={load.info} name={activeFile?.name ?? ''} />
}

/** The centred single-message states (loading, unreadable). */
function Shell({
  children,
  tone = 'muted'
}: {
  children: React.ReactNode
  tone?: 'muted' | 'error'
}): JSX.Element {
  return (
    <div className="mpyv mpyv--message">
      <p className={`mpyv__message mpyv__message--${tone}`}>{children}</p>
    </div>
  )
}

function MpyReport({ info, name }: { info: MpyInfo; name: string }): JSX.Element {
  // The module scope's own name is a placeholder; its CHILDREN are what the
  // module defines, and that is the list worth leading with.
  const defines = info.module.children
  const constants = useMemo(
    // A `.mpy` that imports native code carries `mp_fun_table`, which is a
    // linker artefact rather than something the author wrote. Not hidden, but
    // it belongs after the constants a reader would recognise.
    () =>
      [...info.constants].sort(
        (a, b) => Number(a.kind === 'fun-table') - Number(b.kind === 'fun-table')
      ),
    [info.constants]
  )

  return (
    <div className="mpyv">
      <header className="mpyv__head">
        <h1 className="mpyv__title">{name || 'Compiled module'}</h1>
        <p className="mpyv__lede">
          Compiled bytecode, shown read-only. The original source is <em>not</em> inside a{' '}
          <code>.mpy</code> — names and constants survive compilation, the code you wrote does not.
        </p>
      </header>

      <div className="mpyv__body">
        <section className="mpyv__card">
          <h2 className="mpyv__h2">File</h2>
          <dl className="mpyv__facts">
            <Fact label="Compiled for">
              {info.flavour === 'circuitpython' ? 'CircuitPython' : 'MicroPython'}
            </Fact>
            <Fact label="Format">
              .mpy version {info.version}
              {info.subVersion !== null ? `.${info.subVersion}` : ''}
            </Fact>
            <Fact label="Code">
              {info.hasNativeCode ? (
                <>
                  native machine code for <strong>{info.arch}</strong>
                </>
              ) : (
                'portable bytecode (runs on any architecture)'
              )}
            </Fact>
            <Fact label="Needs small ints of">{info.smallIntBits} bits</Fact>
            {info.sourceName && <Fact label="Compiled from">{info.sourceName}</Fact>}
            <Fact label="Size">{info.byteLength.toLocaleString()} bytes</Fact>
          </dl>
          <p className="mpyv__note">
            {info.flavour === 'circuitpython'
              ? 'CircuitPython marks its bytecode with a different magic byte, so this will not import on a MicroPython board (and the reverse).'
              : 'MicroPython and CircuitPython mark their bytecode differently, so this will not import on a CircuitPython board.'}
            {info.hasNativeCode &&
              ' A native .mpy is fussier still: it only imports on a board whose architecture and ABI sub-version match.'}
          </p>
        </section>

        <section className="mpyv__card">
          <h2 className="mpyv__h2">
            Defines <span className="mpyv__count">{defines.length}</span>
          </h2>
          {defines.length === 0 ? (
            <p className="mpyv__empty">
              Nothing — this module only runs statements at import time.
            </p>
          ) : (
            <ul className="mpyv__tree">
              {defines.map((scope) => (
                <ScopeRow key={scope.qualifiedName} scope={scope} />
              ))}
            </ul>
          )}
          <p className="mpyv__note">
            Argument names come from each function&rsquo;s bytecode prelude, so they are the real
            ones. Default <em>values</em> are not stored — an argument known to have one shows as{' '}
            <code>…</code>, and keyword-only arguments are shown bare because the file records that
            some have defaults without recording which. Classes and functions compile to the same
            kind of object, so a name with methods under it is a class — the file does not label it
            as one.
          </p>
        </section>

        {info.referencedNames.length > 0 && (
          <section className="mpyv__card">
            <h2 className="mpyv__h2">
              Other names <span className="mpyv__count">{info.referencedNames.length}</span>
            </h2>
            <ul className="mpyv__chips">
              {info.referencedNames.map((n, i) => (
                <li className="mpyv__chip" key={`${n}:${i}`}>
                  {n}
                </li>
              ))}
            </ul>
            <p className="mpyv__note">
              Attributes, globals and imported modules the code reaches for, mixed with short string
              literals — MicroPython interns both into the same table, so the file itself cannot
              tell them apart.
            </p>
          </section>
        )}

        {constants.length > 0 && (
          <section className="mpyv__card">
            <h2 className="mpyv__h2">
              Constants <span className="mpyv__count">{constants.length}</span>
            </h2>
            <ul className="mpyv__consts">
              {constants.map((c, i) => (
                <li className="mpyv__const" key={i}>
                  <span className="mpyv__const-kind">{c.kind}</span>
                  <span className={`mpyv__const-value mpyv__const-value--${c.kind}`}>
                    {c.kind === 'str' || c.kind === 'bytes' ? JSON.stringify(c.value) : c.value}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mpyv__card mpyv__card--absent">
          <h2 className="mpyv__h2">Not in this file</h2>
          <ul className="mpyv__absent">
            <li>
              <strong>The source.</strong> Comments, formatting and the statements themselves are
              gone — only compiled bytecode remains. Keep the <code>.py</code> if you want it back.
            </li>
            <li>
              <strong>Docstrings.</strong> MicroPython&rsquo;s compiler discards them outright.
            </li>
            <li>
              <strong>Local variable names.</strong> Locals are numbered slots in the bytecode.
              Arguments are the exception — they keep their names, which is why the signatures above
              are real.
            </li>
            <li>
              <strong>
                The names of <code>*args</code> and <code>**kwargs</code>.
              </strong>{' '}
              The flags survive; the names do not.
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}

/** One scope and, indented beneath it, whatever it defines. */
function ScopeRow({ scope }: { scope: MpyScope }): JSX.Element {
  const tags: string[] = []
  if (scope.isGenerator) tags.push('generator')
  if (scope.kind !== 'bytecode') tags.push(scope.kind)

  return (
    <li className="mpyv__node">
      <div className="mpyv__sig">
        <code className="mpyv__sig-text">{formatSignature(scope)}</code>
        {tags.map((t) => (
          <span className="mpyv__tag" key={t}>
            {t}
          </span>
        ))}
      </div>
      {scope.children.length > 0 && (
        <ul className="mpyv__tree mpyv__tree--nested">
          {scope.children.map((child) => (
            <ScopeRow key={child.qualifiedName} scope={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <>
      <dt className="mpyv__fact-label">{label}</dt>
      <dd className="mpyv__fact-value">{children}</dd>
    </>
  )
}

export default MpyView
