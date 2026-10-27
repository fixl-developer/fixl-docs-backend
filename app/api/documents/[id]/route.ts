import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getDocument, updateDocument, insertViewLog } from '@/lib/db'
import { createServiceClient } from '@/lib/supabase-server'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const doc = await getDocument(id)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // log the view for managers to see
  await insertViewLog(doc.id, doc.current_version_id, profile!.id)

  return NextResponse.json(doc)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}
  if (body.title) updates.title = body.title.trim()
  if (body.is_public !== undefined) updates.is_public = body.is_public

  const doc = await updateDocument(id, updates)
  return NextResponse.json(doc)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const doc = await getDocument(id)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only creator, manager, or founder can delete
  const canDelete =
    doc.created_by === profile!.id ||
    profile!.role === 'manager' ||
    profile!.role === 'founder'
  if (!canDelete) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = createServiceClient()
  const { error } = await supabase.from('documents').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
