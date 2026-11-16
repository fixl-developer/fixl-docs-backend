import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireRole } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const roleError = requireRole(profile, ['manager', 'founder'])
  if (roleError) return roleError

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('documents')
    .select('*, creator:profiles!documents_created_by_fkey(id,email,full_name)')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// Permanent delete (founder only)
export async function DELETE(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const roleError = requireRole(profile, ['founder'])
  if (roleError) return roleError

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const supabase = createServiceClient()
  const { error } = await supabase.from('documents').delete().eq('id', id).not('deleted_at', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
