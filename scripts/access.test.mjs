import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import loader from './load-ts.cjs'
const require = createRequire(import.meta.url)
const { NextRequest } = require('next/server')
const profile = { id: 'employee-a', role: 'employee', can_view_all_docs: false }
const doc = {
  id: 'doc-b',
  project_id: 'project-b',
  created_by: 'employee-b',
  current_version_id: 'v1',
  current_version: { storage_key: 'private.html' },
}
function serviceFor(role, error = null) {
  return {
    createServiceClient: () => ({
      from: () => ({
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle: async () => ({ data: role ? { role } : null, error }),
      }),
    }),
  }
}
function request(path, method = 'GET', body) {
  return new NextRequest('https://test.example' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

test('document permissions distinguish viewer, editor, owner, creator and workspace leads', async () => {
  for (const [role, expected] of [
    [null, [false, false, false]],
    ['viewer', [true, false, false]],
    ['editor', [true, true, false]],
    ['owner', [true, true, false]],
  ]) {
    const { documentAccess } = loader.load('lib/permissions.ts', {
      './supabase-server': serviceFor(role),
    })
    const access = await documentAccess(profile, doc)
    assert.deepEqual([access.read, access.edit, access.delete], expected)
  }
  const permissions = loader.load('lib/permissions.ts', { './supabase-server': serviceFor(null) })
  for (const elevated of [
    { ...profile, role: 'manager' },
    { ...profile, role: 'founder' },
    { ...profile, id: doc.created_by },
  ]) {
    assert.deepEqual(await permissions.documentAccess(elevated, doc), {
      read: true,
      edit: true,
      delete: true,
    })
  }
  assert.deepEqual(await permissions.documentAccess({ ...profile, can_view_all_docs: true }, doc), {
    read: true,
    edit: false,
    delete: false,
  })
  const failed = loader.load('lib/permissions.ts', {
    './supabase-server': serviceFor(null, { message: 'offline' }),
  })
  await assert.rejects(failed.documentAccess(profile, doc), /verify project access/)
})
test('an unrelated employee cannot read HTML, mutate visibility, save versions, or add project members', async () => {
  const permissions = loader.load('lib/permissions.ts', { './supabase-server': serviceFor(null) })
  const noWrite = () => {
    throw new Error('Protected side effect must not run')
  }
  const mocks = {
    '@/lib/auth': { getAuthProfile: async () => profile, requireAuth: () => null },
    '@/lib/permissions': permissions,
    '@/lib/db': {
      getDocument: async () => doc,
      getProject: async () => ({ id: doc.project_id }),
      updateDocument: noWrite,
      getVersion: noWrite,
      listVersions: noWrite,
      addProjectMember: noWrite,
    },
    '@/lib/storage': { fetchObject: noWrite },
    '@/lib/save-version': { saveVersion: noWrite },
    '@/lib/supabase-server': { createServiceClient: noWrite },
  }
  const params = { params: Promise.resolve({ id: doc.id }) }
  const detail = loader.load('app/api/documents/[id]/route.ts', mocks)
  assert.equal((await detail.GET(request('/document'), params)).status, 404)
  assert.equal(
    (await detail.PATCH(request('/document', 'PATCH', { is_public: true }), params)).status,
    403,
  )
  assert.equal((await detail.DELETE(request('/document', 'DELETE'), params)).status, 403)
  const versions = loader.load('app/api/documents/[id]/versions/route.ts', mocks)
  assert.equal((await versions.GET(request('/versions'), params)).status, 404)
  assert.equal(
    (await versions.POST(request('/versions', 'POST', { html: '<html>changed</html>' }), params))
      .status,
    403,
  )
  const html = loader.load('app/api/documents/[id]/versions/[versionId]/route.ts', mocks)
  assert.equal(
    (
      await html.GET(request('/version?html=1'), {
        params: Promise.resolve({ id: doc.id, versionId: 'v1' }),
      })
    ).status,
    404,
  )
  const members = loader.load('app/api/projects/[id]/members/route.ts', mocks)
  assert.equal(
    (
      await members.POST(request('/members', 'POST', { user_id: profile.id, role: 'owner' }), {
        params: Promise.resolve({ id: doc.project_id }),
      })
    ).status,
    403,
  )
})
test('public artifact revocation blocks both metadata and HTML without fetching storage', async () => {
  let isPublic = true,
    storageReads = 0
  const publicRoute = loader.load('app/api/public/artifacts/[slug]/route.ts', {
    '@/lib/db': {
      getDocumentBySlug: async () => ({ ...doc, is_public: isPublic, title: 'Report' }),
      getSnippetBySlug: async () => null,
    },
    '@/lib/storage': {
      fetchObject: async () => {
        storageReads++
        return '<html>saved</html>'
      },
    },
  })
  const params = { params: Promise.resolve({ slug: 'public-report' }) }
  const metadata = await publicRoute.GET(request('/public'), params)
  assert.equal(metadata.status, 200)
  assert.equal((await metadata.json()).storage_key, undefined)
  const html = await publicRoute.GET(request('/public?html=1'), params)
  assert.equal(await html.text(), '<html>saved</html>')
  assert.equal(html.headers.get('Cache-Control'), 'no-store')
  assert.match(html.headers.get('Content-Type'), /text\/plain/)
  isPublic = false
  assert.equal((await publicRoute.GET(request('/public'), params)).status, 404)
  assert.equal((await publicRoute.GET(request('/public?html=1'), params)).status, 404)
  assert.equal(storageReads, 1)
})
test('retired URL import cannot make server-side network requests', async () => {
  const route = loader.load('app/api/fetch-url/route.ts')
  const response = await route.POST(request('/api/fetch-url', 'POST', { url: 'http://[::1]/' }))
  assert.equal(response.status, 410)
  assert.equal((await response.json()).code, 'STANDALONE_HTML_REQUIRED')
})
