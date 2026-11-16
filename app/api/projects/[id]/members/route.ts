import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { addProjectMember, removeProjectMember, listProjectMembers } from '@/lib/db'
import { canEditProject } from '@/lib/permissions'
interface Params {
  params: Promise<{ id: string }>
}
export async function POST(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params
  if (!(await canEditProject(profile!, id)))
    return NextResponse.json(
      { error: 'Only project owners and workspace leads can manage members.' },
      { status: 403 },
    )
  const body = await req.json().catch(() => null)
  if (
    typeof body?.user_id !== 'string' ||
    !['owner', 'editor', 'viewer'].includes(body.role ?? 'editor')
  )
    return NextResponse.json(
      { error: 'A user and valid membership role are required.' },
      { status: 400 },
    )
  const members = await listProjectMembers(id),
    target = members.find((m) => m.user_id === body.user_id)
  if (
    target?.role === 'owner' &&
    body.role !== 'owner' &&
    members.filter((m) => m.role === 'owner').length <= 1
  )
    return NextResponse.json(
      { error: 'Assign another project owner before changing the last owner.' },
      { status: 409 },
    )
  await addProjectMember(id, body.user_id, body.role ?? 'editor')
  return NextResponse.json({ success: true })
}
export async function DELETE(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params
  if (!(await canEditProject(profile!, id)))
    return NextResponse.json(
      { error: 'Only project owners and workspace leads can manage members.' },
      { status: 403 },
    )
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) return NextResponse.json({ error: 'A user is required.' }, { status: 400 })
  const members = await listProjectMembers(id)
  if (
    members.find((m) => m.user_id === userId)?.role === 'owner' &&
    members.filter((m) => m.role === 'owner').length <= 1
  )
    return NextResponse.json(
      { error: 'Assign another owner before removing the last owner.' },
      { status: 409 },
    )
  await removeProjectMember(id, userId)
  return NextResponse.json({ success: true })
}
