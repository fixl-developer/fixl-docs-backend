import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import {
  getConnectedProject,
  getProjectFiles,
  upsertProjectFiles,
  deleteRemovedProjectFiles,
  updateConnectedProjectAfterSync,
  getDocument,
  createDocument,
  createProject,
  insertVersion,
  updateDocumentCurrentVersion,
  getNextVersionNumber,
} from '@/lib/db'
import { uploadObject, fetchObject } from '@/lib/storage'
import type { SyncBody, SyncFile } from '@/types/platform'

interface Params { params: Promise<{ id: string }> }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CODE_DOC_SYSTEM = `You are a senior software documentation engineer.
Your job is to produce a comprehensive, clean, self-contained HTML documentation page for a codebase.

Rules:
- Return ONLY valid HTML. No markdown, no code fences, no explanations outside the HTML.
- The HTML must be complete (<html>, <head>, <body>).
- Use inline CSS only — no external stylesheets or CDN links.
- Style it professionally: readable typography, syntax-highlighted code blocks (use <pre><code> with background),
  a table of contents sidebar or top nav, section headers, and a footer.
- Include: project overview, file tree, key modules/files described, important functions/classes,
  data flow, configuration notes, and any README content found.
- When updating existing docs, preserve unchanged sections and surgically update only sections
  affected by the changed files.`

function jsonEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function buildFileTree(files: SyncFile[]): string {
  const paths = files.map(f => f.path).sort()
  return paths.map(p => `  ${p}`).join('\n')
}

function truncateForContext(content: string, maxChars = 4000): string {
  if (content.length <= maxChars) return content
  return content.slice(0, maxChars) + `\n... [truncated, ${content.length - maxChars} more chars]`
}

function buildFilesBlock(files: SyncFile[], maxTotalChars = 80_000): string {
  const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.rb',
    '.php', '.swift', '.kt', '.c', '.cpp', '.h', '.json', '.yaml', '.yml', '.toml', '.env.example',
    '.md', '.txt', '.sql', '.sh', '.bash', '.dockerfile', 'Dockerfile'])
  const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache',
    'coverage', 'vendor', '.venv', 'venv'])

  const relevant = files.filter(f => {
    const parts = f.path.split('/')
    if (parts.some(p => IGNORE.has(p))) return false
    const ext = f.path.includes('.') ? '.' + f.path.split('.').pop()!.toLowerCase() : ''
    const base = parts[parts.length - 1]
    return EXTS.has(ext) || EXTS.has(base)
  })

  let total = 0
  const blocks: string[] = []

  // Priority: README, config files, then source files ordered by size (smallest first = more files)
  const priority = (f: SyncFile) => {
    const name = f.path.split('/').pop()!.toLowerCase()
    if (name.startsWith('readme')) return 0
    if (['.json', '.yaml', '.yml', '.toml', 'Dockerfile', '.sh'].some(e => f.path.endsWith(e))) return 1
    return 2
  }

  const sorted = [...relevant].sort((a, b) => priority(a) - priority(b) || a.size - b.size)

  for (const f of sorted) {
    const block = `\n--- FILE: ${f.path} ---\n${truncateForContext(f.content)}\n`
    if (total + block.length > maxTotalChars) break
    blocks.push(block)
    total += block.length
  }

  return blocks.join('')
}

function slugify(name: string): string {
  return 'code-docs-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + '-' + Math.random().toString(36).slice(2, 7)
}

export async function POST(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { id } = await params
  const cp = await getConnectedProject(id)
  if (!cp) {
    return new Response(JSON.stringify({ error: 'Connected project not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (profile!.role === 'employee' && cp.created_by !== profile!.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body: SyncBody = await req.json().catch(() => ({ files: [] }))
  const files: SyncFile[] = body.files ?? []
  const userPrompt = body.prompt?.trim() ?? ''

  if (!files.length) {
    return new Response(JSON.stringify({ error: 'No files provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(jsonEvent(data))

      try {
        // ── 1. Diff against stored file hashes ────────────────────────────────
        const storedFiles = await getProjectFiles(id)
        const storedMap = new Map(storedFiles.map(f => [f.file_path, f.content_hash]))

        const newHashes = new Map(files.map(f => [f.path, hashContent(f.content)]))
        const changedFiles = files.filter(f => storedMap.get(f.path) !== newHashes.get(f.path))
        const isFirstSync = storedFiles.length === 0

        send({
          type: 'start',
          total: files.length,
          changed: changedFiles.length,
          firstSync: isFirstSync,
        })

        if (!isFirstSync && changedFiles.length === 0) {
          send({ type: 'done', message: 'No changes detected — docs are up to date.', documentId: cp.document_id })
          controller.close()
          return
        }

        // ── 2. Fetch existing docs HTML (for update mode) ─────────────────────
        let existingHtml: string | null = null
        if (!isFirstSync && cp.document_id) {
          const doc = await getDocument(cp.document_id)
          if (doc?.current_version) {
            const key = `documents/${cp.document_id}/v${doc.current_version.version_number}.html`
            existingHtml = await fetchObject(key).catch(() => null)
          }
        }

        // ── 3. Build Claude prompt ─────────────────────────────────────────────
        send({ type: 'progress', message: `Preparing ${isFirstSync ? files.length : changedFiles.length} files for Claude…` })

        const fileTree = buildFileTree(files)
        const filesToDocument = isFirstSync ? files : changedFiles
        const filesBlock = buildFilesBlock(filesToDocument)

        let userMessage: string

        const focusNote = userPrompt ? `\n\nUser's focus instructions: ${userPrompt}` : ''

        if (existingHtml) {
          userMessage = `You are UPDATING existing documentation for the project "${cp.name}".

Changed files (${changedFiles.length} of ${files.length} total):
${fileTree}

Here is the content of the changed/new files:
${filesBlock}

Here is the EXISTING documentation HTML to update:
${truncateForContext(existingHtml, 30_000)}

Update the documentation to reflect the changes in the files above. Keep all unchanged sections intact.
Only modify sections that relate to the changed files. Maintain the same visual style.${focusNote}`
        } else {
          userMessage = `Generate comprehensive documentation for the project "${cp.name}".

Full file tree (${files.length} files):
${fileTree}

File contents:
${filesBlock}

Generate a complete, professional HTML documentation page covering: project overview, architecture,
file structure, key modules, important functions/classes, configuration, and how to get started.${focusNote}`
        }

        // ── 4. Stream Claude response ─────────────────────────────────────────
        send({ type: 'progress', message: 'Claude is generating documentation…' })

        let accumulated = ''

        const claudeStream = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: CODE_DOC_SYSTEM,
          messages: [{ role: 'user', content: userMessage }],
          stream: true,
        })

        for await (const event of claudeStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            accumulated += event.delta.text
            send({ type: 'chunk', content: event.delta.text })
          }
        }

        const rawHtml = accumulated
          .replace(/^```html\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/, '')
          .trim()

        if (!rawHtml) {
          send({ type: 'error', message: 'Claude returned empty response' })
          controller.close()
          return
        }

        // ── 5. Save Document + Version ─────────────────────────────────────────
        send({ type: 'progress', message: 'Saving documentation…' })

        let documentId = cp.document_id
        let projectId = cp.project_id

        if (!documentId) {
          // Auto-create a project if none is linked
          if (!projectId) {
            const autoProject = await createProject(
              `${cp.name}`,
              'Auto-created for code documentation',
              profile!.id
            )
            projectId = autoProject.id
          }
          const slug = slugify(cp.name)
          const newDoc = await createDocument(
            `${cp.name} — Code Docs`,
            projectId,
            profile!.id,
            slug,
            false
          )
          documentId = newDoc.id
        }

        const versionNumber = await getNextVersionNumber(documentId)
        const storageKey = `documents/${documentId}/v${versionNumber}.html`
        const fileSize = Buffer.byteLength(rawHtml, 'utf-8')

        await uploadObject(storageKey, rawHtml)

        const version = await insertVersion(
          documentId,
          versionNumber,
          storageKey,
          fileSize,
          profile!.id,
          isFirstSync ? `Initial docs — ${files.length} files` : `Updated docs — ${changedFiles.length} file(s) changed`,
          null
        )

        await updateDocumentCurrentVersion(documentId, version.id)

        // ── 6. Update project_files + connected_project ───────────────────────
        await upsertProjectFiles(id, files.map(f => ({
          path: f.path,
          hash: newHashes.get(f.path)!,
          size: f.size,
        })))

        await deleteRemovedProjectFiles(id, files.map(f => f.path))

        await updateConnectedProjectAfterSync(id, documentId, files.length, projectId ?? undefined)

        send({
          type: 'done',
          documentId,
          html: rawHtml,
          versionNumber,
          changed: changedFiles.length,
          total: files.length,
        })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}
