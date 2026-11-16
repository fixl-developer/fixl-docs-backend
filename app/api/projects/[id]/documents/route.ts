import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { listDocuments, getStarredDocumentIds } from '@/lib/db'
import { canReadProject } from '@/lib/permissions'
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params
  if (!(await canReadProject(profile!, id)))
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const [documents, ids] = await Promise.all([
    listDocuments(id, profile!.id, profile!),
    getStarredDocumentIds(profile!.id),
  ])
  const starred = new Set(ids)
  return NextResponse.json(documents.map((d) => ({ ...d, is_starred: starred.has(d.id) })))
}
