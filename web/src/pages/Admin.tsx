import { useEffect, useState, FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/auth'
import './Admin.css'

interface AdminUser {
  id: string
  email?: string
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
}

interface Props {
  session: Session
  onBack: () => void
}

function fmtTs(ts: string | null) {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(ts))
}

function initial(email = '') { return email[0]?.toUpperCase() ?? '?' }

export default function Admin({ session, onBack }: Props) {
  const [users, setUsers]           = useState<AdminUser[]>([])
  const [loading, setLoading]       = useState(true)
  const [apiError, setApiError]     = useState<string | null>(null)

  const [newEmail, setNewEmail]     = useState('')
  const [newPwd, setNewPwd]         = useState('')
  const [isAdmin, setIsAdmin]       = useState(false)
  const [creating, setCreating]     = useState(false)
  const [formMsg, setFormMsg]       = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [confirmId, setConfirmId]   = useState<string | null>(null)
  const [deleting, setDeleting]     = useState(false)

  useEffect(() => { loadUsers() }, [])

  async function call(body: object) {
    const { data, error } = await supabase.functions.invoke('admin-users', { body })
    if (error) throw new Error(error.message)
    if (data?.error) throw new Error(data.error)
    return data
  }

  async function loadUsers() {
    setLoading(true)
    setApiError(null)
    try {
      const data = await call({ action: 'list' })
      setUsers(data.users ?? [])
    } catch (e) {
      setApiError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setFormMsg(null)
    try {
      await call({ action: 'create', email: newEmail.trim(), password: newPwd })
      if (isAdmin) await call({ action: 'toggle_admin', email: newEmail.trim(), isAdmin: true })
      setFormMsg({ type: 'ok', text: `Usuário ${newEmail.trim()} criado com sucesso.` })
      setNewEmail(''); setNewPwd(''); setIsAdmin(false)
      loadUsers()
    } catch (e) {
      setFormMsg({ type: 'err', text: String(e) })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (!confirmId) return
    setDeleting(true)
    try {
      await call({ action: 'delete', userId: confirmId })
      setUsers(u => u.filter(x => x.id !== confirmId))
    } catch (e) {
      setApiError(String(e))
    } finally {
      setDeleting(false)
      setConfirmId(null)
    }
  }

  const myEmail = session.user.email ?? ''

  return (
    <div className="admin-page">
      {/* Header */}
      <header className="app-header">
        <button className="admin-back" onClick={onBack} aria-label="Voltar ao painel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Voltar
        </button>
        <div className="admin-title-group">
          <h1>Gestão de Usuários</h1>
          <span className="admin-badge">Super Admin</span>
        </div>
        <div style={{ flex: 1 }} />
        <span className="header-email" title={myEmail}>{myEmail}</span>
      </header>

      <div className="admin-content">
        {/* Coluna esquerda — tabela */}
        <section className="admin-section">
          <div className="admin-section-header">
            <div>
              <h2>Usuários cadastrados</h2>
              {!loading && <p className="admin-subtitle">{users.length} conta{users.length !== 1 ? 's' : ''}</p>}
            </div>
            <button className="admin-btn-refresh" onClick={loadUsers} disabled={loading} aria-label="Recarregar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          </div>

          {apiError && (
            <div className="admin-error">
              <strong>Erro:</strong> {apiError}
              {apiError.includes('admin-users') && (
                <span> — A Edge Function não está implantada ainda. Veja as instruções abaixo.</span>
              )}
            </div>
          )}

          {loading ? (
            <div className="admin-loading">Carregando usuários…</div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Usuário</th>
                    <th>Cadastrado em</th>
                    <th>Último acesso</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className={u.email === myEmail ? 'admin-row-me' : ''}>
                      <td>
                        <div className="admin-user-cell">
                          <div className="admin-avatar">{initial(u.email)}</div>
                          <div>
                            <div className="admin-user-email">{u.email}</div>
                            {u.email === myEmail && <div className="admin-you-badge">você</div>}
                          </div>
                        </div>
                      </td>
                      <td className="admin-ts">{fmtTs(u.created_at)}</td>
                      <td className="admin-ts">{fmtTs(u.last_sign_in_at)}</td>
                      <td>
                        <span className={`admin-status ${u.email_confirmed_at ? 'active' : 'pending'}`}>
                          {u.email_confirmed_at ? 'Ativo' : 'Pendente'}
                        </span>
                      </td>
                      <td>
                        {u.email !== myEmail && (
                          <button
                            className="admin-btn-delete"
                            onClick={() => setConfirmId(u.id)}
                            aria-label={`Remover ${u.email}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && !loading && (
                    <tr><td colSpan={5} className="admin-empty">Nenhum usuário encontrado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Coluna direita — formulário */}
        <aside className="admin-aside">
          <div className="admin-section">
            <div className="admin-section-header">
              <h2>Novo usuário</h2>
            </div>

            <form className="admin-form" onSubmit={handleCreate} noValidate>
              <div className="admin-field">
                <label htmlFor="adm-email">E-mail</label>
                <input
                  id="adm-email"
                  type="email"
                  placeholder="cliente@empresa.com"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  required
                  disabled={creating}
                />
              </div>

              <div className="admin-field">
                <label htmlFor="adm-pwd">
                  Senha
                  <span className="admin-field-hint">mín. 8 caracteres</span>
                </label>
                <input
                  id="adm-pwd"
                  type="text"
                  placeholder="Senha temporária"
                  value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                  required
                  minLength={8}
                  disabled={creating}
                />
              </div>

              <label className="admin-check-label">
                <input
                  type="checkbox"
                  checked={isAdmin}
                  onChange={e => setIsAdmin(e.target.checked)}
                  disabled={creating}
                />
                Conceder acesso de super admin
              </label>

              {formMsg && (
                <div className={`admin-form-msg ${formMsg.type}`} role="alert">
                  {formMsg.text}
                </div>
              )}

              <button
                type="submit"
                className="admin-btn-create"
                disabled={creating || !newEmail || newPwd.length < 8}
              >
                {creating ? 'Criando…' : 'Criar usuário'}
              </button>
            </form>
          </div>

          {/* Deploy instructions */}
          <div className="admin-deploy-box">
            <h3>Deploy da Edge Function</h3>
            <p>Execute uma vez para ativar o painel:</p>
            <pre><code>{`npm install -g supabase
supabase login
supabase link --project-ref tbwkywoyneswillnlpho
supabase functions deploy admin-users`}</code></pre>
          </div>
        </aside>
      </div>

      {/* Modal de confirmação de exclusão */}
      {confirmId && (
        <div className="admin-overlay" onClick={() => setConfirmId(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>Remover usuário</h3>
            <p>Tem certeza? O usuário perderá acesso imediatamente.</p>
            <div className="admin-modal-actions">
              <button className="admin-btn-cancel" onClick={() => setConfirmId(null)}>
                Cancelar
              </button>
              <button className="admin-btn-confirm-delete" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Removendo…' : 'Sim, remover'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
