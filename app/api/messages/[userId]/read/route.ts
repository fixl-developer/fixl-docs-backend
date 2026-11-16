import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { markThreadRead } from '@/lib/db'

interface Params { params: Promise<{ userId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { userId } = await params
  await markThreadRead(profile!.id, userId)
  return new NextResponse(null, { status: 204 })
}
