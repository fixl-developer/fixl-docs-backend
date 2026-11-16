import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getThread, sendMessage, getProfile } from '@/lib/db'

interface Params { params: Promise<{ userId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { userId } = await params
  const thread = await getThread(profile!.id, userId)
  return NextResponse.json(thread)
}

export async function POST(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { userId } = await params
  if (userId === profile!.id) {
    return NextResponse.json({ error: 'Cannot message yourself' }, { status: 400 })
  }

  const target = await getProfile(userId)
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body?.content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }
  if (body.content.length > 2000) {
    return NextResponse.json({ error: 'Message too long (max 2000 chars)' }, { status: 400 })
  }

  try {
    const msg = await sendMessage(profile!.id, userId, body.content.trim())
    return NextResponse.json(msg, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
