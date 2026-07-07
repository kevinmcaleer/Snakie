import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDirectoryHandle } from './helpers/fakeOpfs'

vi.mock('../src/renderer/src/web/fs/idb', () => ({
  idbGet: vi.fn(async () => undefined),
  idbSet: vi.fn(async () => undefined),
  idbDelete: vi.fn(async () => undefined)
}))

async function freshOpfsFs(): Promise<typeof import('../src/renderer/src/web/fs/opfsFs')> {
  vi.resetModules()
  return import('../src/renderer/src/web/fs/opfsFs')
}

describe('opfsFs', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => new FakeDirectoryHandle('') } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('openFolderDialog() returns the project root (zero-friction default)', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await expect(opfsFs.openFolderDialog()).resolves.toBe(PROJECT_ROOT)
  })

  it('writeFile()/readFile() round-trip through the project root', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await opfsFs.writeFile(`${PROJECT_ROOT}/main.py`, 'print("hi")')
    await expect(opfsFs.readFile(`${PROJECT_ROOT}/main.py`)).resolves.toBe('print("hi")')
  })

  it('writeFile() creates intermediate directories', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await opfsFs.writeFile(`${PROJECT_ROOT}/lib/util.py`, 'x = 1')
    await expect(opfsFs.readFile(`${PROJECT_ROOT}/lib/util.py`)).resolves.toBe('x = 1')
  })

  it('mkdir() creates an empty directory visible to readDir()', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await opfsFs.mkdir(`${PROJECT_ROOT}/assets`)
    const entries = await opfsFs.readDir(PROJECT_ROOT)
    expect(entries).toEqual([{ name: 'assets', path: `${PROJECT_ROOT}/assets`, isDir: true }])
  })

  it('readDir() lists directories before files, alphabetically within each group', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await opfsFs.writeFile(`${PROJECT_ROOT}/zeta.py`, '')
    await opfsFs.writeFile(`${PROJECT_ROOT}/alpha.py`, '')
    await opfsFs.mkdir(`${PROJECT_ROOT}/beta`)
    const entries = await opfsFs.readDir(PROJECT_ROOT)
    expect(entries.map((e) => e.name)).toEqual(['beta', 'alpha.py', 'zeta.py'])
    expect(entries[0].isDir).toBe(true)
  })

  it('stat() reports file size/isDir correctly', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await opfsFs.writeFile(`${PROJECT_ROOT}/main.py`, 'abcde')
    const s = await opfsFs.stat(`${PROJECT_ROOT}/main.py`)
    expect(s.isDir).toBe(false)
    expect(s.size).toBe(5)
  })

  it('stat() reports directories', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await opfsFs.mkdir(`${PROJECT_ROOT}/lib`)
    const s = await opfsFs.stat(`${PROJECT_ROOT}/lib`)
    expect(s.isDir).toBe(true)
  })

  it('remove() deletes a file', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await opfsFs.writeFile(`${PROJECT_ROOT}/gone.py`, '')
    await opfsFs.remove(`${PROJECT_ROOT}/gone.py`)
    await expect(opfsFs.readFile(`${PROJECT_ROOT}/gone.py`)).rejects.toThrow()
  })

  it('rename() moves a file to a new path', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await opfsFs.writeFile(`${PROJECT_ROOT}/old.py`, 'content')
    await opfsFs.rename(`${PROJECT_ROOT}/old.py`, `${PROJECT_ROOT}/new.py`)
    await expect(opfsFs.readFile(`${PROJECT_ROOT}/new.py`)).resolves.toBe('content')
    await expect(opfsFs.readFile(`${PROJECT_ROOT}/old.py`)).rejects.toThrow()
  })

  it('rename() moves a directory (recursively) to a new path', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await opfsFs.writeFile(`${PROJECT_ROOT}/lib/a.py`, 'a')
    await opfsFs.writeFile(`${PROJECT_ROOT}/lib/b.py`, 'b')
    await opfsFs.rename(`${PROJECT_ROOT}/lib`, `${PROJECT_ROOT}/vendor`)
    await expect(opfsFs.readFile(`${PROJECT_ROOT}/vendor/a.py`)).resolves.toBe('a')
    await expect(opfsFs.readFile(`${PROJECT_ROOT}/vendor/b.py`)).resolves.toBe('b')
    await expect(opfsFs.readDir(`${PROJECT_ROOT}/lib`)).rejects.toThrow()
  })

  it('saveFileDialog() falls back to a zero-dialog project path when unsupported', async () => {
    const { opfsFs, PROJECT_ROOT } = await freshOpfsFs()
    await expect(opfsFs.saveFileDialog('untitled-1.py')).resolves.toBe(`${PROJECT_ROOT}/untitled-1.py`)
  })

  it('saveFileDialog() uses showSaveFilePicker() when available, tracked outside the project', async () => {
    const externalHandle: { name: string; content: string } & Record<string, unknown> = {
      name: 'exported.py',
      content: '',
      getFile: async () => new File([externalHandle.content], externalHandle.name),
      createWritable: async () => {
        let buf = ''
        return {
          write: async (data: unknown) => {
            buf += data
          },
          close: async () => {
            externalHandle.content = buf
          }
        }
      }
    }
    vi.stubGlobal('window', {
      showSaveFilePicker: vi.fn(async () => externalHandle)
    })
    const { opfsFs } = await freshOpfsFs()
    const path = await opfsFs.saveFileDialog('exported.py')
    expect(path).toMatch(/^\/external\/1-exported\.py$/)
    await opfsFs.writeFile(path!, 'external content')
    await expect(opfsFs.readFile(path!)).resolves.toBe('external content')
  })
})
