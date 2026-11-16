import { randomUUID, createHash } from 'node:crypto'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { createServiceClient } from './supabase-server'
import { HttpError } from './workspace-http'
import { validateContextFiles } from './context-policy'
import { githubSnapshot } from './github-context'
import type {
  ContextSource,
  SourceSummary,
  WorkspaceThread,
  WorkspaceDraft,
  WorkspaceMessage,
} from '@/types/workspace'
let limiter: Ratelimit | null = null
const usage = new Map<string, { n: number; until: number }>()
export async function checkContextLimit(user: string) {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    limiter ??= new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(40, '10 m'),
      prefix: 'fixl:context',
    })
    try {
      if (!(await limiter.limit(user)).success)
        throw new HttpError(429, 'Too many source requests. Try again shortly.')
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw new HttpError(503, 'Source usage limits are temporarily unavailable.')
    }
    return
  }
  if (process.env.NODE_ENV === 'production')
    throw new HttpError(
      503,
      'Source usage limits are not configured. Ask your administrator to configure Redis.',
    )
  const now = Date.now()
  for (const [k, v] of usage) if (v.until < now) usage.delete(k)
  const v = usage.get(user) || { n: 0, until: now + 600000 }
  v.n++
  usage.set(user, v)
  if (v.n > 40) throw new HttpError(429, 'Too many source requests. Try again shortly.')
}
export async function getWorkspace(documentId: string, userId: string): Promise<WorkspaceThread> {
  const db = createServiceClient()
  const { error } = await db
    .from('artifact_workspaces')
    .upsert(
      { document_id: documentId, user_id: userId },
      { onConflict: 'document_id,user_id', ignoreDuplicates: true },
    )
  if (error) throw error
  const result = await db
    .from('artifact_workspaces')
    .select('*')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .single()
  if (result.error) throw result.error
  return result.data
}
export async function sourcesFor(workspaceId: string): Promise<ContextSource[]> {
  const { data, error } = await createServiceClient()
    .from('artifact_context_sources')
    .select('id,snapshot,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data || []).map((row) => ({ ...row.snapshot, id: row.id, updated_at: row.updated_at }))
}
export function summarizeSource(s: ContextSource): SourceSummary {
  return {
    ...s,
    files: s.files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content) })),
  }
}
export async function putSource(
  thread: WorkspaceThread,
  userId: string,
  input: Record<string, unknown>,
) {
  const existing = await sourcesFor(thread.id),
    old = existing.find((s) => s.id === input.source_id)
  if (input.source_id && !old) throw new HttpError(404, 'Source not found in your workspace.')
  const id = old?.id || randomUUID()
  let source: ContextSource
  if (input.kind === 'github' || (input.action === 'refresh' && old?.kind === 'github')) {
    const data = await githubSnapshot(
      userId,
      input.action === 'refresh' ? old?.repository : input.repository,
      input.action === 'refresh' ? old?.branch : input.branch,
      input.action === 'refresh' ? old?.paths : input.paths,
      input.action === 'refresh' ? undefined : input.commit,
    )
    source = {
      id,
      kind: 'github',
      label: data.repository,
      repository: data.repository,
      branch: data.branch,
      commit: data.commit,
      paths: data.paths,
      files: data.files,
      updated_at: new Date().toISOString(),
      fingerprint: '',
    }
  } else {
    if (
      input.kind !== 'folder' ||
      typeof input.label !== 'string' ||
      !input.label.trim() ||
      input.label.length > 120
    )
      throw new HttpError(400, 'Choose a folder name and supported source files.')
    if (old && old.kind !== 'folder') throw new HttpError(400, 'This source is not a local folder.')
    try {
      source = {
        id,
        kind: 'folder',
        label: input.label.trim(),
        files: validateContextFiles(input.files),
        updated_at: new Date().toISOString(),
        fingerprint: '',
      }
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : 'Invalid files.')
    }
  }
  source.fingerprint = createHash('sha256')
    .update(JSON.stringify([...source.files].sort((a, b) => a.path.localeCompare(b.path))))
    .digest('hex')
  const { error } = await createServiceClient().rpc('put_artifact_source', {
    p_workspace: thread.id,
    p_user: userId,
    p_source: id,
    p_snapshot: source,
  })
  if (error) {
    if (error.message.includes('SOURCE_LIMIT'))
      throw new HttpError(
        400,
        'Up to six sources can be attached. Remove one before adding another.',
      )
    throw error
  }
  const oldFiles = new Map(old?.files.map((f) => [f.path, f.content]) || []),
    newFiles = new Map(source.files.map((f) => [f.path, f.content]))
  return {
    source: summarizeSource(source),
    changes: {
      added: source.files.filter((f) => !oldFiles.has(f.path)).length,
      changed: source.files.filter(
        (f) => oldFiles.has(f.path) && oldFiles.get(f.path) !== f.content,
      ).length,
      removed: [...oldFiles.keys()].filter((p) => !newFiles.has(p)).length,
    },
  }
}
export function busy(thread: WorkspaceThread) {
  return !!thread.request_id && Date.parse(thread.lease_until || '') > Date.now()
}
export async function claimGeneration(thread: WorkspaceThread, prompt: string) {
  if (busy(thread))
    throw new HttpError(
      409,
      'A draft is already being generated. Wait for it to finish or for the request to expire.',
    )
  const requestId = randomUUID(),
    messages: WorkspaceMessage[] = [
      ...thread.messages.slice(-38),
      { role: 'user', content: prompt, created_at: new Date().toISOString() },
    ]
  const { data, error } = await createServiceClient()
    .from('artifact_workspaces')
    .update({
      revision: thread.revision + 1,
      request_id: requestId,
      lease_until: new Date(Date.now() + 180000).toISOString(),
      messages,
    })
    .eq('id', thread.id)
    .eq('revision', thread.revision)
    .select('*')
    .maybeSingle()
  if (error) throw error
  if (!data)
    throw new HttpError(409, 'The conversation changed in another tab. Reload it before sending.')
  return { ...data, request_id: requestId } as WorkspaceThread
}
export async function completeGeneration(
  thread: WorkspaceThread,
  draft: WorkspaceDraft | null,
  message: string,
) {
  const payload: Record<string, unknown> = {
    request_id: null,
    lease_until: null,
    revision: thread.revision + 1,
    messages: [
      ...thread.messages.slice(-39),
      {
        role: 'assistant',
        content: message,
        created_at: new Date().toISOString(),
        ...(draft ? { references: draft.references } : {}),
      },
    ],
  }
  if (draft) payload.draft = draft
  const { data, error } = await createServiceClient()
    .from('artifact_workspaces')
    .update(payload)
    .eq('id', thread.id)
    .eq('request_id', thread.request_id)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data)
    throw new HttpError(
      409,
      'This generation was replaced by a newer request. Reload the workspace.',
    )
}
export async function discardDraft(thread: WorkspaceThread) {
  if (busy(thread))
    throw new HttpError(409, 'Wait until generation finishes before discarding the draft.')
  const { data, error } = await createServiceClient()
    .from('artifact_workspaces')
    .update({ draft: null, revision: thread.revision + 1 })
    .eq('id', thread.id)
    .eq('revision', thread.revision)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(409, 'Conversation changed. Reload before discarding.')
}
