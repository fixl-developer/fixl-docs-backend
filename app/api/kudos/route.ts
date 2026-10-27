import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { createKudos, getKudosForUser } from '@/lib/db'

export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  try {
    const kudos = await getKudosForUser(profile!.id)
    return NextResponse.json(kudos)
  } catch (err) {
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  if (profile!.role === 'employee') {
    return NextResponse.json({ error: 'Only managers and founders can send kudos' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.to_user_id || !body?.message?.trim()) {
    return NextResponse.json({ error: 'to_user_id and message are required' }, { status: 400 })
  }

  try {
    const kudos = await createKudos(
      profile!.id,
      body.to_user_id,
      body.message.trim(),
      body.emoji ?? '⭐'
    )
    return NextResponse.json(kudos, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
