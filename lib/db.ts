import { createClient } from '@supabase/supabase-js'
import type { Snippet } from '@/types/snippet'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

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
