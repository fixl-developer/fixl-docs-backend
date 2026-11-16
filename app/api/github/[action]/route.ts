import type { NextRequest } from 'next/server'
import { getAuthProfile } from '@/lib/auth'
import { HttpError, boundedJson, failure } from '@/lib/workspace-http'
import {
  beginGithub,
  finishGithub,
  githubStatus,
  disconnectGithub,
  githubBranches,
  githubTree,
} from '@/lib/github-context'
import { checkContextLimit } from '@/lib/workspace-store'
type Context = { params: Promise<{ action: string }> }
export async function GET(req: NextRequest, { params }: Context) {
  try {
    const p = await getAuthProfile(req)
    if (!p) throw new HttpError(401, 'Sign in to continue.')
    const { action } = await params
    if (action === 'status')
      return Response.json(await githubStatus(p.id), { headers: { 'Cache-Control': 'no-store' } })
    await checkContextLimit(p.id)
    if (action === 'branches')
      return Response.json(
        await githubBranches(
          p.id,
          req.nextUrl.searchParams.get('repository'),
          Number(req.nextUrl.searchParams.get('page') || 1),
        ),
      )
    throw new HttpError(404, 'Not found.')
  } catch (e) {
    return failure(e)
  }
}
export async function POST(req: NextRequest, { params }: Context) {
  try {
    const p = await getAuthProfile(req)
    if (!p) throw new HttpError(401, 'Sign in to continue.')
    const { action } = await params
    const body = await boundedJson(req, 16000)
    await checkContextLimit(p.id)
    if (action === 'connect') {
      const id =
        typeof body.document_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.document_id)
          ? body.document_id
          : undefined
      return Response.json(await beginGithub(p.id, id))
    }
    if (action === 'complete') return Response.json(await finishGithub(p.id, body.code, body.state))
    if (action === 'disconnect') {
      await disconnectGithub(p.id)
      return Response.json({ success: true })
    }
    if (action === 'tree')
      return Response.json(await githubTree(p.id, body.repository, body.branch))
    throw new HttpError(404, 'Not found.')
  } catch (e) {
    return failure(e)
  }
}
