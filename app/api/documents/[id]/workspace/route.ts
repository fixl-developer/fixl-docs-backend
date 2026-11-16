import type { NextRequest } from 'next/server'
import { editor, boundedJson, failure, HttpError } from '@/lib/workspace-http'
import {
  getWorkspace,
  sourcesFor,
  summarizeSource,
  putSource,
  checkContextLimit,
  discardDraft,
} from '@/lib/workspace-store'
import { createServiceClient } from '@/lib/supabase-server'
export const maxDuration = 180
type Context = { params: Promise<{ id: string }> }
export async function GET(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params,
      { profile } = await editor(req, id),
      thread = await getWorkspace(id, profile.id)
    return Response.json(
      { thread, sources: (await sourcesFor(thread.id)).map(summarizeSource) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    return failure(e)
  }
}
export async function POST(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params,
      { profile } = await editor(req, id)
    const body = await boundedJson(req)
    await checkContextLimit(profile.id)
    const thread = await getWorkspace(id, profile.id)
    if (body.action === 'attach' || body.action === 'refresh')
      return Response.json(await putSource(thread, profile.id, body))
    if (body.action === 'remove') {
      if (typeof body.source_id !== 'string') throw new HttpError(400, 'Select a source.')
      const { error } = await createServiceClient()
        .from('artifact_context_sources')
        .delete()
        .eq('id', body.source_id)
        .eq('workspace_id', thread.id)
      if (error) throw error
      return Response.json({ success: true })
    }
    if (body.action === 'discard') {
      await discardDraft(thread)
      return Response.json({ success: true })
    }
    throw new HttpError(400, 'Unknown workspace action.')
  } catch (e) {
    return failure(e)
  }
}
