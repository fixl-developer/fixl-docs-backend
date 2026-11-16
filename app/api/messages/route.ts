import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth } from '@/lib/auth'
import { getConversations, getUnreadCount, listProfiles } from '@/lib/db'

export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const url = new URL(req.url)

  // ?count=1 — just return unread count (for polling)
  if (url.searchParams.get('count') === '1') {
    const count = await getUnreadCount(profile!.id)
    return NextResponse.json({ unread: count })
  }

  // ?users=1 — return all users for new conversation picker
  if (url.searchParams.get('users') === '1') {
    const all = await listProfiles()
    const others = all.filter(p => p.id !== profile!.id).map(p => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      role: p.role,
    }))
    return NextResponse.json(others)
  }

  const conversations = await getConversations(profile!.id)
  return NextResponse.json(conversations)
}
