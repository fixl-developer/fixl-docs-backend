import { createClient } from '@supabase/supabase-js'
import type { Snippet } from '@/types/snippet'
import type { Profile, Project, ProjectMember, Document, DocumentVersion, ViewLog, Kudos, ConnectedProject, ProjectFile, Message, ConversationSummary, AuditEvent } from '@/types/platform'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// ─── Legacy snippets (unchanged) ─────────────────────────────────────────────

export async function insertSnippet(
  slug: string,
  storageKey: string,
  fileSize: number,
  ipHash: string | null,
  title: string | null,
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
  const { data, error } = await supabase.from('snippets').select('*').eq('slug', slug).single()

  if (error) return null
  return data as Snippet
}

// ─── Profiles ────────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
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
  updates: Partial<Pick<Profile, 'full_name' | 'role' | 'can_view_all_docs'>>,
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
  const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single()
  if (error) return null
  return data as Project
}

export async function createProject(
  name: string,
  description: string | null,
  createdBy: string,
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ name, description, created_by: createdBy })
    .select()
    .single()
  if (error) throw new Error(error.message)

  // auto-add creator as owner
  const { error: memberError } = await supabase
    .from('project_members')
    .insert({ project_id: data.id, user_id: createdBy, role: 'owner' })
  if (memberError) {
    await supabase.from('projects').delete().eq('id', data.id)
    throw new Error('Could not create project membership')
  }
  return data as Project
}

export async function updateProject(
  projectId: string,
  updates: Partial<Pick<Project, 'name' | 'description'>>,
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
  role: ProjectMember['role'],
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
  profile: Profile,
): Promise<Document[]> {
  let query = supabase
    .from('documents')
    .select(
      '*, current_version:document_versions!fk_current_version(id,version_number,created_at,created_by,file_size,prompt_used), creator:profiles!documents_created_by_fkey(id,email,full_name)',
    )
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })

  if (profile.role === 'employee' && !profile.can_view_all_docs) {
    const { data: memberships, error: memberError } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId)
    if (memberError) throw new Error('Could not verify project access')
    const ids = (memberships ?? []).map((m: { project_id: string }) => m.project_id)
    query = ids.length
      ? query.or('created_by.eq.' + userId + ',project_id.in.(' + ids.join(',') + ')')
      : query.eq('created_by', userId)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as Document[]
}

export async function getAllDocuments(userId: string, profile: Profile): Promise<Document[]> {
  let query = supabase
    .from('documents')
    .select(
      '*, current_version:document_versions!fk_current_version(id,version_number,created_at,created_by,file_size,prompt_used), creator:profiles!documents_created_by_fkey(id,email,full_name)',
    )
    .order('updated_at', { ascending: false })

  if (profile.role === 'employee' && !profile.can_view_all_docs) {
    const { data: memberships, error: memberError } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId)
    if (memberError) throw new Error('Could not verify project access')
    const ids = (memberships ?? []).map((m: { project_id: string }) => m.project_id)
    query = ids.length
      ? query.or('created_by.eq.' + userId + ',project_id.in.(' + ids.join(',') + ')')
      : query.eq('created_by', userId)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as Document[]
}

export async function getDocument(docId: string): Promise<Document | null> {
  const { data, error } = await supabase
    .from('documents')
    .select(
      '*, current_version:document_versions!fk_current_version(*), creator:profiles!documents_created_by_fkey(id,email,full_name)',
    )
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
  isPublic: boolean,
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
  versionId: string,
): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ current_version_id: versionId, updated_at: new Date().toISOString() })
    .eq('id', docId)
  if (error) throw new Error(error.message)
}

export async function updateDocument(
  docId: string,
  updates: Partial<Pick<Document, 'title' | 'is_public'>>,
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
  changeNote: string | null,
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
  userId: string,
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
    const { error } = await supabase
      .from('document_stars')
      .delete()
      .eq('user_id', userId)
      .eq('document_id', docId)
    if (error) throw new Error(error.message)
    return false
  }
  const { error } = await supabase
    .from('document_stars')
    .insert({ user_id: userId, document_id: docId })
  if (error) throw new Error(error.message)
  return true
}

export async function getStarredDocumentIds(userId: string): Promise<string[]> {
  const { data } = await supabase.from('document_stars').select('document_id').eq('user_id', userId)
  return (data ?? []).map((r: { document_id: string }) => r.document_id)
}

export async function getStarredDocuments(userId: string, profile: Profile): Promise<Document[]> {
  const ids = await getStarredDocumentIds(userId)
  if (!ids.length) return []

  let query = supabase
    .from('documents')
    .select(
      '*, current_version:document_versions!fk_current_version(id,version_number,created_at,prompt_used), creator:profiles!documents_created_by_fkey(id,email,full_name)',
    )
    .in('id', ids)
    .order('updated_at', { ascending: false })

  if (profile.role === 'employee' && !profile.can_view_all_docs) {
    const { data: memberships, error: memberError } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId)
    if (memberError) throw new Error('Could not verify project access')
    const ids = (memberships ?? []).map((m: { project_id: string }) => m.project_id)
    query = ids.length
      ? query.or('created_by.eq.' + userId + ',project_id.in.(' + ids.join(',') + ')')
      : query.eq('created_by', userId)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((d: Document) => ({ ...d, is_starred: true })) as Document[]
}

// ─── Team Overview ────────────────────────────────────────────────────────────

export async function getTeamOverview(): Promise<
  Array<{ profile: Profile; documents: Document[]; doc_count: number }>
> {
  const profiles = await listProfiles()

  const results = await Promise.all(
    profiles.map(async (profile) => {
      const [docsRes, countRes] = await Promise.all([
        supabase
          .from('documents')
          .select(
            '*, current_version:document_versions!fk_current_version(id,version_number,created_at,prompt_used)',
          )
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
    }),
  )

  return results
}

// ─── Kudos ───────────────────────────────────────────────────────────────────

export async function createKudos(
  fromUserId: string,
  toUserId: string,
  message: string,
  emoji: string,
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

// ─── Connected Projects ───────────────────────────────────────────────────────

export async function listConnectedProjects(userId: string, role: Profile['role']): Promise<ConnectedProject[]> {
  let query = supabase
    .from('connected_projects')
    .select('*')
    .order('updated_at', { ascending: false })

  if (role === 'employee') {
    query = query.eq('created_by', userId)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as ConnectedProject[]
}

export async function getConnectedProject(id: string): Promise<ConnectedProject | null> {
  const { data, error } = await supabase
    .from('connected_projects')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return data as ConnectedProject
}

export async function createConnectedProject(
  name: string,
  type: 'local' | 'github',
  createdBy: string,
  projectId: string | null,
  githubRepoUrl: string | null,
  githubBranch: string,
  documentId: string | null = null
): Promise<ConnectedProject> {
  const { data, error } = await supabase
    .from('connected_projects')
    .insert({ name, type, created_by: createdBy, project_id: projectId, github_repo_url: githubRepoUrl, github_branch: githubBranch, document_id: documentId })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as ConnectedProject
}

export async function deleteConnectedProject(id: string): Promise<void> {
  const { error } = await supabase.from('connected_projects').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateConnectedProjectAfterSync(
  id: string,
  documentId: string,
  fileCount: number,
  projectId?: string
): Promise<void> {
  const updates: Record<string, unknown> = {
    document_id: documentId,
    file_count: fileCount,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (projectId) updates.project_id = projectId
  const { error } = await supabase.from('connected_projects').update(updates).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getProjectFiles(connectedProjectId: string): Promise<ProjectFile[]> {
  const { data, error } = await supabase
    .from('project_files')
    .select('*')
    .eq('connected_project_id', connectedProjectId)
  if (error) return []
  return data as ProjectFile[]
}

export async function upsertProjectFiles(
  connectedProjectId: string,
  files: Array<{ path: string; hash: string; size: number }>
): Promise<void> {
  const rows = files.map(f => ({
    connected_project_id: connectedProjectId,
    file_path: f.path,
    content_hash: f.hash,
    file_size: f.size,
    last_synced_at: new Date().toISOString(),
  }))
  const { error } = await supabase
    .from('project_files')
    .upsert(rows, { onConflict: 'connected_project_id,file_path' })
  if (error) throw new Error(error.message)
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getConversations(userId: string): Promise<ConversationSummary[]> {
  const { data } = await supabase
    .from('messages')
    .select('*, from_user:from_user_id(id,email,full_name,role), to_user:to_user_id(id,email,full_name,role)')
    .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(300)

  if (!data) return []

  const seen = new Map<string, ConversationSummary>()

  for (const msg of data as Message[]) {
    const isFromMe = msg.from_user_id === userId
    const otherId = isFromMe ? msg.to_user_id : msg.from_user_id
    const otherUser = (isFromMe ? msg.to_user : msg.from_user) as Pick<Profile, 'id' | 'email' | 'full_name' | 'role'>
    if (!otherUser) continue

    if (!seen.has(otherId)) {
      seen.set(otherId, {
        user: otherUser,
        last_message: msg.content,
        last_message_at: msg.created_at,
        unread_count: 0,
        last_from_me: isFromMe,
      })
    }
    if (!isFromMe && !msg.read_at) {
      seen.get(otherId)!.unread_count++
    }
  }

  return Array.from(seen.values())
}

export async function getThread(userId: string, otherId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*, from_user:from_user_id(id,email,full_name,role)')
    .or(
      `and(from_user_id.eq.${userId},to_user_id.eq.${otherId}),and(from_user_id.eq.${otherId},to_user_id.eq.${userId})`
    )
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) return []
  return data as Message[]
}

export async function sendMessage(fromUserId: string, toUserId: string, content: string): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ from_user_id: fromUserId, to_user_id: toUserId, content })
    .select('*, from_user:from_user_id(id,email,full_name,role)')
    .single()
  if (error) throw new Error(error.message)
  return data as Message
}

export async function markThreadRead(toUserId: string, fromUserId: string): Promise<void> {
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('to_user_id', toUserId)
    .eq('from_user_id', fromUserId)
    .is('read_at', null)
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('to_user_id', userId)
    .is('read_at', null)
  return count ?? 0
}

// ─── Audit Events ─────────────────────────────────────────────────────────────

export async function logAuditEvent(params: {
  eventType: string
  actorId: string | null
  resourceType: string
  resourceId?: string | null
  resourceTitle?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await supabase.from('audit_events').insert({
      event_type: params.eventType,
      actor_id: params.actorId,
      resource_type: params.resourceType,
      resource_id: params.resourceId ?? null,
      resource_title: params.resourceTitle ?? null,
      metadata: params.metadata ?? {},
    })
  } catch {
    // audit failure must never break the main flow
  }
}

export async function getAuditEvents(
  limit = 100,
  offset = 0,
  filters?: { eventType?: string; actorId?: string; resourceId?: string }
): Promise<AuditEvent[]> {
  let query = supabase
    .from('audit_events')
    .select('*, actor:profiles!audit_events_actor_id_fkey(id, email, full_name, role)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filters?.eventType) query = query.eq('event_type', filters.eventType)
  if (filters?.actorId) query = query.eq('actor_id', filters.actorId)
  if (filters?.resourceId) query = query.eq('resource_id', filters.resourceId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as AuditEvent[]
}

export async function deleteRemovedProjectFiles(
  connectedProjectId: string,
  currentPaths: string[]
): Promise<void> {
  if (!currentPaths.length) {
    await supabase.from('project_files').delete().eq('connected_project_id', connectedProjectId)
    return
  }
  const { error } = await supabase
    .from('project_files')
    .delete()
    .eq('connected_project_id', connectedProjectId)
    .not('file_path', 'in', `(${currentPaths.map(p => `"${p}"`).join(',')})`)
  if (error) throw new Error(error.message)
}
