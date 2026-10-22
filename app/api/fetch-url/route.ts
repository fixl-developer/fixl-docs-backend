import { NextRequest, NextResponse } from 'next/server'
import { validateFetchUrl } from '@/lib/validate'
import { uploadLimiter } from '@/lib/ratelimit'
import { claudeArtifactUrl } from '@/lib/artifact-import'

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { success } = await uploadLimiter.limit(ip)
  if (!success) {
    return NextResponse.json({ error: 'Too many requests. Try again in an hour.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const rawUrl = typeof body?.url === 'string' ? body.url.trim() : ''

  const urlCheck = validateFetchUrl(rawUrl)
  if (!urlCheck.valid) {
    return NextResponse.json({ error: urlCheck.error }, { status: 400 })
  }

  if (claudeArtifactUrl(rawUrl)) {
    return NextResponse.json({
      code: 'CLAUDE_EXPORT_REQUIRED',
      error: 'Claude share links are not standalone HTML. Open the artifact in Claude, export it as a standalone HTML file, then upload or paste the HTML here.',
    }, { status: 422 })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let html: string
  let sourceUrl = rawUrl
  try {
    const response = await fetch(rawUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'htmldrop-fetcher/1.0 (HTML snapshot tool)',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    })

    sourceUrl = response.url || rawUrl

    if (claudeArtifactUrl(sourceUrl)) {
      await response.body?.cancel()
      return NextResponse.json({ code: 'CLAUDE_EXPORT_REQUIRED', error: 'This URL redirects to a Claude artifact. Export a standalone HTML file from Claude, then upload it here.' }, { status: 422 })
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Remote server returned ${response.status}` },
        { status: 422 }
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      return NextResponse.json(
        { error: `URL does not point to an HTML page (got: ${contentType.split(';')[0]})` },
        { status: 422 }
      )
    }

    const reader = response.body?.getReader()
    if (!reader) {
      return NextResponse.json({ error: 'Could not read response body.' }, { status: 422 })
    }

    const chunks: Uint8Array[] = []
    let totalBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel()
        return NextResponse.json(
          { error: 'Page is too large (max 2 MB).' },
          { status: 422 }
        )
      }
      chunks.push(value)
    }

    html = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length)
        merged.set(acc)
        merged.set(chunk, acc.length)
        return merged
      }, new Uint8Array(0))
    )
  } catch (err: unknown) {
    clearTimeout(timer)
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('abort')) {
      return NextResponse.json({ error: 'Request timed out after 10 seconds.' }, { status: 422 })
    }
    return NextResponse.json({ error: `Failed to fetch URL: ${message}` }, { status: 422 })
  } finally {
    clearTimeout(timer)
  }

  return NextResponse.json({ html, sourceUrl }, { status: 200 })
}
