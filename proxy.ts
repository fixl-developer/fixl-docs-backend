import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const origin = process.env.FRONTEND_URL ?? '*'
  const allowedHeaders = 'Content-Type, Authorization'
  const allowedMethods = 'GET, POST, PATCH, DELETE, OPTIONS'

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': allowedMethods,
        'Access-Control-Allow-Headers': allowedHeaders,
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  const response = NextResponse.next()
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.set('Access-Control-Allow-Methods', allowedMethods)
  response.headers.set('Access-Control-Allow-Headers', allowedHeaders)
  return response
}

export const config = {
  matcher: '/api/:path*',
}
