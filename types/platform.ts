export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: 'employee' | 'manager' | 'founder'
  can_view_all_docs: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectMember {
  project_id: string
  user_id: string
  role: 'owner' | 'editor' | 'viewer'
  added_at: string
  profile?: Pick<Profile, 'id' | 'email' | 'full_name' | 'role'>
}

export interface Document {
  id: string
  title: string
  project_id: string
  current_version_id: string | null
  created_by: string | null
  slug: string
  is_public: boolean
  created_at: string
  updated_at: string
  current_version?: DocumentVersion
  creator?: Pick<Profile, 'id' | 'email' | 'full_name'>
}

export interface DocumentVersion {
  id: string
  document_id: string
  version_number: number
  storage_key: string
  file_size: number
  prompt_used: string | null
  change_note: string | null
  created_by: string | null
  created_at: string
  creator?: Pick<Profile, 'id' | 'email' | 'full_name'>
}

export interface ViewLog {
  id: string
  document_id: string
  version_id: string | null
  viewed_by: string | null
  viewed_at: string
  viewer?: Pick<Profile, 'id' | 'email' | 'full_name'>
}

// API response shapes
export interface CreateDocumentBody {
  title: string
  project_id: string
  html: string
  change_note?: string
  is_public?: boolean
}

export interface CreateVersionBody {
  html: string
  change_note?: string
}

export interface ClaudeUpdateBody {
  prompt: string
  mode: 'update' | 'regenerate'
  change_note?: string
}

export interface InviteUserBody {
  email: string
  full_name?: string
  role: 'employee' | 'manager'
}

export interface UpdateUserBody {
  role?: 'employee' | 'manager' | 'founder'
  can_view_all_docs?: boolean
  full_name?: string
}

export interface Kudos {
  id: string
  from_user_id: string
  to_user_id: string
  message: string
  emoji: string
  created_at: string
  from_user?: Pick<Profile, 'id' | 'email' | 'full_name'>
}
