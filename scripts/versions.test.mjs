import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import loader from './load-ts.cjs'

test('migration saves complete versions atomically and rejects stale callers', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table documents(id uuid primary key, current_version_id uuid, updated_at timestamptz);
      create table document_versions(id uuid primary key default gen_random_uuid(), document_id uuid references documents(id), version_number integer, storage_key text unique, file_size integer, created_by uuid, prompt_used text, change_note text);
      insert into documents(id) values ('00000000-0000-0000-0000-000000000001');
    `)
    await db.exec(
      await readFile(
        new URL(
          '../supabase/migrations/202611140001_atomic_artifact_versions.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const documentId = '00000000-0000-0000-0000-000000000001'
    const creatorId = '00000000-0000-0000-0000-000000000002'
    const save = (key, previous) =>
      db.query('select * from save_artifact_version($1,$2,100,$3,null,null,$4)', [
        documentId,
        key,
        creatorId,
        previous,
      ])
    const first = (await save('first.html', null)).rows[0]
    assert.equal(first.version_number, 1)
    const results = await Promise.allSettled([
      save('second.html', first.id),
      save('stale.html', first.id),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.match(results.find((r) => r.status === 'rejected').reason.message, /VERSION_CONFLICT/)
    const rows = (await db.query('select * from document_versions order by version_number')).rows
    assert.equal(rows.length, 2)
    assert.deepEqual(
      rows.map((r) => r.version_number),
      [1, 2],
    )
    assert.equal(
      (await db.query('select current_version_id from documents')).rows[0].current_version_id,
      rows[1].id,
    )
    // A failed insert must roll back the pointer update and version allocation.
    await assert.rejects(save('first.html', rows[1].id), /duplicate key/)
    assert.equal((await db.query('select count(*)::int as n from document_versions')).rows[0].n, 2)
    assert.equal(
      (await db.query('select current_version_id from documents')).rows[0].current_version_id,
      rows[1].id,
    )
    const grants = (
      await db.query(
        "select has_function_privilege('anon','save_artifact_version(uuid,text,integer,uuid,text,text,uuid)','execute') as anon, has_function_privilege('service_role','save_artifact_version(uuid,text,integer,uuid,text,text,uuid)','execute') as service",
      )
    ).rows[0]
    assert.deepEqual(grants, { anon: false, service: true })
  } finally {
    await db.close()
  }
})
test('object keys are immutable and an ambiguous RPC failure never deletes a possibly committed object', async () => {
  const uploaded = [],
    rpc = []
  let failure = null
  const { saveVersion } = loader.load('lib/save-version.ts', {
    './storage': { uploadObject: async (key, html) => uploaded.push({ key, html }) },
    './supabase-server': {
      createServiceClient: () => ({
        rpc: async (name, input) => {
          rpc.push({ name, input })
          return { data: { id: 'saved' }, error: failure }
        },
      }),
    },
  })
  const input = {
    documentId: 'doc',
    html: '<html>one</html>',
    createdBy: 'user',
    expectedVersionId: null,
  }
  await saveVersion(input)
  failure = { message: 'Network lost after possible commit' }
  await assert.rejects(saveVersion(input), /finalize/)
  assert.notEqual(uploaded[0].key, uploaded[1].key)
  assert.equal(rpc[0].input.p_expected_version_id, null)
  failure = { message: 'VERSION_CONFLICT' }
  await assert.rejects(saveVersion(input), /VERSION_CONFLICT/)
})

test('workspace apply is atomic, preserves history and rejects stale or repeated draft IDs', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
   create table profiles(id uuid primary key);
   create table documents(id uuid primary key,current_version_id uuid,updated_at timestamptz);
   create table document_versions(id uuid primary key default gen_random_uuid(),document_id uuid references documents(id),version_number integer,storage_key text unique,file_size integer,created_by uuid,prompt_used text,change_note text);
   insert into profiles values('00000000-0000-0000-0000-000000000002');
   insert into documents(id) values('00000000-0000-0000-0000-000000000001');`)
    await db.exec(
      await readFile(
        new URL(
          '../supabase/migrations/202611140001_atomic_artifact_versions.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    await db.exec(
      await readFile(
        new URL(
          '../supabase/migrations/202611160001_artifact_context_workspace.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const user = '00000000-0000-0000-0000-000000000002',
      document = '00000000-0000-0000-0000-000000000001',
      draftId = '00000000-0000-0000-0000-000000000003'
    const draft = {
      id: draftId,
      base_version_id: null,
      prompt: 'Update',
      references: [],
      html: '<html><body>draft</body></html>',
    }
    const workspace = (
      await db.query(
        'insert into artifact_workspaces(document_id,user_id,draft) values($1,$2,$3) returning id',
        [document, user, JSON.stringify(draft)],
      )
    ).rows[0].id
    const apply = () =>
      db.query('select * from apply_artifact_workspace_draft($1,$2,$3,$4,30)', [
        workspace,
        user,
        draftId,
        'unique.html',
      ])
    const saved = (await apply()).rows[0]
    assert.equal(saved.version_number, 1)
    const thread = (await db.query('select * from artifact_workspaces')).rows[0]
    assert.equal(thread.draft, null)
    assert.match(thread.messages[0].content, /Applied as version 1/)
    await assert.rejects(apply(), /DRAFT_CHANGED/)
    await db.query('update artifact_workspaces set draft=$1', [JSON.stringify(draft)])
    await assert.rejects(
      db.query('select * from apply_artifact_workspace_draft($1,$2,$3,$4,30)', [
        workspace,
        user,
        draftId,
        'next.html',
      ]),
      /VERSION_CONFLICT/,
    )
    assert.equal((await db.query('select count(*)::int as n from document_versions')).rows[0].n, 1)
    assert.equal(
      (await db.query('select draft from artifact_workspaces')).rows[0].draft.id,
      draftId,
    )
    for (let i = 0; i < 6; i++)
      await db.query('select put_artifact_source($1,$2,$3,$4)', [
        workspace,
        user,
        `00000000-0000-0000-0000-00000000001${i}`,
        JSON.stringify({ files: [] }),
      ])
    await assert.rejects(
      db.query('select put_artifact_source($1,$2,$3,$4)', [
        workspace,
        user,
        '00000000-0000-0000-0000-000000000019',
        '{}',
      ]),
      /SOURCE_LIMIT/,
    )
    const rights = (
      await db.query(
        "select has_table_privilege('authenticated','github_connections','select') as tokens,has_table_privilege('anon','artifact_context_sources','select') as sources",
      )
    ).rows[0]
    assert.deepEqual(rights, { tokens: false, sources: false })
  } finally {
    await db.close()
  }
})
