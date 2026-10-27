import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { addProjectMember, removeProjectMember } from '@/lib/db'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body?.user_id) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }

  await addProjectMember(id, body.user_id, body.role ?? 'editor')
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('user_id')
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  await removeProjectMember(id, userId)
  return NextResponse.json({ success: true })
}
