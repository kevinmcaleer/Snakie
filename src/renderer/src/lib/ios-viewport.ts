/**
 * iOS Safari zooms the page in whenever an input with a font size under 16px
 * gets focus — and the editor's hidden textarea (Monaco) and the console are
 * 13px. The zoom never undoes itself, so after typing a line of code the page
 * is left wider than the screen and pans sideways. `maximum-scale=1` stops that
 * auto-zoom; on iOS it does NOT stop the user pinch-zooming (Safari ignores it
 * for pinches since iOS 10), but elsewhere it would, so it is added on iOS only.
 */
export function isIOS(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ reports itself as a Mac; a touch screen gives it away.
  return platform === 'MacIntel' && maxTouchPoints > 1
}

/** The viewport meta content with `maximum-scale=1` added (once). */
export function withMaximumScale(content: string): string {
  if (/maximum-scale\s*=/.test(content)) return content
  return `${content.replace(/[\s,]+$/, '')}, maximum-scale=1`
}

export function applyIOSViewportFix(): void {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return
  if (!isIOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0)) return
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (meta) meta.content = withMaximumScale(meta.content)
}
