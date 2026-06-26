import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

if (!url || !key) {
  console.error('[radar] VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não definidos em web/.env')
}

export const supabase = createClient(url || 'http://localhost', key || 'placeholder')
export const TENANT = (import.meta.env.VITE_TENANT as string | undefined) ?? 'piloto'
