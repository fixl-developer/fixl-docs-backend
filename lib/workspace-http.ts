import type { NextRequest } from 'next/server'
import { getAuthProfile } from './auth'
import { getDocument } from './db'
import { documentAccess } from './permissions'
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export async function editor(req: NextRequest, id: string) {
  const profile = await getAuthProfile(req)
  if (!profile) throw new HttpError(401, 'Sign in to continue.')
  const doc = await getDocument(id)
  if (!doc || (doc as unknown as { deleted_at?: string }).deleted_at)
    throw new HttpError(404, 'Artifact not found.')
  if (!(await documentAccess(profile, doc)).edit)
    throw new HttpError(403, 'You need editing access to open this workspace.')
  return { profile, doc }
}
export async function boundedJson(
  req: Request,
  maxBytes = 2400000,
): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length')) > maxBytes)
    throw new HttpError(413, 'Request is too large.')
  const reader = req.body?.getReader()
  if (!reader) throw new HttpError(400, 'A request body is required.')
  let count = 0,
    text = ''
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      count += value.byteLength
      if (count > maxBytes) throw new HttpError(413, 'Request is too large.')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    return data
  } catch {
    throw new HttpError(400, 'Invalid JSON request.')
  }
}
export function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : 'The workspace request could not be completed. Check the connection and database migration.',
    },
    {
      status: error instanceof HttpError ? error.status : 500,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
