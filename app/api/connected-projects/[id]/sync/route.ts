import type { NextRequest } from 'next/server'
import { getAuthProfile } from '@/lib/auth'
import {
  getConnectedProject,
  getDocument,
  createDocument,
  createProject,
  updateConnectedProjectAfterSync,
} from '@/lib/db'
import { documentAccess, canCreateInProject } from '@/lib/permissions'
import { generateDocumentSlug } from '@/lib/slugs'
import { failure, HttpError, boundedJson } from '@/lib/workspace-http'
import { checkContextLimit } from '@/lib/workspace-store'
// Opening a connection no longer generates or publishes documentation. File
// selection, private snapshots, and explicit draft acceptance live in /workspace.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await getAuthProfile(req)
    if (!profile) throw new HttpError(401, 'Sign in to continue.')
    const { id } = await params,
      cp = await getConnectedProject(id)
    if (!cp || cp.created_by !== profile.id) throw new HttpError(404, 'Connection not found.')
    const body = await boundedJson(req, 2000)
    if (body.files)
      throw new HttpError(
        409,
        'Open the new source workspace to review and attach files before generating.',
      )
    await checkContextLimit(profile.id)
    if (cp.document_id) {
      const doc = await getDocument(cp.document_id)
      if (!doc || !(await documentAccess(profile, doc)).edit)
        throw new HttpError(403, 'You no longer have editing access to the linked artifact.')
      return Response.json({ documentId: doc.id })
    }
    let projectId = cp.project_id
    if (projectId && !(await canCreateInProject(profile, projectId)))
      throw new HttpError(403, 'You need editor access to this project.')
    if (!projectId) projectId = (await createProject(cp.name, 'Code documentation', profile.id)).id
    const document = await createDocument(
      cp.name + ' — Code Docs',
      projectId,
      profile.id,
      await generateDocumentSlug(),
      false,
    )
    await updateConnectedProjectAfterSync(id, document.id, 0, projectId)
    return Response.json({ documentId: document.id }, { status: 201 })
  } catch (e) {
    return failure(e)
  }
}
