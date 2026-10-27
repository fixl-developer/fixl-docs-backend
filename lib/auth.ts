import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, getUserFromToken } from './supabase-server'
import type { Profile } from '@/types/platform'

export function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

export async function getAuthProfile(req: NextRequest): Promise<Profile | null> {
  const token = extractToken(req)
  if (!token) return null

  const userId = await getUserFromToken(token)
  if (!userId) return null

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error || !data) return null
  return data as Profile
}

export function requireAuth(profile: Profile | null): NextResponse | null {
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export function requireRole(
  profile: Profile | null,
  roles: Array<'employee' | 'manager' | 'founder'>
): NextResponse | null {
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!roles.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
