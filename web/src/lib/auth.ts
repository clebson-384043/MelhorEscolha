import { supabase } from './supabase'
export { supabase }   // re-export para componentes que importam de auth
import type { Session } from '@supabase/supabase-js'

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export function onAuthChange(cb: (s: Session | null) => void) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
    cb(session)
  })
  return subscription
}
