import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import {
  createDocument,
  insertVersion,
  updateDocumentCurrentVersion,
  getNextVersionNumber,
  logAuditEvent,
} from '@/lib/db'
import { uploadObject } from '@/lib/storage'
import { generateDocumentSlug } from '@/lib/slugs'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function jsonEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

// SSRF protection — block requests to private/internal addresses
function isPrivateUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    if (!['http:', 'https:'].includes(url.protocol)) return true
    const h = url.hostname
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(h)) return true
    const parts = h.split('.').map(Number)
    if (parts[0] === 10) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    return false
  } catch { return true }
}

// Strip scripts/styles/nav and extract meaningful text + structure from HTML
function extractContent(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60_000)
}

export async function POST(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const { url, title, project_id, prompt } = body ?? {}

  if (!url || typeof url !== 'string') {
    return new Response(JSON.stringify({ error: 'url is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!project_id) {
    return new Response(JSON.stringify({ error: 'project_id is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (isPrivateUrl(url)) {
    return new Response(JSON.stringify({ error: 'URL is not allowed' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(jsonEvent(data))

      try {
        // 1. Fetch the URL
        send({ type: 'progress', message: `Fetching ${url}…` })

        let rawHtml = ''
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'ReportHub/1.0 (documentation archiver)',
              'Accept': 'text/html,application/xhtml+xml,text/plain',
            },
            signal: AbortSignal.timeout(12_000),
            redirect: 'follow',
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const contentType = res.headers.get('content-type') ?? ''
          rawHtml = await res.text()

          // For plain text / markdown, wrap in simple HTML
          if (!contentType.includes('html')) {
            rawHtml = `<pre>${rawHtml}</pre>`
          }
        } catch (fetchErr) {
          send({ type: 'error', message: `Could not fetch URL: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}` })
          controller.close()
          return
        }

        // 2. Extract text content
        send({ type: 'progress', message: 'Extracting content…' })
        const textContent = extractContent(rawHtml)

        if (textContent.length < 50) {
          send({ type: 'error', message: 'Page content is too short or could not be extracted. The URL may require authentication or be dynamically loaded.' })
          controller.close()
          return
        }

        // 3. Claude converts it to a clean doc
        send({ type: 'progress', message: 'Claude is converting the page…' })

        const docTitle = (title?.trim()) || `Imported from ${new URL(url).hostname}`
        const focusNote = prompt?.trim() ? `\n\nAdditional instructions: ${prompt.trim()}` : ''

        const userMessage = `Convert the following web page content into a clean, professional, self-contained HTML documentation page for internal archiving.

Source URL: ${url}
Page title: ${docTitle}

Raw page content:
${textContent}

Requirements:
- Return ONLY valid, complete HTML (with <html>, <head>, <body>)
- Use inline CSS — no external stylesheets
- Professional, readable typography
- Preserve all meaningful content, headings, lists, code blocks
- Add a small header banner showing the source URL and import date
- Clean layout, good spacing${focusNote}`

        let accumulated = ''
        const claudeStream = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: 'You are a documentation archiver. Convert web content to clean, standalone HTML. Return ONLY the HTML file — no markdown, no explanations.',
          messages: [{ role: 'user', content: userMessage }],
          stream: true,
        })

        for await (const event of claudeStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            accumulated += event.delta.text
            send({ type: 'chunk', content: event.delta.text })
          }
        }

        const finalHtml = accumulated
          .replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim()

        if (!finalHtml) {
          send({ type: 'error', message: 'Claude returned empty content.' })
          controller.close()
          return
        }

        // 4. Save as document
        send({ type: 'progress', message: 'Saving document…' })

        const slug = await generateDocumentSlug()
        const doc = await createDocument(docTitle, project_id, profile!.id, slug, false)
        const versionNumber = await getNextVersionNumber(doc.id)
        const storageKey = `documents/${doc.id}/v${versionNumber}.html`
        const fileSize = Buffer.byteLength(finalHtml, 'utf-8')

        await uploadObject(storageKey, finalHtml)
        const version = await insertVersion(
          doc.id, versionNumber, storageKey, fileSize,
          profile!.id, null, `Imported from ${url}`
        )
        await updateDocumentCurrentVersion(doc.id, version.id)

        logAuditEvent({
          eventType: 'url.imported',
          actorId: profile!.id,
          resourceType: 'document',
          resourceId: doc.id,
          resourceTitle: docTitle,
          metadata: { source_url: url, project_id },
        })

        send({ type: 'done', documentId: doc.id, html: finalHtml, versionNumber })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}
