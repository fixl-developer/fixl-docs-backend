export interface ContextFile {
  path: string
  content: string
}
export interface ContextSource {
  id: string
  kind: 'folder' | 'github'
  label: string
  files: ContextFile[]
  repository?: string
  branch?: string
  commit?: string
  paths?: string[]
  updated_at: string
  fingerprint: string
}
export interface SourceReference {
  source: string
  path: string
  commit?: string
  truncated: boolean
}
export interface WorkspaceMessage {
  role: 'user' | 'assistant'
  content: string
  created_at: string
  references?: SourceReference[]
}
export interface WorkspaceDraft {
  id: string
  html: string
  prompt: string
  base_version_id: string | null
  created_at: string
  references: SourceReference[]
  meta?: { model: string; input_tokens: number; output_tokens: number }
}
export interface WorkspaceThread {
  id: string
  revision: number
  messages: WorkspaceMessage[]
  draft: WorkspaceDraft | null
  request_id: string | null
  lease_until: string | null
}
export interface SourceSummary extends Omit<ContextSource, 'files'> {
  files: { path: string; bytes: number }[]
}
