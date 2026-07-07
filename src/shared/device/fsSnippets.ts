/**
 * Shared MicroPython snippet builders for the SIMULATED device's in-memory
 * filesystem (issue #135), extracted so the Electron `SimulatedDevice` and the
 * browser `WebSimulatedDevice` (epic #267 Phase W1) share one source of truth
 * for the exact Python generated for each filesystem operation — no Node/
 * Electron dependency, safe to import from a Web Worker.
 */

/**
 * Render a JS string as a Python string literal, escaping characters that
 * would break out of the quotes. Used to inject paths/data into generated
 * Python.
 */
export function pyStr(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
  return `'${escaped}'`
}

/**
 * Python that creates each parent directory of `path` (e.g. `/lib` for
 * `/lib/instruments.py`), ignoring "already exists". Returns '' for a
 * root-level path with no parent to create. MicroPython has no `os.makedirs`,
 * so build the chain segment by segment.
 */
export function mkParentsSnippet(path: string): string {
  const slash = path.lastIndexOf('/')
  const dir = slash > 0 ? path.slice(0, slash) : ''
  if (!dir || dir === '/') return ''
  return [
    'import os',
    '_cur=""',
    `for _s in ${pyStr(dir)}.strip("/").split("/"):`,
    '    _cur+="/"+_s',
    '    try:',
    '        os.mkdir(_cur)',
    '    except OSError:',
    '        pass'
  ].join('\n')
}

/** Python that prints a JSON array of `[name, isDir, size]` for `path`'s
 *  directory entries (uses `os.ilistdir` when available for type + size in
 *  one call, falling back to a plain `os.listdir` + per-entry `os.stat`). */
export function listDirSnippet(path: string): string {
  return [
    'import os, json',
    'def _ls(p):',
    '    out=[]',
    '    try: it=os.ilistdir(p)',
    '    except AttributeError: it=[(n,0,0) for n in os.listdir(p)]',
    '    for e in it:',
    '        name=e[0]; typ=e[1] if len(e)>1 else 0',
    '        full=(p.rstrip("/")+"/"+name) if p else name',
    '        isdir=(typ & 0x4000)!=0',
    '        try: size=0 if isdir else os.stat(full)[6]',
    '        except OSError: size=0',
    '        out.append([name,isdir,size])',
    '    return out',
    `print(json.dumps(_ls(${pyStr(path)})))`
  ].join('\n')
}

/** Python that reads `path` as text and writes it to stdout. */
export function readFileSnippet(path: string): string {
  return `import sys\nwith open(${pyStr(path)}) as f:\n    sys.stdout.write(f.read())`
}

/** Python that hex-decodes `hexContents` and writes it to `path` (creating
 *  any missing parent directories first), for arbitrary (incl. binary)
 *  content transfer without escaping. */
export function writeFileSnippet(path: string, hexContents: string): string {
  return [
    mkParentsSnippet(path),
    `_d=bytes.fromhex(${pyStr(hexContents)})`,
    `with open(${pyStr(path)},'wb') as f:`,
    '    f.write(_d)'
  ]
    .filter(Boolean)
    .join('\n')
}

/** Python that removes a file OR a directory tree. `os.remove()` can't delete
 *  directories (and `os.rmdir()` only empty ones), so walk depth-first with an
 *  explicit stack: children first, then the emptied folder (#219). */
export function removeSnippet(path: string): string {
  return [
    'import os',
    `_s = [${pyStr(path)}]`,
    'while _s:',
    '    _p = _s[-1]',
    '    if (os.stat(_p)[0] & 0x4000) != 0:',
    '        _c = os.listdir(_p)',
    '        if _c:',
    "            _s.extend([_p + '/' + _x for _x in _c])",
    '        else:',
    '            os.rmdir(_p)',
    '            _s.pop()',
    '    else:',
    '        os.remove(_p)',
    '        _s.pop()'
  ].join('\n')
}

/** Python that creates a directory. */
export function mkdirSnippet(path: string): string {
  return `import os\nos.mkdir(${pyStr(path)})`
}

/** Python that renames/moves a path. */
export function renameSnippet(from: string, to: string): string {
  return `import os\nos.rename(${pyStr(from)}, ${pyStr(to)})`
}

/** Python that prints a JSON `[isDir, size, mtime]` array for `path`. */
export function statSnippet(path: string): string {
  return [
    'import os, json',
    `st=os.stat(${pyStr(path)})`,
    'isdir=(st[0] & 0x4000)!=0',
    'print(json.dumps([isdir, st[6], st[8] if len(st)>8 else None]))'
  ].join('\n')
}
