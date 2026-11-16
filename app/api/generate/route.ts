import { NextRequest } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { createClaudeDraft } from '@/lib/claude-draft'
export const maxDuration = 180
export async function POST(req: NextRequest) {
  const profile = await getAuthProfile(req),
    error = requireAuth(profile)
  if (error) return error
  const body = await req.json().catch(() => null)
  return createClaudeDraft(req, profile!.id, body || {})
}
