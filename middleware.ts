import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS'
const ALLOWED_HEADERS = 'Content-Type, Authorization'

function resolveOrigin(requestOrigin: string | null): string {
  const primary = process.env.FRONTEND_URL ?? ''
  if (!requestOrigin) return primary

  // Exact match with configured frontend URL
  if (requestOrigin === primary) return requestOrigin

  // Any preview/unique deployment URL for our frontend project on Vercel
  if (
    requestOrigin.includes('htmldrop-frontend') &&
    requestOrigin.endsWith('.vercel.app')
  ) return requestOrigin

  // Local development
  if (requestOrigin.startsWith('http://localhost:')) return requestOrigin

  return primary
}

export function middleware(request: NextRequest) {
  const origin = resolveOrigin(request.headers.get('origin'))

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': ALLOWED_METHODS,
        'Access-Control-Allow-Headers': ALLOWED_HEADERS,
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
    })
  }

  const response = NextResponse.next()
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
  response.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  response.headers.set('Vary', 'Origin')
  return response
}

export const config = {
  matcher: '/api/:path*',
}
