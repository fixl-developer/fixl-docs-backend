import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import {
  getAllDocuments,
  createDocument,
  insertVersion,
  updateDocumentCurrentVersion,
  getStarredDocumentIds,
} from '@/lib/db'
import { uploadObject } from '@/lib/storage'
import { generateDocumentSlug } from '@/lib/slugs'
import { validateHtmlSize } from '@/lib/validate'
import { normalizeArtifactHtml, artifactSourceError } from '@/lib/artifact-import'
import type { CreateDocumentBody } from '@/types/platform'

export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  try {
    const [documents, starredIds] = await Promise.all([
      getAllDocuments(profile!.id, profile!),
      getStarredDocumentIds(profile!.id).catch(() => [] as string[]),
    ])
    const starredSet = new Set(starredIds)
    return NextResponse.json(documents.map((d) => ({ ...d, is_starred: starredSet.has(d.id) })))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/documents]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  try {
    const body: CreateDocumentBody = await req.json().catch(() => null)
    if (!body?.title?.trim() || !body?.project_id || !body?.html) {
      return NextResponse.json({ error: 'title, project_id, and html are required' }, { status: 400 })
    }

    const html = normalizeArtifactHtml(body.html)
    const sourceError = artifactSourceError(html)
    if (sourceError) return NextResponse.json({ error: sourceError }, { status: 400 })

    const sizeCheck = validateHtmlSize(html)
    if (!sizeCheck.valid) return NextResponse.json({ error: sizeCheck.error }, { status: 400 })

    const slug = await generateDocumentSlug()
    const doc = await createDocument(
      body.title.trim(),
      body.project_id,
      profile!.id,
      slug,
      body.is_public ?? false
    )

    const versionNumber = 1
    const storageKey = `documents/${doc.id}/v${versionNumber}.html`
    const fileSize = Buffer.byteLength(html, 'utf-8')

    await uploadObject(storageKey, html)

    const version = await insertVersion(
      doc.id, versionNumber, storageKey, fileSize,
      profile!.id, null, body.change_note ?? null
    )

    await updateDocumentCurrentVersion(doc.id, version.id)

    const appUrl = process.env.FRONTEND_URL ?? ''
    return NextResponse.json(
      { ...doc, current_version: version, share_url: `${appUrl}/view/${slug}` },
      { status: 201 }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/documents]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
