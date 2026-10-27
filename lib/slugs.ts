import { customAlphabet } from 'nanoid'
import { supabase } from './db'

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const generate = customAlphabet(alphabet, 10)

// For legacy snippet routes
export async function generateUniqueSlug(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generate()
    const { data } = await supabase.from('snippets').select('slug').eq('slug', slug).maybeSingle()
    if (!data) return slug
  }
  throw new Error('Failed to generate unique slug after 5 attempts')
}

// For document routes
export async function generateDocumentSlug(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generate()
    const { data } = await supabase.from('documents').select('slug').eq('slug', slug).maybeSingle()
    if (!data) return slug
  }
  throw new Error('Failed to generate unique document slug after 5 attempts')
}
