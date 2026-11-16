import { createServiceClient } from './supabase-server'
import type { Document, Profile } from '@/types/platform'
export function isLead(profile: Profile) {
  return profile.role === 'manager' || profile.role === 'founder'
}
export async function projectRole(
  projectId: string,
  userId: string,
): Promise<'owner' | 'editor' | 'viewer' | null> {
  const { data, error } = await createServiceClient()
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error('Could not verify project access')
  return data?.role ?? null
}
export async function canReadProject(profile: Profile, id: string) {
  return isLead(profile) || !!(await projectRole(id, profile.id))
}
export async function canEditProject(profile: Profile, id: string) {
  return isLead(profile) || (await projectRole(id, profile.id)) === 'owner'
}
export async function canCreateInProject(profile: Profile, id: string) {
  if (isLead(profile)) return true
  const role = await projectRole(id, profile.id)
  return role === 'owner' || role === 'editor'
}
export async function documentAccess(profile: Profile, doc: Document) {
  const lead = isLead(profile),
    creator = doc.created_by === profile.id
  const role = lead || creator ? null : await projectRole(doc.project_id, profile.id)
  return {
    read: lead || creator || profile.can_view_all_docs || !!role,
    edit: lead || creator || role === 'owner' || role === 'editor',
    delete: lead || creator,
  }
}
