/**
 * CODE IN A URL (#1287).
 * =============================================================================
 *
 * "Open in Snakie" carries a reader's EDITED program to the full app, and an
 * embed can be given a program with no GitHub at all (`?code=`). Both squeeze
 * the text into a URL the same way: deflate, then base64url — the alphabet that
 * needs no escaping in a query string or a hash. A typical lesson (40 lines)
 * comes to a few hundred characters.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodeCode(code: string): string {
  return toBase64Url(deflateSync(strToU8(code), { level: 9 }))
}

/** `null` for anything that isn't a payload we wrote — never throws. */
export function decodeCode(payload: string): string | null {
  try {
    if (!/^[A-Za-z0-9_-]*$/.test(payload)) return null
    return strFromU8(inflateSync(fromBase64Url(payload)))
  } catch {
    return null
  }
}
