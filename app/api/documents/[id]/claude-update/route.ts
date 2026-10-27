import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import {
  getDocument,
  insertVersion,
  updateDocumentCurrentVersion,
  getNextVersionNumber,
} from '@/lib/db'
import { uploadObject, fetchObject } from '@/lib/storage'
import { validateHtmlSize } from '@/lib/validate'
import type { ClaudeUpdateBody } from '@/types/platform'

interface Params { params: Promise<{ id: string }> }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
])

const SYSTEM_PROMPT = `You are an HTML report generator for an internal office platform.
Your task is to generate or update clean, self-contained HTML documents.
Rules:
- Return ONLY valid HTML. No markdown, no code fences, no explanation.
- The HTML must be complete (include <html>, <head>, <body>).
- Use inline CSS only — no external stylesheets or CDN links.
- Charts, tables, and data visualizations should use pure HTML/CSS or inline SVG.
- Keep the document professional and readable.`

function jsonEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const doc = await getDocument(id)
  if (!doc) return errorResponse('Document not found', 404)

  const body: ClaudeUpdateBody & { model?: string } = await req.json().catch(() => null)
  if (!body?.prompt?.trim()) return errorResponse('prompt is required', 400)

  const model = ALLOWED_MODELS.has(body.model ?? '') ? body.model! : 'claude-sonnet-4-6'

  let userMessage = body.prompt.trim()

  if (body.mode === 'update' && doc.current_version_id) {
    const currentHtml = await fetchObject(
      `documents/${id}/v${doc.current_version?.version_number ?? 1}.html`
    ).catch(() => null)

    if (currentHtml) {
      userMessage = `Here is the current HTML document:\n\n${currentHtml}\n\n---\n\nUpdate instruction: ${body.prompt.trim()}`
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(jsonEvent(data))

      try {
        let accumulated = ''
        let inputTokens = 0
        let outputTokens = 0
        let finalModel = model

        // Use stream: true with messages.create — returns a raw async iterable
        const claudeStream = await anthropic.messages.create({
          model,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
          stream: true,
        })

        for await (const event of claudeStream) {
          if (event.type === 'message_start') {
            inputTokens = event.message.usage.input_tokens
            finalModel = event.message.model
          }
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const text = event.delta.text
            accumulated += text
            send({ chunk: text })
          }
          if (event.type === 'message_delta') {
            outputTokens = event.usage.output_tokens
          }
        }

        const rawHtml = accumulated
          .replace(/^```html\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/, '')
          .trim()

        if (!rawHtml) {
          send({ error: 'Claude returned empty response' })
          controller.close()
          return
        }

        const sizeCheck = validateHtmlSize(rawHtml)
        if (!sizeCheck.valid) {
          send({ error: sizeCheck.error })
          controller.close()
          return
        }

        send({ phase: 'saving' })

        const versionNumber = await getNextVersionNumber(id)
        const storageKey = `documents/${id}/v${versionNumber}.html`
        const fileSize = Buffer.byteLength(rawHtml, 'utf-8')

        await uploadObject(storageKey, rawHtml)

        const version = await insertVersion(
          id, versionNumber, storageKey, fileSize,
          profile!.id, body.prompt.trim(), body.change_note ?? null
        )

        await updateDocumentCurrentVersion(id, version.id)

        send({
          done: true,
          version,
          html: rawHtml,
          meta: {
            model: finalModel,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
        })
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) })
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
