import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { editor, boundedJson, failure, HttpError } from '@/lib/workspace-http'
import { getWorkspace, busy } from '@/lib/workspace-store'
import { createServiceClient } from '@/lib/supabase-server'
import { uploadObject } from '@/lib/storage'
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params,
      { profile, doc } = await editor(req, id),
      body = await boundedJson(req, 2000),
      thread = await getWorkspace(id, profile.id)
    if (busy(thread))
      throw new HttpError(409, 'Wait for generation to finish before applying a draft.')
    if (!thread.draft || thread.draft.id !== body.draft_id)
      throw new HttpError(409, 'The draft changed or was already applied. Reload the workspace.')
    if (thread.draft.base_version_id !== doc.current_version_id)
      throw new HttpError(
        409,
        'A newer artifact version was saved. Download this draft, then discard it and start from the latest version.',
      )
    const key = 'documents/' + id + '/' + randomUUID() + '.html'
    await uploadObject(key, thread.draft.html)
    const { data, error } = await createServiceClient().rpc('apply_artifact_workspace_draft', {
      p_workspace: thread.id,
      p_user: profile.id,
      p_draft: thread.draft.id,
      p_storage_key: key,
      p_file_size: Buffer.byteLength(thread.draft.html),
    })
    if (error) {
      if (/VERSION_CONFLICT|DRAFT_CHANGED|WORKSPACE_BUSY/.test(error.message))
        throw new HttpError(409, 'The artifact or draft changed. Reload before applying.')
      throw error
    }
    return Response.json({
      version: Array.isArray(data) ? data[0] : data,
      share_url: (process.env.FRONTEND_URL || '') + '/view/' + doc.slug,
    })
  } catch (e) {
    return failure(e)
  }
}
