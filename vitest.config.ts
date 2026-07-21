import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for Snakie's pure-logic unit tests (issue #45).
 *
 * These tests exercise the parsing/formatting helpers that back device
 * features (outline, variables inspector, serial plotter) without any
 * Electron, serialport, monaco, React or DOM dependency — so a plain `node`
 * environment is sufficient and fast. We import test APIs explicitly
 * (`globals: false`) so ESLint sees real bindings and no extra global types
 * are needed.
 */
export default defineConfig({
  // The app uses the automatic JSX runtime (no `import React`); match it so
  // component tests (rendered to static markup) transform the same way (#577).
  esbuild: { jsx: 'automatic' },
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    // Compile the sim's worker_threads worker once, and point the runtime at it
    // (integration tests spawn a real MicroPython interpreter in that worker).
    globalSetup: ['./test/setup/globalSetup.ts'],
    setupFiles: ['./test/setup/setupFile.ts']
  }
})
