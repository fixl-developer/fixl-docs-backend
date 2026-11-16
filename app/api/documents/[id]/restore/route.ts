import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { createServiceClient } from '@/lib/supabase-server'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const profile = await getAuthProfile(req)
  const roleError = requireRole(profile, ['manager', 'founder'])
  if (roleError) return roleError

  const { id } = await params
  const supabase = createServiceClient()

  const { data: doc, error: fetchErr } = await supabase
    .from('documents')
    .select('id, title, project_id, deleted_at')
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .single()

  if (fetchErr || !doc) {
    return NextResponse.json({ error: 'Document not found in trash' }, { status: 404 })
  }

  const { error } = await supabase
    .from('documents')
    .update({ deleted_at: null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  logAuditEvent({
    eventType: 'document.restored',
    actorId: profile!.id,
    resourceType: 'document',
    resourceId: id,
    resourceTitle: doc.title,
    metadata: { project_id: doc.project_id },
  })

  return NextResponse.json({ restored: true })
}
