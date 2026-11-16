import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getConnectedProject, deleteConnectedProject } from '@/lib/db'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const cp = await getConnectedProject(id)
  if (!cp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (profile!.role === 'employee' && cp.created_by !== profile!.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(cp)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const cp = await getConnectedProject(id)
  if (!cp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (profile!.role === 'employee' && cp.created_by !== profile!.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await deleteConnectedProject(id)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
