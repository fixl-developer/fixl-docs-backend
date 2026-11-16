import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getDocument, getVersion } from '@/lib/db'
import { fetchObject } from '@/lib/storage'

interface Params { params: Promise<{ id: string }> }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim()
}

function send(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
}

export async function POST(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const doc = await getDocument(id)
  if (!doc) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })

  const { version1_id, version2_id } = await req.json()
  if (!version1_id || !version2_id) {
    return new Response(JSON.stringify({ error: 'version1_id and version2_id required' }), { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const [v1, v2] = await Promise.all([
          getVersion(version1_id),
          getVersion(version2_id),
        ])
        if (!v1 || !v2) { send(controller, { error: 'Version not found' }); controller.close(); return }

        send(controller, { status: 'Fetching versions…' })

        const [html1, html2] = await Promise.all([
          fetchObject(v1.storage_key),
          fetchObject(v2.storage_key),
        ])

        const text1 = stripHtml(html1)
        const text2 = stripHtml(html2)

        send(controller, { status: 'Analyzing with Claude…' })

        const prompt = `You are comparing two versions of an internal business report.

VERSION A (older — v${v1.version_number}):
---
${text1.slice(0, 8000)}
---

VERSION B (newer — v${v2.version_number}):
---
${text2.slice(0, 8000)}
---

Generate a clear, structured comparison report in this exact format:

## Summary
One sentence describing the overall nature of the changes.

## What was added
- Bullet list of new content, sections, data, or features added in v${v2.version_number}
- (write "Nothing new was added" if nothing was added)

## What changed
- Bullet list of content that existed before but was updated, edited, or reorganised
- Include specific numbers, names, or values where they changed
- (write "No changes to existing content" if nothing changed)

## What was removed
- Bullet list of content that existed in v${v1.version_number} but is gone in v${v2.version_number}
- (write "Nothing was removed" if nothing was removed)

## Overall assessment
One or two sentences: is this a minor update, a major revision, or a complete rewrite? What is the main purpose of the changes?

Be specific about actual content — mention real numbers, names, section titles from the document. Do not be vague.`

        const claudeStream = anthropic.messages.stream({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        })

        let fullText = ''
        for await (const event of claudeStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text
            send(controller, { chunk: event.delta.text })
          }
        }

        send(controller, { done: true, fullText })
      } catch (err) {
        send(controller, { error: err instanceof Error ? err.message : 'Failed' })
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
