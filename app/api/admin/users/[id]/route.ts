import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireRole } from '@/lib/auth'
import { updateProfile, logAuditEvent } from '@/lib/db'
import type { UpdateUserBody } from '@/types/platform'

interface Params {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const roleError = requireRole(profile, ['manager', 'founder'])
  if (roleError) return roleError

  const { id } = await params

  // founder can change roles; manager can only toggle can_view_all_docs
  const body: UpdateUserBody = await req.json().catch(() => ({}))
  if (body.role && !['employee', 'manager', 'founder'].includes(body.role))
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  if (body.can_view_all_docs !== undefined && typeof body.can_view_all_docs !== 'boolean')
    return NextResponse.json({ error: 'Invalid access setting' }, { status: 400 })
  if (id === profile!.id && body.role && body.role !== profile!.role)
    return NextResponse.json({ error: 'Ask another founder to change your role.' }, { status: 409 })
  const updates: UpdateUserBody = {}

  if (body.full_name !== undefined) updates.full_name = body.full_name
  if (body.can_view_all_docs !== undefined) updates.can_view_all_docs = body.can_view_all_docs
  if (body.role && profile!.role === 'founder') updates.role = body.role

  const updated = await updateProfile(id, updates)

  if (updates.role) {
    logAuditEvent({
      eventType: 'user.role_changed',
      actorId: profile!.id,
      resourceType: 'user',
      resourceId: id,
      resourceTitle: updated.full_name ?? updated.email,
      metadata: { new_role: updates.role },
    })
  }
  if (updates.can_view_all_docs !== undefined) {
    logAuditEvent({
      eventType: 'user.access_changed',
      actorId: profile!.id,
      resourceType: 'user',
      resourceId: id,
      resourceTitle: updated.full_name ?? updated.email,
      metadata: { can_view_all_docs: updates.can_view_all_docs },
    })
  }

  return NextResponse.json(updated)
}
