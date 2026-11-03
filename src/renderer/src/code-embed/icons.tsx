/**
 * The embed's icons. `width:auto` + flex centring in EmbedApp.css (the app's
 * global `i` width rule doesn't reach an <svg>, but buttons centre them anyway).
 */
const svg = (size: number, children: JSX.Element | JSX.Element[]): JSX.Element => (
  <svg
    className="snk-embed__icon"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const PlayIcon = ({ size = 12 }: { size?: number }): JSX.Element =>
  svg(size, <path d="M4.5 3v10l8-5z" fill="currentColor" stroke="none" />)

export const StopIcon = ({ size = 12 }: { size?: number }): JSX.Element =>
  svg(size, <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />)

export const ResetIcon = ({ size = 13 }: { size?: number }): JSX.Element =>
  svg(size, [<path key="a" d="M3 8a5 5 0 1 0 1.6-3.7" />, <path key="b" d="M3 2.5v3h3" />])

export const GitHubIcon = ({ size = 14 }: { size?: number }): JSX.Element => (
  <svg className="snk-embed__icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path
      fill="currentColor"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
)

/** Snakie's own logo (the app's favicon), for "Open in Snakie". */
export const SnakieLogo = ({ size = 16 }: { size?: number }): JSX.Element => (
  <img
    className="snk-embed__icon snk-embed__logo"
    src={`${import.meta.env.BASE_URL}favicon.svg`}
    width={size}
    height={size}
    alt=""
  />
)
