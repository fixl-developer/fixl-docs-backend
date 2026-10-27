import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Service role client — bypass RLS for server-side operations
export function createServiceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Validate a user JWT and return the user ID, or null if invalid
export async function getUserFromToken(token: string): Promise<string | null> {
  const client = createServiceClient()
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}
