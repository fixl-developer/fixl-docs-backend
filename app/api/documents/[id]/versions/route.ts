import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getDocument, listVersions } from '@/lib/db'
import { documentAccess } from '@/lib/permissions'
import { normalizeArtifactHtml, artifactSourceError } from '@/lib/artifact-import'
import { validateHtmlSize } from '@/lib/validate'
import { saveVersion } from '@/lib/save-version'
interface Params {
  params: Promise<{ id: string }>
}
export async function GET(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params,
    doc = await getDocument(id)
  if (!doc || !(await documentAccess(profile!, doc)).read)
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  return NextResponse.json(await listVersions(id))
}
export async function POST(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const { id } = await params,
    doc = await getDocument(id)
  if (!doc) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  if (!(await documentAccess(profile!, doc)).edit)
    return NextResponse.json(
      { error: 'You do not have permission to update this artifact.' },
      { status: 403 },
    )
  const body = await req.json().catch(() => null)
  if (typeof body?.html !== 'string' || !body.html.trim())
    return NextResponse.json({ error: 'HTML content is required' }, { status: 400 })
  const html = normalizeArtifactHtml(body.html),
    sourceError = artifactSourceError(html),
    size = validateHtmlSize(html)
  if (sourceError || !size.valid)
    return NextResponse.json({ error: sourceError || size.error }, { status: 400 })
  if (body.base_version_id !== undefined && body.base_version_id !== doc.current_version_id)
    return NextResponse.json(
      { error: 'A newer version has been saved. Reload the artifact before saving your changes.' },
      { status: 409 },
    )
  try {
    const version = await saveVersion({
      documentId: id,
      html,
      createdBy: profile!.id,
      expectedVersionId: doc.current_version_id,
      prompt: typeof body.prompt_used === 'string' ? body.prompt_used.slice(0, 12000) : null,
      note: typeof body.change_note === 'string' ? body.change_note.slice(0, 300) : null,
    })
    return NextResponse.json(version, { status: 201 })
  } catch (e) {
    const conflict = e instanceof Error && e.message === 'VERSION_CONFLICT'
    return NextResponse.json(
      {
        error: conflict
          ? 'A newer version was saved while you were editing. Reload and try again.'
          : 'Could not finalize this version. Please try again or contact your administrator.',
      },
      { status: conflict ? 409 : 500 },
    )
  }
}
