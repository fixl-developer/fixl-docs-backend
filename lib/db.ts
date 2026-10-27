import { createClient } from '@supabase/supabase-js'
import type { Snippet } from '@/types/snippet'
import type { Profile, Project, ProjectMember, Document, DocumentVersion, ViewLog, Kudos } from '@/types/platform'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// ─── Legacy snippets (unchanged) ─────────────────────────────────────────────

export async function insertSnippet(
  slug: string,
  storageKey: string,
  fileSize: number,
  ipHash: string | null,
  title: string | null
): Promise<Snippet> {
  const { data, error } = await supabase
    .from('snippets')
    .insert({ slug, storage_key: storageKey, file_size: fileSize, ip_hash: ipHash, title })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Snippet
}

export async function getSnippetBySlug(slug: string): Promise<Snippet | null> {
  const { data, error } = await supabase
    .from('snippets')
    .select('*')
    .eq('slug', slug)
    .single()

  if (error) return null
  return data as Snippet
}

// ─── Profiles ────────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) return null
  return data as Profile
}

export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data as Profile[]
}

export async function updateProfile(
  userId: string,
  updates: Partial<Pick<Profile, 'full_name' | 'role' | 'can_view_all_docs'>>
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Profile
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function listProjects(userId: string, role: Profile['role']): Promise<Project[]> {
  if (role === 'manager' || role === 'founder') {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data as Project[]
  }

  const { data, error } = await supabase
    .from('projects')
    .select('*, project_members!inner(user_id)')
    .eq('project_members.user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data as Project[]
}

export async function getProject(projectId: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (error) return null
  return data as Project
}

export async function createProject(
  name: string,
  description: string | null,
  createdBy: string
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ name, description, created_by: createdBy })
    .select()
    .single()
  if (error) throw new Error(error.message)

  // auto-add creator as owner
  await supabase
    .from('project_members')
    .insert({ project_id: data.id, user_id: createdBy, role: 'owner' })

  return data as Project
}

export async function updateProject(
  projectId: string,
  updates: Partial<Pick<Project, 'name' | 'description'>>
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Project
}

export async function deleteProject(projectId: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) throw new Error(error.message)
}

export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase
    .from('project_members')
    .select('*, profile:profiles(id, email, full_name, role)')
    .eq('project_id', projectId)
  if (error) throw new Error(error.message)
  return data as ProjectMember[]
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: ProjectMember['role']
): Promise<void> {
  const { error } = await supabase
    .from('project_members')
    .upsert({ project_id: projectId, user_id: userId, role })
  if (error) throw new Error(error.message)
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

// ─── Documents ───────────────────────────────────────────────────────────────

export async function listDocuments(
  projectId: string,
  userId: string,
  profile: Profile
): Promise<Document[]> {
  let query = supabase
    .from('documents')
    .select('*, current_version:document_versions!fk_current_version(id,version_number,created_at,created_by,file_size,prompt_used), creator:profiles!documents_created_by_fkey(id,email,full_name)')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })

  if (profile.role === 'employee' && !profile.can_view_all_docs) {
    query = query.eq('created_by', userId)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as Document[]
}

export async function getAllDocuments(userId: string, profile: Profile): Promise<Document[]> {
  let query = supabase
    .from('documents')
    .select('*, current_version:document_versions!fk_current_version(id,version_number,created_at,created_by), creator:profiles!documents_created_by_fkey(id,email,full_name)')
    .order('updated_at', { ascending: false })

  if (profile.role === 'employee' && !profile.can_view_all_docs) {
    query = query.eq('created_by', userId)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as Document[]
}

export async function getDocument(docId: string): Promise<Document | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('*, current_version:document_versions!fk_current_version(*), creator:profiles!documents_created_by_fkey(id,email,full_name)')
    .eq('id', docId)
    .single()
  if (error) return null
  return data as Document
}

export async function getDocumentBySlug(slug: string): Promise<Document | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('*, current_version:document_versions!fk_current_version(*)')
    .eq('slug', slug)
    .single()
  if (error) return null
  return data as Document
}

export async function createDocument(
  title: string,
  projectId: string,
  createdBy: string,
  slug: string,
  isPublic: boolean
): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .insert({ title, project_id: projectId, created_by: createdBy, slug, is_public: isPublic })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Document
}

export async function updateDocumentCurrentVersion(
  docId: string,
  versionId: string
): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ current_version_id: versionId, updated_at: new Date().toISOString() })
    .eq('id', docId)
  if (error) throw new Error(error.message)
}

export async function updateDocument(
  docId: string,
  updates: Partial<Pick<Document, 'title' | 'is_public'>>
): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', docId)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Document
}

// ─── Document Versions ───────────────────────────────────────────────────────

export async function listVersions(docId: string): Promise<DocumentVersion[]> {
  const { data, error } = await supabase
    .from('document_versions')
    .select('*, creator:profiles!document_versions_created_by_fkey(id,email,full_name)')
    .eq('document_id', docId)
    .order('version_number', { ascending: false })
  if (error) throw new Error(error.message)
  return data as DocumentVersion[]
}

export async function getVersion(versionId: string): Promise<DocumentVersion | null> {
  const { data, error } = await supabase
    .from('document_versions')
    .select('*')
    .eq('id', versionId)
    .single()
  if (error) return null
  return data as DocumentVersion
}

export async function getNextVersionNumber(docId: string): Promise<number> {
  const { data, error } = await supabase
    .from('document_versions')
    .select('version_number')
    .eq('document_id', docId)
    .order('version_number', { ascending: false })
    .limit(1)
  if (error || !data.length) return 1
  return data[0].version_number + 1
}

export async function insertVersion(
  docId: string,
  versionNumber: number,
  storageKey: string,
  fileSize: number,
  createdBy: string,
  promptUsed: string | null,
  changeNote: string | null
): Promise<DocumentVersion> {
  const { data, error } = await supabase
    .from('document_versions')
    .insert({
      document_id: docId,
      version_number: versionNumber,
      storage_key: storageKey,
      file_size: fileSize,
      created_by: createdBy,
      prompt_used: promptUsed,
      change_note: changeNote,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as DocumentVersion
}

// ─── View Logs ───────────────────────────────────────────────────────────────

export async function insertViewLog(
  docId: string,
  versionId: string | null,
  userId: string
): Promise<void> {
  await supabase
    .from('view_logs')
    .insert({ document_id: docId, version_id: versionId, viewed_by: userId })
}

export async function listViewLogs(docId: string): Promise<ViewLog[]> {
  const { data, error } = await supabase
    .from('view_logs')
    .select('*, viewer:profiles!view_logs_viewed_by_fkey(id,email,full_name)')
    .eq('document_id', docId)
    .order('viewed_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return data as ViewLog[]
}

// ─── Document Stars ───────────────────────────────────────────────────────────

export async function toggleDocumentStar(userId: string, docId: string): Promise<boolean> {
  const { data } = await supabase
    .from('document_stars')
    .select('user_id')
    .eq('user_id', userId)
    .eq('document_id', docId)
    .maybeSingle()

  if (data) {
    await supabase.from('document_stars').delete().eq('user_id', userId).eq('document_id', docId)
    return false
  }
  await supabase.from('document_stars').insert({ user_id: userId, document_id: docId })
  return true
}

export async function getStarredDocumentIds(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('document_stars')
    .select('document_id')
    .eq('user_id', userId)
  return (data ?? []).map((r: { document_id: string }) => r.document_id)
}

export async function getStarredDocuments(userId: string, profile: Profile): Promise<Document[]> {
  const ids = await getStarredDocumentIds(userId)
  if (!ids.length) return []

  let query = supabase
    .from('documents')
    .select('*, current_version:document_versions!fk_current_version(id,version_number,created_at,prompt_used), creator:profiles!documents_created_by_fkey(id,email,full_name)')
    .in('id', ids)
    .order('updated_at', { ascending: false })

  if (profile.role === 'employee' && !profile.can_view_all_docs) {
    query = query.eq('created_by', userId)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((d: Document) => ({ ...d, is_starred: true })) as Document[]
}

// ─── Team Overview ────────────────────────────────────────────────────────────

export async function getTeamOverview(): Promise<Array<{ profile: Profile; documents: Document[]; doc_count: number }>> {
  const profiles = await listProfiles()

  const results = await Promise.all(
    profiles.map(async (profile) => {
      const [docsRes, countRes] = await Promise.all([
        supabase
          .from('documents')
          .select('*, current_version:document_versions!fk_current_version(id,version_number,created_at,prompt_used)')
          .eq('created_by', profile.id)
          .order('updated_at', { ascending: false })
          .limit(6),
        supabase
          .from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', profile.id),
      ])
      return {
        profile,
        documents: (docsRes.data ?? []) as Document[],
        doc_count: countRes.count ?? 0,
      }
    })
  )

  return results
}

// ─── Kudos ───────────────────────────────────────────────────────────────────

export async function createKudos(
  fromUserId: string,
  toUserId: string,
  message: string,
  emoji: string
): Promise<Kudos> {
  const { data, error } = await supabase
    .from('kudos')
    .insert({ from_user_id: fromUserId, to_user_id: toUserId, message, emoji })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Kudos
}

export async function getKudosForUser(userId: string): Promise<Kudos[]> {
  const { data, error } = await supabase
    .from('kudos')
    .select('*, from_user:from_user_id(id,email,full_name)')
    .eq('to_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) return []
  return data as Kudos[]
}
