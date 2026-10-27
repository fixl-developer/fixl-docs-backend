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
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
  }

  const project = await createProject(body.name.trim(), body.description ?? null, profile!.id)
  return NextResponse.json(project, { status: 201 })
}
