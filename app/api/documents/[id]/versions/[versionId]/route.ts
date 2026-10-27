import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getVersion, getDocument } from '@/lib/db'
import { fetchObject } from '@/lib/storage'

interface Params { params: Promise<{ id: string; versionId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id, versionId } = await params
  const version = await getVersion(versionId)
  if (!version || version.document_id !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  if (searchParams.get('html') === '1') {
    const html = await fetchObject(version.storage_key)
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  return NextResponse.json(version)
}
