import crypto from 'crypto'
import { isIP } from 'net'

const MAX_SIZE_BYTES = 2 * 1024 * 1024

const BLOCKED_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/,
]

export function validateFetchUrl(rawUrl: string): { valid: boolean; error?: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { valid: false, error: 'Invalid URL format.' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'Only http/https URLs are allowed.' }
  }

  const hostname = parsed.hostname

  if (isIP(hostname)) {
    for (const range of BLOCKED_RANGES) {
      if (range.test(hostname)) {
        return { valid: false, error: 'Private/internal IP addresses are not allowed.' }
      }
    }
  }

  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { valid: false, error: 'Local hostnames are not allowed.' }
  }

  return { valid: true }
}

export function validateHtmlSize(html: string): { valid: boolean; error?: string } {
  const bytes = Buffer.byteLength(html, 'utf-8')
  if (bytes > MAX_SIZE_BYTES) {
    return { valid: false, error: `File too large: ${(bytes / 1024).toFixed(0)} KB (max 2 MB)` }
  }
  return { valid: true }
}

export function validateContentType(contentType: string): boolean {
  return (
    contentType.includes('text/html') ||
    contentType.includes('text/plain') ||
    contentType.includes('application/octet-stream')
  )
}

export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + process.env.IP_HASH_SALT!).digest('hex')
}
