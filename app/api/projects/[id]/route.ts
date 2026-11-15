import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getProject, updateProject, deleteProject, listProjectMembers } from '@/lib/db'
import { canReadProject, canEditProject, isLead } from '@/lib/permissions'
interface Params {
  params: Promise<{ id: string }>
}
export async function GET(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params
  if (!(await canReadProject(profile!, id)))
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const project = await getProject(id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  return NextResponse.json({ ...project, members: await listProjectMembers(id) })
}
export async function PATCH(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params
  if (!(await canEditProject(profile!, id)))
    return NextResponse.json({ error: 'You cannot edit this project.' }, { status: 403 })
  const body = await req.json().catch(() => null),
    updates: { name?: string; description?: string | null } = {}
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120)
      return NextResponse.json({ error: 'Enter a valid project name.' }, { status: 400 })
    updates.name = body.name.trim()
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string')
      return NextResponse.json({ error: 'Invalid description' }, { status: 400 })
    updates.description = body.description?.slice(0, 1000) || null
  }
  return NextResponse.json(await updateProject(id, updates))
}
export async function DELETE(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  if (!isLead(profile!))
    return NextResponse.json(
      { error: 'Only managers and founders can delete projects.' },
      { status: 403 },
    )
  const { id } = await params
  await deleteProject(id)
  return NextResponse.json({ success: true })
}
