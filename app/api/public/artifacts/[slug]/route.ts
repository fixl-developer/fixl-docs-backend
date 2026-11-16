import { NextRequest, NextResponse } from 'next/server'
import { getDocumentBySlug, getSnippetBySlug } from '@/lib/db'
import { fetchObject, fetchSnippet } from '@/lib/storage'
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!/^[A-Za-z0-9_-]{5,80}$/.test(slug))
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  try {
    const doc = await getDocumentBySlug(slug)
    if (doc) {
      if (!doc.is_public || !doc.current_version)
        return NextResponse.json(
          { error: 'This artifact is not publicly available.' },
          { status: 404, headers },
        )
      if (req.nextUrl.searchParams.get('html') === '1')
        return new NextResponse(await fetchObject(doc.current_version.storage_key), {
          headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
        })
      return NextResponse.json(
        {
          slug,
          title: doc.title,
          created_at: doc.created_at,
          updated_at: doc.updated_at,
          version_number: doc.current_version.version_number,
        },
        { headers },
      )
    }
    // Keep existing published snippets accessible while migrating the workspace.
    const snippet = await getSnippetBySlug(slug)
    if (!snippet) return NextResponse.json({ error: 'Not found' }, { status: 404, headers })
    if (req.nextUrl.searchParams.get('html') === '1')
      return new NextResponse(await fetchSnippet(slug), {
        headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
      })
    return NextResponse.json(
      { slug, title: snippet.title, created_at: snippet.created_at, version_number: 1 },
      { headers },
    )
  } catch {
    return NextResponse.json(
      { error: 'Saved artifact temporarily unavailable.' },
      { status: 503, headers },
    )
  }
}
