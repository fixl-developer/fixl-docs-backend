import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { listConnectedProjects, createConnectedProject } from '@/lib/db'
import type { CreateConnectedProjectBody } from '@/types/platform'

export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  try {
    const projects = await listConnectedProjects(profile!.id, profile!.role)
    return NextResponse.json(projects)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const body: CreateConnectedProjectBody = await req.json().catch(() => null)
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!body.type || !['local', 'github'].includes(body.type)) {
    return NextResponse.json({ error: 'type must be local or github' }, { status: 400 })
  }
  if (body.type === 'github' && !body.github_repo_url?.trim()) {
    return NextResponse.json({ error: 'github_repo_url is required for github type' }, { status: 400 })
  }

  try {
    const cp = await createConnectedProject(
      body.name.trim(),
      body.type,
      profile!.id,
      body.project_id ?? null,
      body.github_repo_url ?? null,
      body.github_branch ?? 'main',
      body.document_id ?? null
    )
    return NextResponse.json(cp, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
