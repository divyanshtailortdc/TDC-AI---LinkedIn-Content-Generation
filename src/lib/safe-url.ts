import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/**
 * Guards for fetching URLs that users type in. Without these, a URL like
 * http://169.254.169.254/ or a redirect to http://localhost:5432 turns the
 * server into a proxy into its own network.
 *
 * Known gap: the address is checked when we resolve it, and fetch resolves it
 * again when connecting, so a DNS record that changes in between (rebinding)
 * is not caught. Closing that needs a custom connection lookup.
 */

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  // Deprecated forms that embed an IPv4 address (e.g. ::7f00:1, ::ffff:0:7f00:1,
  // 2002:7f00:1::, Teredo 2001:0:...) and can route to it; nothing legitimate
  // uses them.
  ['::', 96],
  ['::ffff:0:0:0', 96],
  ['2001::', 32],
  ['2002::', 16],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']
const ALLOWED_PORTS = new Set(['', '80', '443'])

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

/** True for loopback, private, link-local, reserved and multicast addresses. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '')
  const family = isIP(bare)
  if (family === 4) return blocked.check(bare, 'ipv4')
  if (family === 6) {
    // An IPv4-mapped IPv6 address reaches the IPv4 host it wraps.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)
    if (mapped?.[1]) return blocked.check(mapped[1], 'ipv4')
    return blocked.check(bare, 'ipv6')
  }
  return false
}

/**
 * Parses user input into an http(s) URL that is safe to request, without any
 * network access. Adds https:// when the scheme is missing.
 */
export function parsePublicHttpUrl(input: string): URL {
  const trimmed = input.trim()
  if (!trimmed) throw new UnsafeUrlError('URL is empty')

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new UnsafeUrlError('That is not a valid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https URLs are supported')
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed')
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError('Only the standard web ports are allowed')
  }

  const host = url.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    BLOCKED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix)) ||
    isPrivateAddress(host)
  ) {
    throw new UnsafeUrlError('URLs pointing at private networks are not allowed')
  }
  // A bare word like "intranet" only resolves through local search domains.
  if (!isIP(host.replace(/^\[|\]$/g, '')) && !host.includes('.')) {
    throw new UnsafeUrlError('URLs must use a public domain name')
  }

  return url
}

/** Resolves the host and rejects it if any address it resolves to is private. */
export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new UnsafeUrlError('URLs pointing at private networks are not allowed')
    }
    return
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${host}`)
  }
  if (addresses.length === 0 || addresses.some(a => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError('URLs pointing at private networks are not allowed')
  }
}

/** Validates a URL fully, including DNS, before anything requests it. */
export async function resolvePublicHttpUrl(input: string): Promise<URL> {
  const url = parsePublicHttpUrl(input)
  await assertPublicHost(url)
  return url
}

/**
 * fetch() that re-validates every redirect hop, so a public page cannot bounce
 * the request onto an internal address.
 */
export async function safeFetch(
  input: string,
  init: RequestInit = {},
  maxRedirects = 3
): Promise<Response> {
  let url = await resolvePublicHttpUrl(input)

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(url, { ...init, redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return response
    }
    url = await resolvePublicHttpUrl(new URL(location, url).toString())
  }

  throw new UnsafeUrlError('Too many redirects')
}
