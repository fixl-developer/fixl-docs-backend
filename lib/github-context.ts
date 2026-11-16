import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createServiceClient } from './supabase-server'
import { HttpError } from './workspace-http'
import { sourcePathError, validateContextFiles, CONTEXT_LIMITS } from './context-policy'
import type { ContextFile } from '@/types/workspace'
function key() {
  const value = process.env.GITHUB_TOKEN_ENCRYPTION_KEY || ''
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new HttpError(
      503,
      'GitHub connection is not configured. Ask your administrator to configure the GitHub App and encryption key.',
    )
  return Buffer.from(value, 'hex')
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv)
  const text = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), text].map((b) => b.toString('base64url')).join('.')
}
export function decrypt(value: string) {
  const [iv, tag, text] = value.split('.').map((s) => Buffer.from(s, 'base64url'))
  const cipher = createDecipheriv('aes-256-gcm', key(), iv)
  cipher.setAuthTag(tag)
  return Buffer.concat([cipher.update(text), cipher.final()]).toString('utf8')
}
function config() {
  key()
  if (
    !process.env.GITHUB_CLIENT_ID ||
    !process.env.GITHUB_CLIENT_SECRET ||
    !process.env.FRONTEND_URL
  )
    throw new HttpError(503, 'GitHub App is not configured for this workspace.')
  const base = new URL(process.env.FRONTEND_URL)
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname))
    throw new HttpError(503, 'GitHub callback requires HTTPS.')
  return {
    client: process.env.GITHUB_CLIENT_ID,
    secret: process.env.GITHUB_CLIENT_SECRET,
    callback: base.origin + '/integrations/github/callback',
  }
}
async function jsonResponse(response: Response, max = 7000000) {
  if (!response.ok) {
    await response.body?.cancel()
    throw new HttpError(
      response.status === 401
        ? 409
        : response.status === 404
          ? 404
          : response.status === 403 || response.status === 429
            ? 429
            : 502,
      response.status === 401
        ? 'GitHub authorization expired. Reconnect GitHub.'
        : response.status === 404
          ? 'Repository or branch is unavailable to this GitHub connection.'
          : response.status === 403 || response.status === 429
            ? 'GitHub refused this request or its rate limit was reached. Check App access and try again later.'
            : 'GitHub is temporarily unavailable.',
    )
  }
  const reader = response.body?.getReader()
  if (!reader) throw new HttpError(502, 'Empty GitHub response.')
  let size = 0,
    text = ''
  const decoder = new TextDecoder()
  try {
    while (true) {
      const r = await reader.read()
      if (r.done) break
      size += r.value.byteLength
      if (size > max)
        throw new HttpError(413, 'This repository is too large to browse in one snapshot.')
      text += decoder.decode(r.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
async function connection(userId: string) {
  const { data, error } = await createServiceClient()
    .from('github_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}
export async function githubStatus(userId: string) {
  const row = await connection(userId)
  let configured = true
  try {
    config()
  } catch {
    configured = false
  }
  return {
    configured,
    connected: !!row && (!row.expires_at || Date.parse(row.expires_at) > Date.now()),
    login: row?.login || null,
    expires_at: row?.expires_at || null,
  }
}
async function tokenFor(userId: string) {
  const row = await connection(userId)
  if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now()))
    throw new HttpError(409, 'Connect or reconnect GitHub before selecting a repository.')
  return decrypt(row.token_ciphertext)
}
export function repositoryName(input: unknown) {
  if (typeof input !== 'string')
    throw new HttpError(400, 'Enter a GitHub repository URL or owner/repository.')
  const value = input
    .trim()
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
  if (
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(value) ||
    value.split('/').some((s) => s === '.' || s === '..')
  )
    throw new HttpError(400, 'Use github.com/owner/repository without a file path.')
  return value
}
function branchName(input: unknown) {
  if (typeof input !== 'string' || !input.trim() || input.length > 200 || /[\x00-\x1f]/.test(input))
    throw new HttpError(400, 'Enter a branch name.')
  return input.trim()
}
async function github(userId: string, path: string) {
  const token = await tokenFor(userId)
  return jsonResponse(
    await fetch('https://api.github.com' + path, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    }),
  )
}
export async function beginGithub(userId: string, documentId?: string) {
  const c = config(),
    state = randomBytes(32).toString('base64url'),
    verifier = randomBytes(32).toString('base64url'),
    db = createServiceClient()
  await db.from('github_oauth_states').delete().eq('user_id', userId)
  const { error } = await db.from('github_oauth_states').insert({
    state_hash: createHash('sha256').update(state).digest('hex'),
    user_id: userId,
    verifier_ciphertext: encrypt(verifier),
    document_id: documentId || null,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  })
  if (error) throw error
  const url = new URL('https://github.com/login/oauth/authorize')
  url.search = new URLSearchParams({
    client_id: c.client,
    redirect_uri: c.callback,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    allow_signup: 'false',
  }).toString()
  return { url: url.href }
}
export async function finishGithub(userId: string, code: unknown, state: unknown) {
  const c = config()
  if (
    typeof code !== 'string' ||
    code.length > 300 ||
    typeof state !== 'string' ||
    state.length > 100
  )
    throw new HttpError(400, 'Invalid GitHub callback.')
  const db = createServiceClient()
  const { data: attempt, error } = await db
    .from('github_oauth_states')
    .delete()
    .eq('state_hash', createHash('sha256').update(state).digest('hex'))
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()
  if (error) throw error
  if (!attempt)
    throw new HttpError(
      400,
      'Connection request expired or belongs to another account. Start again.',
    )
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.client,
      client_secret: c.secret,
      redirect_uri: c.callback,
      code,
      code_verifier: decrypt(attempt.verifier_ciphertext),
    }),
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  })
  const data = await jsonResponse(response, 20000)
  if (typeof data.access_token !== 'string' || data.error)
    throw new HttpError(400, 'GitHub did not authorize the connection. Start again.')
  const identity = await jsonResponse(
    await fetch('https://api.github.com/user', {
      headers: {
        Authorization: 'Bearer ' + data.access_token,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    }),
    50000,
  )
  const { error: saveError } = await db.from('github_connections').upsert({
    user_id: userId,
    login: identity.login,
    token_ciphertext: encrypt(data.access_token),
    expires_at:
      typeof data.expires_in === 'number'
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null,
    updated_at: new Date().toISOString(),
  })
  if (saveError) throw saveError
  return { login: identity.login, document_id: attempt.document_id }
}
export async function disconnectGithub(userId: string) {
  const { error } = await createServiceClient()
    .from('github_connections')
    .delete()
    .eq('user_id', userId)
  if (error) throw error
}
export async function githubBranches(userId: string, input: unknown, page = 1) {
  const repo = repositoryName(input)
  const data = await github(
    userId,
    `/repos/${repo}/branches?per_page=100&page=${Math.max(1, Math.min(50, page))}`,
  )
  return { branches: data.map((b: { name: string }) => b.name), more: data.length === 100 }
}
export async function githubTree(userId: string, input: unknown, branchInput: unknown) {
  const repository = repositoryName(input),
    branch = branchName(branchInput)
  const commit = await github(userId, `/repos/${repository}/commits/${encodeURIComponent(branch)}`)
  const tree = await github(
    userId,
    `/repos/${repository}/git/trees/${commit.commit.tree.sha}?recursive=1`,
  )
  if (tree.truncated)
    throw new HttpError(
      413,
      'GitHub returned an incomplete tree. Use a scoped local-folder snapshot for this repository.',
    )
  const files = (
    tree.tree as { path: string; type: string; mode: string; size: number; sha: string }[]
  ).filter(
    (f) =>
      f.type === 'blob' &&
      ['100644', '100755'].includes(f.mode) &&
      !sourcePathError(f.path) &&
      f.size <= CONTEXT_LIMITS.fileBytes,
  )
  return {
    repository,
    branch,
    commit: commit.sha,
    files,
    excluded: tree.tree.length - files.length,
  }
}
export async function githubSnapshot(
  userId: string,
  input: unknown,
  branchInput: unknown,
  pathsInput: unknown,
  expectedCommit?: unknown,
) {
  if (
    !Array.isArray(pathsInput) ||
    !pathsInput.length ||
    pathsInput.length > CONTEXT_LIMITS.files ||
    pathsInput.some((p) => typeof p !== 'string' || sourcePathError(p))
  )
    throw new HttpError(400, 'Select up to 100 supported files.')
  const tree = await githubTree(userId, input, branchInput)
  if (expectedCommit && tree.commit !== expectedCommit)
    throw new HttpError(
      409,
      'The branch changed while you selected files. Reload its files before attaching.',
    )
  const selected = tree.files.filter((f) => pathsInput.includes(f.path))
  if (selected.length !== new Set(pathsInput).size)
    throw new HttpError(
      409,
      'A selected file is missing or no longer supported. Reload the branch files.',
    )
  if (selected.reduce((n, f) => n + f.size, 0) > CONTEXT_LIMITS.snapshotBytes)
    throw new HttpError(413, 'Selected files exceed 1 MB. Choose fewer files.')
  const files: ContextFile[] = []
  // Bound concurrency and use blob SHAs from one commit, never a moving raw branch URL.
  const deadline = Date.now() + 70000
  for (let i = 0; i < selected.length; i += 5) {
    if (Date.now() > deadline)
      throw new HttpError(
        504,
        'Fetching this snapshot took too long. Choose fewer files and retry.',
      )
    const batch = await Promise.all(
      selected.slice(i, i + 5).map(async (file) => {
        const blob = await github(userId, `/repos/${tree.repository}/git/blobs/${file.sha}`)
        if (blob.encoding !== 'base64')
          throw new HttpError(422, 'Unsupported GitHub content encoding.')
        const bytes = Buffer.from(blob.content, 'base64')
        let content: string
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          throw new HttpError(422, file.path + ': not a UTF-8 text file.')
        }
        return { path: file.path, content }
      }),
    )
    files.push(...batch)
  }
  try {
    return { ...tree, files: validateContextFiles(files), paths: selected.map((f) => f.path) }
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : 'Invalid source files.')
  }
}
