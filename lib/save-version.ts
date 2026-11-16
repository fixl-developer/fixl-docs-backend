import { randomUUID } from 'node:crypto'
import { createServiceClient } from './supabase-server'
import { uploadObject } from './storage'
import type { DocumentVersion } from '@/types/platform'
export async function saveVersion(input: {
  documentId: string
  html: string
  createdBy: string
  expectedVersionId: string | null
  prompt?: string | null
  note?: string | null
}): Promise<DocumentVersion> {
  // Immutable object keys prevent one request from overwriting another's HTML.
  const storageKey = 'documents/' + input.documentId + '/' + randomUUID() + '.html'
  const fileSize = Buffer.byteLength(input.html, 'utf8')
  await uploadObject(storageKey, input.html)
  const { data, error } = await createServiceClient().rpc('save_artifact_version', {
    p_document_id: input.documentId,
    p_storage_key: storageKey,
    p_file_size: fileSize,
    p_created_by: input.createdBy,
    p_prompt_used: input.prompt ?? null,
    p_change_note: input.note ?? null,
    p_expected_version_id: input.expectedVersionId,
  })
  // Do not delete the uploaded object here: a network error can occur after commit.
  // Unreferenced private objects can be removed by a separately verified cleanup job.
  if (error) {
    if (error.message.includes('VERSION_CONFLICT')) throw new Error('VERSION_CONFLICT')
    throw new Error(
      'Could not finalize the saved version. Check the workspace database migration and try again.',
    )
  }
  return (Array.isArray(data) ? data[0] : data) as DocumentVersion
}
