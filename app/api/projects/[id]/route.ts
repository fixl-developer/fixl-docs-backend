import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getProject, updateProject, deleteProject, listProjectMembers } from '@/lib/db'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const project = await getProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const members = await listProjectMembers(id)
  return NextResponse.json({ ...project, members })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const updates: Record<string, string> = {}
  if (body.name) updates.name = body.name.trim()
  if (body.description !== undefined) updates.description = body.description

  const project = await updateProject(id, updates)
  return NextResponse.json(project)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  if (!profile || !['manager', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  await deleteProject(id)
  return NextResponse.json({ success: true })
}
