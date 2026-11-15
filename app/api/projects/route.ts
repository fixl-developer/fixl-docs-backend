import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { listProjects, createProject } from '@/lib/db'

export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const projects = await listProjects(profile!.id, profile!.role)
  return NextResponse.json(projects)
}

export async function POST(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 120) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
  }

  if (
    body.description !== undefined &&
    (typeof body.description !== 'string' || body.description.length > 2000)
  )
    return NextResponse.json(
      { error: 'Description must be text of up to 2,000 characters.' },
      { status: 400 },
    )

  const project = await createProject(body.name.trim(), body.description ?? null, profile!.id)
  return NextResponse.json(project, { status: 201 })
}
