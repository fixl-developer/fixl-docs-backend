import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import {
  getDocument,
  listVersions,
  insertVersion,
  updateDocumentCurrentVersion,
  getNextVersionNumber,
} from '@/lib/db'
import { uploadObject, fetchObject } from '@/lib/storage'
import { validateHtmlSize } from '@/lib/validate'
import { normalizeArtifactHtml, artifactSourceError } from '@/lib/artifact-import'
import type { CreateVersionBody } from '@/types/platform'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const versions = await listVersions(id)
  return NextResponse.json(versions)
}

export async function POST(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const doc = await getDocument(id)
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const body: CreateVersionBody = await req.json().catch(() => null)
  if (!body?.html) {
    return NextResponse.json({ error: 'html is required' }, { status: 400 })
  }

  let html = normalizeArtifactHtml(body.html)
  const sourceError = artifactSourceError(html)
  if (sourceError) return NextResponse.json({ error: sourceError }, { status: 400 })

  const sizeCheck = validateHtmlSize(html)
  if (!sizeCheck.valid) return NextResponse.json({ error: sizeCheck.error }, { status: 400 })

  const versionNumber = await getNextVersionNumber(id)
  const storageKey = `documents/${id}/v${versionNumber}.html`
  const fileSize = Buffer.byteLength(html, 'utf-8')

  await uploadObject(storageKey, html)

  const version = await insertVersion(
    id, versionNumber, storageKey, fileSize,
    profile!.id, null, body.change_note ?? null
  )

  await updateDocumentCurrentVersion(id, version.id)
  return NextResponse.json(version, { status: 201 })
}
