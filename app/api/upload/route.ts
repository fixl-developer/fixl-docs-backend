import { NextRequest, NextResponse } from 'next/server'
import { uploadSnippet } from '@/lib/storage'
import { insertSnippet } from '@/lib/db'
import { generateUniqueSlug } from '@/lib/slugs'
import { validateHtmlSize, validateContentType, hashIp } from '@/lib/validate'
import { uploadLimiter } from '@/lib/ratelimit'
import { artifactSourceError, normalizeArtifactHtml } from '@/lib/artifact-import'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { success } = await uploadLimiter.limit(ip)
  if (!success) {
    return NextResponse.json(
      { error: 'Too many uploads. Try again in an hour.' },
      { status: 429 }
    )
  }

  let html: string
  let title: string | null = null

  const contentType = req.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    title = (formData.get('title') as string | null) || null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!validateContentType(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only HTML files are allowed.' },
        { status: 400 }
      )
    }

    html = await file.text()
  } else {
    const body = await req.json().catch(() => null)
    if (!body?.html || typeof body.html !== 'string') {
      return NextResponse.json({ error: 'No HTML content provided' }, { status: 400 })
    }
    html = body.html
    title = body.title ?? null
  }

  html = normalizeArtifactHtml(html)
  const sourceError = artifactSourceError(html)
  if (sourceError) {
    return NextResponse.json({ error: sourceError }, { status: 400 })
  }
  if (!html.trim()) {
    return NextResponse.json({ error: 'No HTML content provided' }, { status: 400 })
  }
  const sizeCheck = validateHtmlSize(html)
  if (!sizeCheck.valid) {
    return NextResponse.json({ error: sizeCheck.error }, { status: 400 })
  }

  const slug = await generateUniqueSlug()
  const storageKey = `snippets/${slug}.html`
  const fileSize = Buffer.byteLength(html, 'utf-8')
  const ipHash = hashIp(ip)

  await uploadSnippet(slug, html)
  await insertSnippet(slug, storageKey, fileSize, ipHash, title)

  const appUrl = process.env.FRONTEND_URL ?? ''
  return NextResponse.json({ slug, url: `${appUrl}/view/${slug}` }, { status: 201 })
}
