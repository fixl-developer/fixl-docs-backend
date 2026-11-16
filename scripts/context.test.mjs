import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import loader from './load-ts.cjs'
const policy = loader.load('lib/context-policy.ts')
const { retrieveContext } = loader.load('lib/context-retrieval.ts')
const http = {
  HttpError: class extends Error {
    constructor(status, message) {
      super(message)
      this.status = status
    }
  },
}

test('source policy rejects secret paths, traversal, generated trees, duplicate and oversized files', () => {
  for (const path of [
    '../secrets.ts',
    '/src/app.ts',
    'C:\\app.ts',
    'src/../x.ts',
    '.env.example',
    'nested/.env',
    'nested/node_modules/index.js',
    '.aws/config.json',
    'credentials.json',
    'private-key.pem',
    'package-lock.json',
    'image.png',
  ])
    assert.ok(policy.sourcePathError(path), path)
  for (const path of ['src/app.tsx', 'docs/api.md', 'package.json', 'schema.prisma', 'Dockerfile'])
    assert.equal(policy.sourcePathError(path), null, path)
  assert.throws(
    () =>
      policy.validateContextFiles([
        { path: 'a.ts', content: 'x' },
        { path: 'a.ts', content: 'y' },
      ]),
    /Duplicate/,
  )
  assert.throws(
    () => policy.validateContextFiles([{ path: 'a.ts', content: 'x'.repeat(96001) }]),
    /96 KB/,
  )
  assert.throws(
    () => policy.validateContextFiles([{ path: 'a.ts', content: 'ghp_' + 'a'.repeat(30) }]),
    /credential/,
  )
  assert.throws(() => policy.validateContextFiles([{ path: 'a.ts', content: 'a\0b' }]), /binary/)
})
test('retrieval ranks requested code, stays bounded and names excluded/truncated context', () => {
  const sources = [
    {
      label: 'API',
      commit: 'abc',
      files: [
        { path: 'README.md', content: 'Overview' },
        { path: 'src/payments.ts', content: 'payment processing\n'.repeat(1000) },
        { path: 'src/unrelated.ts', content: 'unrelated' },
      ],
    },
  ]
  const result = retrieveContext(sources, 'update payment processing', 1500)
  assert.equal(result.references[0].path, 'src/payments.ts')
  assert.equal(result.references[0].truncated, true)
  assert.ok(result.omitted > 0)
  assert.ok(result.text.length < 1700)
  assert.equal(result.references[0].commit, 'abc')
})
test('GitHub snapshot uses blobs from one resolved commit and fails closed on incomplete trees or moved branches', async () => {
  const old = globalThis.fetch,
    oldKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY
  process.env.GITHUB_TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32)
  const calls = []
  let truncated = false,
    blobReads = 0
  let tokenCipher = ''
  const github = loader.load('lib/github-context.ts', {
    './workspace-http': http,
    './supabase-server': {
      createServiceClient: () => ({
        from: () => ({
          select() {
            return this
          },
          eq() {
            return this
          },
          maybeSingle: async () => ({ data: { token_ciphertext: tokenCipher, expires_at: null } }),
        }),
      }),
    },
  })
  tokenCipher = github.encrypt('test-github-token')
  globalThis.fetch = async (url, options) => {
    calls.push([url, options])
    if (url.includes('/commits/'))
      return Response.json({ sha: 'a'.repeat(40), commit: { tree: { sha: 'b'.repeat(40) } } })
    if (url.includes('/git/trees/'))
      return Response.json({
        truncated,
        tree: [
          { path: 'src/app.ts', type: 'blob', mode: '100644', size: 10, sha: 'c'.repeat(40) },
          { path: '.env', type: 'blob', mode: '100644', size: 10, sha: 'd'.repeat(40) },
          { path: 'link.ts', type: 'blob', mode: '120000', size: 10, sha: 'e'.repeat(40) },
        ],
      })
    if (url.includes('/git/blobs/')) {
      blobReads++
      return Response.json({
        encoding: 'base64',
        content: Buffer.from('export {}').toString('base64'),
      })
    }
    throw new Error('Unexpected URL ' + url)
  }
  try {
    const snapshot = await github.githubSnapshot(
      'u',
      'https://github.com/team/repo',
      'feature/payment',
      ['src/app.ts'],
      'a'.repeat(40),
    )
    assert.equal(snapshot.commit, 'a'.repeat(40))
    assert.equal(snapshot.files[0].content, 'export {}')
    assert.ok(calls[0][0].includes('feature%2Fpayment'))
    assert.ok(calls.some(([url]) => url.endsWith('/git/blobs/' + 'c'.repeat(40))))
    assert.ok(
      calls.every(
        ([url, options]) =>
          url.startsWith('https://api.github.com/') && options.redirect === 'error',
      ),
    )
    await assert.rejects(
      github.githubSnapshot('u', 'team/repo', 'main', ['src/app.ts'], 'f'.repeat(40)),
      /branch changed/,
    )
    assert.equal(blobReads, 1)
    truncated = true
    await assert.rejects(github.githubTree('u', 'team/repo', 'main'), /incomplete tree/)
    assert.throws(() => github.repositoryName('https://evil.example/team/repo'), /github.com/)
    const encoded = github.encrypt('another')
    assert.equal(github.decrypt(encoded), 'another')
    const parts = encoded.split('.')
    parts[1] = Buffer.alloc(16).toString('base64url')
    assert.throws(() => github.decrypt(parts.join('.')))
  } finally {
    globalThis.fetch = old
    if (oldKey === undefined) delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY
    else process.env.GITHUB_TOKEN_ENCRYPTION_KEY = oldKey
  }
})
test('OAuth completion is bound to the signed-in Fixl user and consumes one-time state before exchanging code', async () => {
  const old = globalThis.fetch,
    env = { ...process.env }
  Object.assign(process.env, {
    GITHUB_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
    GITHUB_CLIENT_ID: 'id',
    GITHUB_CLIENT_SECRET: 'secret',
    FRONTEND_URL: 'https://fixl.example',
  })
  let row = null
  const filters = []
  const github = loader.load('lib/github-context.ts', {
    './workspace-http': http,
    './supabase-server': {
      createServiceClient: () => ({
        from: () => ({
          delete() {
            return this
          },
          eq(k, v) {
            filters.push([k, v])
            return this
          },
          gt() {
            return this
          },
          select() {
            return this
          },
          maybeSingle: async () => ({ data: row }),
        }),
      }),
    },
  })
  globalThis.fetch = () => {
    throw new Error('Must not exchange invalid state')
  }
  try {
    await assert.rejects(
      github.finishGithub('victim', 'code', 'attacker-state'),
      /belongs to another/,
    )
    assert.ok(filters.some(([k, v]) => k === 'user_id' && v === 'victim'))
    assert.ok(
      filters.some(
        ([k, v]) =>
          k === 'state_hash' && v === createHash('sha256').update('attacker-state').digest('hex'),
      ),
    )
  } finally {
    globalThis.fetch = old
    for (const k of [
      'GITHUB_TOKEN_ENCRYPTION_KEY',
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'FRONTEND_URL',
    ])
      if (env[k] === undefined) delete process.env[k]
      else process.env[k] = env[k]
  }
})

test('workspace endpoints reject viewers before any source or conversation read', async () => {
  const realHttp = loader.load('lib/workspace-http.ts', {
    './auth': { getAuthProfile: async () => ({ id: 'viewer' }) },
    './db': { getDocument: async () => ({ id: 'doc' }) },
    './permissions': { documentAccess: async () => ({ read: true, edit: false, delete: false }) },
  })
  const forbidden = () => {
    throw new Error('Private workspace storage must not be reached')
  }
  const route = loader.load('app/api/documents/[id]/workspace/route.ts', {
    '@/lib/workspace-http': realHttp,
    '@/lib/workspace-store': {
      getWorkspace: forbidden,
      sourcesFor: forbidden,
      checkContextLimit: forbidden,
    },
    '@/lib/supabase-server': { createServiceClient: forbidden },
  })
  const req = new Request('https://test.example/api/documents/doc/workspace'),
    context = { params: Promise.resolve({ id: 'doc' }) }
  assert.equal((await route.GET(req, context)).status, 403)
  assert.equal((await route.POST(req, context)).status, 403)
})
test('source replacement is scoped to the personal workspace and summaries omit file contents', async () => {
  const store = loader.load('lib/workspace-store.ts', {
    './workspace-http': http,
    './github-context': {},
    './supabase-server': {
      createServiceClient: () => ({
        from: () => ({
          select() {
            return this
          },
          eq() {
            return this
          },
          order: async () => ({ data: [] }),
        }),
      }),
    },
  })
  await assert.rejects(
    store.putSource({ id: 'mine' }, 'user', {
      source_id: 'someone-else-source',
      kind: 'folder',
      label: 'test',
      files: [{ path: 'x.ts', content: 'a' }],
    }),
    /not found/,
  )
  const summary = store.summarizeSource({
    id: 's',
    files: [{ path: 'x.ts', content: 'private code' }],
  })
  assert.equal(summary.files[0].content, undefined)
  assert.equal(summary.files[0].bytes, 12)
})
