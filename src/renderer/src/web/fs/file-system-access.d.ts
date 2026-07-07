/**
 * Ambient extensions for the File System Access API surface that this TS
 * lib/DOM version doesn't yet declare (`showDirectoryPicker`/
 * `showSaveFilePicker` on `Window`, permission queries on `FileSystemHandle`,
 * and directory iteration on `FileSystemDirectoryHandle`). Scoped to the web
 * renderer only (not visible to `tsconfig.node.json`) since it merges into
 * DOM globals that don't exist under the Node program.
 *
 * Kept intentionally narrow — only the members `handleResolver.ts`/`opfsFs.ts`
 * actually call.
 */
export {}

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }

  interface FileSystemHandle {
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }

  interface FileSystemDirectoryHandle {
    keys(): AsyncIterableIterator<string>
    values(): AsyncIterableIterator<FileSystemHandle>
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>
  }

  interface DirectoryPickerOptions {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: string
  }

  interface SaveFilePickerOptions {
    suggestedName?: string
    types?: { description?: string; accept: Record<string, string[]> }[]
  }

  interface Window {
    showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
    showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
  }
}
