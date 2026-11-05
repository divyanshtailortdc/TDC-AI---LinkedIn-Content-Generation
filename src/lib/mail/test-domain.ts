/**
 * Domains reserved for testing and examples (RFC 2606, RFC 6761), such as the
 * local mail server's `in.tdc.test`. They do not exist on the internet: no one
 * outside this machine can send mail to them, and newsletter sign-up forms
 * turn them away ("We were unable to validate your email domain"). Client-safe.
 */
const RESERVED_DOMAIN =
  /(^|\.)(test|example|invalid|localhost|local)$|(^|\.)example\.(com|net|org)$/i

export function isTestDomain(domain: string) {
  return RESERVED_DOMAIN.test(domain.trim())
}
