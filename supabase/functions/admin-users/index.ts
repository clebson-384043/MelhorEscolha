/**
 * Edge Function: admin-users
 * Gerencia usuários via Supabase Auth Admin API.
 * A service_role key fica no servidor (nunca no browser).
 *
 * Deploy: supabase functions deploy admin-users
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!

    // Cliente admin — service_role, acesso total
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Verifica identidade do chamador via JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Não autenticado' }, 401)

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await caller.auth.getUser()
    if (userErr || !user) return json({ error: 'Token inválido' }, 401)

    // Verifica se o chamador é super admin
    const { data: adminRow } = await admin
      .from('admin_perfis')
      .select('email')
      .eq('email', user.email)
      .single()

    if (!adminRow) return json({ error: 'Acesso negado — não é super admin' }, 403)

    // ── Ações ─────────────────────────────────────────────────────────────
    const { action, ...body } = await req.json()

    if (action === 'list') {
      const { data: { users }, error } = await admin.auth.admin.listUsers({ perPage: 200 })
      if (error) throw error
      return json({ users })
    }

    if (action === 'create') {
      const { email, password } = body as { email: string; password: string }
      if (!email || !password) return json({ error: 'E-mail e senha obrigatórios' }, 400)
      if (password.length < 8) return json({ error: 'Senha mínima de 8 caracteres' }, 400)
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error) throw error
      return json({ user: data.user })
    }

    if (action === 'delete') {
      const { userId } = body as { userId: string }
      if (userId === user.id) return json({ error: 'Não é possível excluir sua própria conta' }, 400)
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'toggle_admin') {
      const { email, isAdmin } = body as { email: string; isAdmin: boolean }
      if (isAdmin) {
        await admin.from('admin_perfis').insert({ email }).onConflict('email').ignore()
      } else {
        if (email === user.email) return json({ error: 'Não pode remover seu próprio acesso admin' }, 400)
        await admin.from('admin_perfis').delete().eq('email', email)
      }
      return json({ ok: true })
    }

    return json({ error: 'Ação desconhecida' }, 400)

  } catch (err) {
    console.error(err)
    return json({ error: String(err) }, 500)
  }
})
