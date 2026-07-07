/**
 * In-memory `FileSystemDirectoryHandle`/`FileSystemFileHandle` doubles for
 * testing the web OPFS/File-System-Access layer (`handleResolver.ts`,
 * `opfsFs.ts`, `opfsRobot.ts`) without a real browser. Implements just the
 * surface those modules call — not the full File System Access spec.
 */

export class FakeFileHandle {
  readonly kind = 'file' as const
  content = ''
  lastModified = 0

  constructor(public name: string) {}

  async getFile(): Promise<File> {
    return new File([this.content], this.name, { lastModified: this.lastModified })
  }

  async createWritable(): Promise<{ write: (data: unknown) => Promise<void>; close: () => Promise<void> }> {
    let buffer = ''
    return {
      write: async (data: unknown): Promise<void> => {
        buffer += typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer)
      },
      close: async (): Promise<void> => {
        this.content = buffer
        this.lastModified = Date.now()
      }
    }
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this
  }
}

export class FakeDirectoryHandle {
  readonly kind = 'directory' as const
  children = new Map<string, FakeFileHandle | FakeDirectoryHandle>()

  constructor(public name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
    const existing = this.children.get(name)
    if (existing) {
      if (!(existing instanceof FakeDirectoryHandle)) {
        throw new DOMException(`${name} is not a directory`, 'TypeMismatchError')
      }
      return existing
    }
    if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError')
    const dir = new FakeDirectoryHandle(name)
    this.children.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const existing = this.children.get(name)
    if (existing) {
      if (!(existing instanceof FakeFileHandle)) {
        throw new DOMException(`${name} is not a file`, 'TypeMismatchError')
      }
      return existing
    }
    if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError')
    const file = new FakeFileHandle(name)
    this.children.set(name, file)
    return file
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.has(name)) throw new DOMException(`${name} not found`, 'NotFoundError')
    this.children.delete(name)
  }

  async resolve(): Promise<string[] | null> {
    return null
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const k of this.children.keys()) yield k
  }

  async *values(): AsyncIterableIterator<FakeFileHandle | FakeDirectoryHandle> {
    for (const v of this.children.values()) yield v
  }

  async *entries(): AsyncIterableIterator<[string, FakeFileHandle | FakeDirectoryHandle]> {
    for (const e of this.children.entries()) yield e
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FakeFileHandle | FakeDirectoryHandle]> {
    return this.entries()
  }
}
