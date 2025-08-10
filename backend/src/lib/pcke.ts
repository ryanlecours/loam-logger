export function randomString(len = 64) {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => ('0' + b.toString(16)).slice(-2)).join('')
}

export function base64url(input: ArrayBuffer) {
  const str = Buffer.from(input).toString('base64')
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256(input: string) {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64url(digest)
}
