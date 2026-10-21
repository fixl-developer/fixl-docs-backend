export interface Snippet {
  id: string
  slug: string
  storage_key: string
  file_size: number
  created_at: string
  ip_hash: string | null
  title: string | null
}

export interface UploadResponse {
  slug: string
  url: string
}
