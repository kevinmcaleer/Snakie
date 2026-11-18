/**
 * app.snakie.org/auth/callback (#1310): where accounts.kevsrobots.com sends the
 * sign-in popup back to. It hands the address (with `?code=&state=`) to the
 * Snakie tab that opened it and closes; that tab checks `state` and swaps the
 * code for tokens (web-kevsrobots.ts). Nothing here keeps or sends anything.
 */
import { KR_SIGN_IN_CHANNEL } from './web/web-kevsrobots-channel'

const url = window.location.href
const message = { type: KR_SIGN_IN_CHANNEL, url }
try {
  window.opener?.postMessage(message, window.location.origin)
} catch {
  // The opener is gone or cross-origin: the channel below still reaches it.
}
try {
  const channel = new BroadcastChannel(KR_SIGN_IN_CHANNEL)
  channel.postMessage(message)
  channel.close()
} catch {
  // No BroadcastChannel: postMessage above is the only route.
}

const cancelled = new URLSearchParams(window.location.search).has('error')
const title = document.getElementById('title')
const line = document.getElementById('line')
if (title) title.textContent = cancelled ? 'Sign-in stopped' : "You're signed in"
if (line) line.textContent = 'You can close this window and go back to Snakie.'
setTimeout(() => window.close(), 300)
