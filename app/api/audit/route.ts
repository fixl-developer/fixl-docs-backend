import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireRole } from '@/lib/auth'
import { getAuditEvents } from '@/lib/db'

export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const roleError = requireRole(profile, ['manager', 'founder'])
  if (roleError) return roleError

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500)
  const offset = Number(searchParams.get('offset') ?? 0)
  const eventType = searchParams.get('type') ?? undefined
  const actorId = searchParams.get('actor') ?? undefined
  const resourceId = searchParams.get('resource') ?? undefined

  try {
    const events = await getAuditEvents(limit, offset, { eventType, actorId, resourceId })
    return NextResponse.json(events)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
