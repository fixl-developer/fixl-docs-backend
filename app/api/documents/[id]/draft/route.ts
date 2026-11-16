import { NextRequest } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getDocument } from '@/lib/db'
import { documentAccess } from '@/lib/permissions'
import { fetchObject } from '@/lib/storage'
import { createClaudeDraft } from '@/lib/claude-draft'
export const maxDuration = 180
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params,
    doc = await getDocument(id)
  if (!doc) return Response.json({ error: 'Artifact not found' }, { status: 404 })
  if (!(await documentAccess(profile!, doc)).edit)
    return Response.json(
      { error: 'You do not have permission to update this artifact.' },
      { status: 403 },
    )
  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: 'A prompt is required.' }, { status: 400 })
  let current: string | undefined
  if (body.mode !== 'regenerate' && doc.current_version?.storage_key) {
    try {
      current = await fetchObject(doc.current_version.storage_key)
    } catch {
      return Response.json(
        { error: 'The current version could not be loaded. Try again before updating it.' },
        { status: 503 },
      )
    }
  }
  return createClaudeDraft(req, profile!.id, body, current)
}
