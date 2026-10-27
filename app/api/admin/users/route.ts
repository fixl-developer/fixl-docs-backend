import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireRole } from '@/lib/auth'
import { listProfiles } from '@/lib/db'

export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const roleError = requireRole(profile, ['manager', 'founder'])
  if (roleError) return roleError

  const users = await listProfiles()
  return NextResponse.json(users)
}
