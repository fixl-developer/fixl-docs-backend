import { NextRequest, NextResponse } from 'next/server'
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

  return NextResponse.json({
    slug: snippet.slug,
    title: snippet.title,
    created_at: snippet.created_at,
  })
}
