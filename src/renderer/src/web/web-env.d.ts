/// <reference types="vite/client" />

// Vite's client types provide `*?url` asset imports (the MicroPython .wasm) and
// `import.meta.env` for the web build (epic #267, Phase W1).

// The BROWSER build of mpy-cross (#970): `resources/mpy-cross/mpy-cross.mjs`,
// an Emscripten ES module with no types of its own. A wildcard because the
// artifact is COMMITTED rather than installed — there is no package around it
// to carry a `.d.ts`, and it sits above the renderer root.
declare module '*/mpy-cross.mjs' {
  import type { MpyCrossFactory } from '../../../shared/mpy-compile'
  const MpyCross: MpyCrossFactory
  export default MpyCross
}

// The bundled Standard Parts library, inlined at build time by
// vite-plugin-standard-parts (#475).
declare module 'virtual:snakie-standard-parts' {
  import type { PartLibraryWithParts } from '../../../shared/part'
  const libraries: PartLibraryWithParts[]
  export default libraries
  /** Bundled part driver file contents, keyed `<partId>/<source>`. */
  export const driverSources: Record<string, string>
}
