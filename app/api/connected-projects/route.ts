import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { listConnectedProjects, createConnectedProject } from '@/lib/db'
import { getDocument } from '@/lib/db'
import { documentAccess, canCreateInProject } from '@/lib/permissions'
import type { CreateConnectedProjectBody } from '@/types/platform'

export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  try {
    const projects = await listConnectedProjects(profile!.id, profile!.role)
    return NextResponse.json(projects)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const body: CreateConnectedProjectBody = await req.json().catch(() => null)
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 120)
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!body.type || !['local', 'github'].includes(body.type)) {
    return NextResponse.json({ error: 'type must be local or github' }, { status: 400 })
  }
  if (
    body.type === 'github' &&
    (typeof body.github_repo_url !== 'string' || !body.github_repo_url.trim())
  ) {
    return NextResponse.json(
      { error: 'github_repo_url is required for github type' },
      { status: 400 },
    )
  }

  if (
    body.github_branch !== undefined &&
    (typeof body.github_branch !== 'string' || body.github_branch.length > 200)
  )
    return NextResponse.json({ error: 'Invalid branch name.' }, { status: 400 })
  for (const value of [body.document_id, body.project_id])
    if (value && (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)))
      return NextResponse.json(
        { error: 'Invalid document or project identifier.' },
        { status: 400 },
      )
  if (body.document_id) {
    const doc = await getDocument(body.document_id)
    if (!doc || !(await documentAccess(profile!, doc)).edit)
      return NextResponse.json(
        { error: 'You need editing access to the linked artifact.' },
        { status: 403 },
      )
  }
  if (body.project_id && !(await canCreateInProject(profile!, body.project_id)))
    return NextResponse.json({ error: 'Project editor access is required.' }, { status: 403 })
  try {
    const cp = await createConnectedProject(
      body.name.trim(),
      body.type,
      profile!.id,
      body.project_id ?? null,
      body.github_repo_url ?? null,
      body.github_branch ?? 'main',
      body.document_id ?? null,
    )
    return NextResponse.json(cp, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
