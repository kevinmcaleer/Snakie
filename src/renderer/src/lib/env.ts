/**
 * Build-target flags for the renderer.
 *
 * `IS_WEB` is true in the standalone web build (app.snakie.org) and false in the
 * Electron desktop app. The web build defines `import.meta.env.VITE_SNAKIE_WEB`
 * (see vite.web.config.ts); the electron-vite build leaves it undefined. Use it to
 * hide desktop-only affordances that are inert on the web (pop-out windows, etc.).
 */
export const IS_WEB = Boolean(
  (import.meta.env as unknown as { VITE_SNAKIE_WEB?: unknown }).VITE_SNAKIE_WEB
)
