import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireRole } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase-server'
import type { InviteUserBody } from '@/types/platform'

export async function POST(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const roleError = requireRole(profile, ['manager', 'founder'])
  if (roleError) return roleError

  const body: InviteUserBody = await req.json().catch(() => null)
  if (!body?.email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(body.email, {
    data: {
      full_name: body.full_name ?? '',
      role: body.role ?? 'employee',
    },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ id: data.user.id, email: data.user.email }, { status: 201 })
}
