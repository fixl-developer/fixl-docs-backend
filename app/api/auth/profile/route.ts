import { NextRequest, NextResponse } from 'next/server'
import { getAuthProfile, requireAuth, extractToken } from '@/lib/auth'
import { createServiceClient, getUserFromToken } from '@/lib/supabase-server'

export async function PATCH(req: NextRequest) {
  const profile = await getAuthProfile(req)
  const authError = requireAuth(profile)
  if (authError) return authError

  const { full_name, current_password, new_password } = await req.json()
  const supabase = createServiceClient()

  // Update display name
  if (full_name !== undefined) {
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: full_name || null })
      .eq('id', profile!.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Change password — requires verifying current password first
  if (new_password) {
    if (!current_password) {
      return NextResponse.json({ error: 'Current password is required to set a new password' }, { status: 400 })
    }
    // Re-authenticate with the user's own JWT to verify current password
    const token = extractToken(req)!
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: profile!.email!,
      password: current_password,
    })
    if (signInError) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }
    // Update password via admin API
    const userId = await getUserFromToken(token)
    const { error: pwError } = await supabase.auth.admin.updateUserById(userId!, {
      password: new_password,
    })
    if (pwError) return NextResponse.json({ error: pwError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
