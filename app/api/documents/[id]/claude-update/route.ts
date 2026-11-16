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

IMPORTANT: Only respond to requests that ask you to create or modify an HTML document.

If the user sends a greeting, question, off-topic message, or anything that is NOT a document change or creation request, respond with:
<thinking>One sentence explaining you can only help with document tasks.</thinking>
<noop>A short, friendly message telling the user what you can help with. Example: "I can only help you create or update documents. Try describing a change you'd like to make to this document."</noop>

For actual document requests, respond in exactly this format:
<thinking>
One or two sentences describing what you will do. Be specific and natural. Example: "I'll add a revenue chart in the header section and update the Q3 figures to reflect the new data." Keep it under 40 words.
</thinking>
<!DOCTYPE html>
<html>
...rest of the complete HTML document...

Rules for the HTML:
- Return a complete, valid HTML document (with <html>, <head>, <body>).
- Use inline CSS only — no external stylesheets or CDN links.
- Charts, tables, and data visualizations should use pure HTML/CSS or inline SVG.
- Keep the document professional and readable.
- No markdown, no code fences, no extra explanation outside the <thinking> tag.`

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
        let inputTokens = 0
        let outputTokens = 0
        let finalModel = model

        const claudeStream = await anthropic.messages.create({
          model,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
          stream: true,
        })

        // ── Stream parser ──────────────────────────────────────────────────────
        let fullBuffer = ''
        let sentThinkingLen = 0
        let sentHtmlLen = 0
        let thinkingDone = false
        let noopDetected = false
        let htmlAccumulated = ''

        const THINK_OPEN  = '<thinking>'
        const THINK_CLOSE = '</thinking>'
        const NOOP_OPEN   = '<noop>'
        const NOOP_CLOSE  = '</noop>'

        for await (const event of claudeStream) {
          if (event.type === 'message_start') {
            inputTokens = event.message.usage.input_tokens
            finalModel = event.message.model
          }
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            fullBuffer += event.delta.text

            const thinkStart = fullBuffer.indexOf(THINK_OPEN)
            const thinkEnd   = fullBuffer.indexOf(THINK_CLOSE)
            const noopStart  = fullBuffer.indexOf(NOOP_OPEN)
            const noopEnd    = fullBuffer.indexOf(NOOP_CLOSE)

            // ── Thinking phase ──────────────────────────────────────────────
            if (!thinkingDone) {
              if (thinkStart === -1) continue

              const rawThinking = thinkEnd !== -1
                ? fullBuffer.slice(thinkStart + THINK_OPEN.length, thinkEnd)
                : fullBuffer.slice(thinkStart + THINK_OPEN.length, fullBuffer.length - THINK_CLOSE.length)

              if (rawThinking.length > sentThinkingLen) {
                send({ thinkChunk: rawThinking.slice(sentThinkingLen) })
                sentThinkingLen = rawThinking.length
              }

              if (thinkEnd !== -1) {
                thinkingDone = true
                send({ thinkDone: true })
              }
            }

            // ── Noop detection (after thinking) ────────────────────────────
            if (thinkingDone && !noopDetected && noopEnd !== -1 && noopStart !== -1) {
              noopDetected = true
              const noopMsg = fullBuffer.slice(noopStart + NOOP_OPEN.length, noopEnd).trim()
              send({ noop: true, message: noopMsg })
              controller.close()
              return
            }

            // ── HTML streaming ─────────────────────────────────────────────
            if (thinkingDone && !noopDetected) {
              const afterClose = fullBuffer.slice(fullBuffer.indexOf(THINK_CLOSE) + THINK_CLOSE.length)
              const htmlPart = sentHtmlLen === 0 ? afterClose.replace(/^\s+/, '') : afterClose
              if (htmlPart.length > sentHtmlLen) {
                const newChunk = htmlPart.slice(sentHtmlLen)
                htmlAccumulated += newChunk
                send({ chunk: newChunk })
                sentHtmlLen = htmlPart.length
              }
            }
          }
          if (event.type === 'message_delta') {
            outputTokens = event.usage.output_tokens
          }
        }

        if (noopDetected) return

        // ── Fallback: no thinking wrapper ──────────────────────────────────
        if (!thinkingDone && fullBuffer.trim()) {
          htmlAccumulated = fullBuffer.trim()
        }

        const rawHtml = htmlAccumulated
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
