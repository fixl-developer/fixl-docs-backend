import { NextResponse } from 'next/server'

// Remote snapshots cannot preserve Claude-only APIs or external assets. The
// former unrestricted fetcher also allowed requests into private networks.
// Keep this URL explicit for older clients, but never make an outbound request.
export async function POST() {
  return NextResponse.json(
    {
      code: 'STANDALONE_HTML_REQUIRED',
      error:
        'URL import is retired. Export a standalone HTML file, then upload or paste it into your artifact workspace.',
    },
    { status: 410 },
  )
}
