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
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
