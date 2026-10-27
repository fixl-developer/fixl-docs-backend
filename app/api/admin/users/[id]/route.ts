import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireRole } from '@/lib/auth'
import { updateProfile } from '@/lib/db'
import type { UpdateUserBody } from '@/types/platform'

interface Params { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const roleError = requireRole(profile, ['manager', 'founder'])
  if (roleError) return roleError

  const { id } = await params

  // founder can change roles; manager can only toggle can_view_all_docs
  const body: UpdateUserBody = await req.json().catch(() => ({}))
  const updates: UpdateUserBody = {}

  if (body.full_name !== undefined) updates.full_name = body.full_name
  if (body.can_view_all_docs !== undefined) updates.can_view_all_docs = body.can_view_all_docs
  if (body.role && profile!.role === 'founder') updates.role = body.role

  const updated = await updateProfile(id, updates)
  return NextResponse.json(updated)
}
