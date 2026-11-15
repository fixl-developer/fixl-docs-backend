import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getAllDocuments, createDocument, getStarredDocumentIds } from '@/lib/db'
import { canCreateInProject } from '@/lib/permissions'
import { saveVersion } from '@/lib/save-version'
import { generateDocumentSlug } from '@/lib/slugs'
import { validateHtmlSize } from '@/lib/validate'
import { normalizeArtifactHtml, artifactSourceError } from '@/lib/artifact-import'
export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  try {
    const [docs, starred] = await Promise.all([
      getAllDocuments(profile!.id, profile!),
      getStarredDocumentIds(profile!.id),
    ])
    const ids = new Set(starred)
    return NextResponse.json(docs.map((d) => ({ ...d, is_starred: ids.has(d.id) })))
  } catch {
    return NextResponse.json({ error: 'Could not load your artifact library.' }, { status: 500 })
  }
}
export async function POST(req: NextRequest) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const body = await req.json().catch(() => null)
  if (
    typeof body?.title !== 'string' ||
    !body.title.trim() ||
    body.title.length > 160 ||
    typeof body.project_id !== 'string' ||
    typeof body.html !== 'string' ||
    !body.html.trim()
  )
    return NextResponse.json(
      { error: 'A title, project, and HTML content are required.' },
      { status: 400 },
    )
  if (body.is_public !== undefined && typeof body.is_public !== 'boolean')
    return NextResponse.json({ error: 'is_public must be a boolean' }, { status: 400 })
  if (!(await canCreateInProject(profile!, body.project_id)))
    return NextResponse.json(
      { error: 'You need editor access to add an artifact to this project.' },
      { status: 403 },
    )
  const html = normalizeArtifactHtml(body.html),
    sourceError = artifactSourceError(html),
    size = validateHtmlSize(html)
  if (sourceError || !size.valid)
    return NextResponse.json({ error: sourceError || size.error }, { status: 400 })
  try {
    const slug = await generateDocumentSlug(),
      doc = await createDocument(
        body.title.trim(),
        body.project_id,
        profile!.id,
        slug,
        body.is_public ?? false,
      )
    const version = await saveVersion({
      documentId: doc.id,
      html,
      createdBy: profile!.id,
      expectedVersionId: null,
      prompt: typeof body.prompt_used === 'string' ? body.prompt_used.slice(0, 12000) : null,
      note: typeof body.change_note === 'string' ? body.change_note.slice(0, 300) : null,
    })
    return NextResponse.json(
      {
        ...doc,
        current_version_id: version.id,
        current_version: version,
        share_url: (process.env.FRONTEND_URL ?? '') + '/view/' + slug,
      },
      { status: 201 },
    )
  } catch {
    return NextResponse.json(
      {
        error:
          'The artifact could not be fully saved. Check the library before retrying, or contact your administrator.',
      },
      { status: 500 },
    )
  }
}
