import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getVersion, getDocument } from '@/lib/db'
import { documentAccess } from '@/lib/permissions'
import { fetchObject } from '@/lib/storage'
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id, versionId } = await params,
    doc = await getDocument(id)
  if (!doc || !(await documentAccess(profile!, doc)).read)
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  const version = await getVersion(versionId)
  if (!version || version.document_id !== id)
    return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  if (req.nextUrl.searchParams.get('html') === '1') {
    try {
      return new NextResponse(await fetchObject(version.storage_key), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return NextResponse.json({ error: 'Saved HTML is temporarily unavailable.' }, { status: 503 })
    }
  }
  return NextResponse.json(version)
}
