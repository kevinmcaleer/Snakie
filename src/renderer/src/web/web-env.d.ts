/// <reference types="vite/client" />

// Vite's client types provide `*?url` asset imports (the MicroPython .wasm) and
// `import.meta.env` for the web build (epic #267, Phase W1).

// The bundled Standard Parts library, inlined at build time by
// vite-plugin-standard-parts (#475).
declare module 'virtual:snakie-standard-parts' {
  import type { PartLibraryWithParts } from '../../../shared/part'
  const libraries: PartLibraryWithParts[]
  export default libraries
}
