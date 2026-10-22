import { NextRequest, NextResponse } from 'next/server'
import { fetchSnippet } from '@/lib/storage'
import { getSnippetBySlug } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const snippet = await getSnippetBySlug(slug)
  if (!snippet) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const html = await fetchSnippet(slug)

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
