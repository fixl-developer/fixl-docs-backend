import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { editor, boundedJson, failure, HttpError } from '@/lib/workspace-http'
import {
  getWorkspace,
  sourcesFor,
  claimGeneration,
  completeGeneration,
} from '@/lib/workspace-store'
import { retrieveContext } from '@/lib/context-retrieval'
import { createClaudeDraft } from '@/lib/claude-draft'
import { fetchObject } from '@/lib/storage'
export const maxDuration = 180
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params,
      { profile, doc } = await editor(req, id),
      body = await boundedJson(req, 20000)
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000)
      throw new HttpError(400, 'Enter an update instruction of up to 12,000 characters.')
    if (!process.env.ANTHROPIC_API_KEY)
      throw new HttpError(
        503,
        'Claude is not configured. Your saved artifact and sources are unchanged.',
      )
    const thread = await getWorkspace(id, profile.id)
    if (thread.draft && thread.draft.base_version_id !== doc.current_version_id)
      throw new HttpError(
        409,
        'The saved artifact changed after this draft began. Download or discard the draft, then start from the latest version.',
      )
    let current = thread.draft?.html
    if (!current && doc.current_version?.storage_key)
      current = await fetchObject(doc.current_version.storage_key)
    const context = retrieveContext(await sourcesFor(thread.id), body.prompt)
    const pending = await claimGeneration(thread, body.prompt.trim())
    const response = await createClaudeDraft(req, profile.id, { prompt: body.prompt }, current, {
      history: thread.messages
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
      context:
        context.text +
        '\n[Context selection: ' +
        context.references.length +
        ' file excerpts included; ' +
        context.omitted +
        ' files omitted from this request.]',
      onComplete: async (html, meta) => {
        const draft = {
          id: randomUUID(),
          html,
          prompt: body.prompt as string,
          base_version_id: doc.current_version_id,
          created_at: new Date().toISOString(),
          references: context.references,
          meta,
        }
        await completeGeneration(
          pending,
          draft,
          'Updated draft ready. Review it, then apply the update to change the shared artifact.',
        )
        return {
          draftId: draft.id,
          baseVersionId: draft.base_version_id,
          references: draft.references,
        }
      },
      onFailure: () =>
        completeGeneration(
          pending,
          null,
          'Generation did not complete. The saved artifact and any previous draft are unchanged.',
        ),
    })
    if (!response.ok)
      await completeGeneration(
        pending,
        null,
        'Claude could not start this request. Your saved artifact is unchanged.',
      )
    return response
  } catch (e) {
    return failure(e)
  }
}
