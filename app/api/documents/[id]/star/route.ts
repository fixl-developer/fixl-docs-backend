import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getDocument, toggleDocumentStar } from '@/lib/db'
import { documentAccess } from '@/lib/permissions'
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params,
    doc = await getDocument(id)
  if (!doc || !(await documentAccess(profile!, doc)).read)
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  try {
    return NextResponse.json({ starred: await toggleDocumentStar(profile!.id, id) })
  } catch {
    return NextResponse.json(
      { error: 'Could not update this star. Please try again.' },
      { status: 500 },
    )
  }
}
