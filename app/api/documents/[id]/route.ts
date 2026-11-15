import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getDocument, updateDocument, insertViewLog } from '@/lib/db'
import { documentAccess } from '@/lib/permissions'
import { createServiceClient } from '@/lib/supabase-server'
interface Params {
  params: Promise<{ id: string }>
}
export async function GET(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params,
    doc = await getDocument(id)
  if (!doc) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  const access = await documentAccess(profile!, doc)
  if (!access.read) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  await insertViewLog(id, doc.current_version_id, profile!.id)
  return NextResponse.json({ ...doc, can_edit: access.edit, can_delete: access.delete })
}
export async function PATCH(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params,
    doc = await getDocument(id)
  if (!doc) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  if (!(await documentAccess(profile!, doc)).edit)
    return NextResponse.json({ error: 'You cannot edit this artifact.' }, { status: 403 })
  const body = await req.json().catch(() => null),
    updates: { title?: string; is_public?: boolean } = {}
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 160)
      return NextResponse.json({ error: 'Enter a title of up to 160 characters.' }, { status: 400 })
    updates.title = body.title.trim()
  }
  if (body.is_public !== undefined) {
    if (typeof body.is_public !== 'boolean')
      return NextResponse.json({ error: 'is_public must be a boolean' }, { status: 400 })
    updates.is_public = body.is_public
  }
  return NextResponse.json(await updateDocument(id, updates))
}
export async function DELETE(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params,
    doc = await getDocument(id)
  if (!doc) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  if (!(await documentAccess(profile!, doc)).delete)
    return NextResponse.json({ error: 'You cannot delete this artifact.' }, { status: 403 })
  const result = await createServiceClient().from('documents').delete().eq('id', id)
  if (result.error)
    return NextResponse.json({ error: 'Could not delete artifact.' }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
