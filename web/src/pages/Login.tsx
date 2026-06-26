import { useState, FormEvent } from 'react'
import { signIn } from '../lib/auth'
import './Login.css'

const FEATURES = [
  'Estoque atualizado diariamente dos 6 pátios',
  'Margem bruta e líquida lado a lado',
  'Alertas de novidades e quedas de preço',
  'Filtros por pátio, categoria e margem mínima',
]

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email.trim(), password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      if (msg.includes('Invalid login') || msg.includes('invalid_credentials')) {
        setError('E-mail ou senha incorretos.')
      } else if (msg.includes('Email not confirmed')) {
        setError('E-mail não confirmado. Desative "Confirm email" em Authentication → Configuration → Email no Supabase.')
      } else {
        setError(`Erro ao autenticar: ${msg}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell">
      {/* Painel esquerdo — branding */}
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo">
            <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <rect width="40" height="40" rx="10" fill="#1D4ED8"/>
              <path d="M8 26l4-8h16l4 8H8z" fill="#fff" opacity=".9"/>
              <circle cx="14" cy="27" r="2.5" fill="#fff"/>
              <circle cx="26" cy="27" r="2.5" fill="#fff"/>
              <path d="M10 22h20M14 18l2-4h8l2 4" stroke="#fff" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Escolha Certa</span>
          </div>

          <div className="login-brand-text">
            <h1>Inteligência de estoque para comprar melhor.</h1>
            <p>Análise diária de 1.400+ veículos com margem líquida em tempo real.</p>
          </div>

          <ul className="login-features">
            {FEATURES.map(f => (
              <li key={f}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="10" r="10" fill="rgba(255,255,255,.15)"/>
                  <path d="M6 10l3 3 5-5" stroke="#fff" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {f}
              </li>
            ))}
          </ul>

          <p className="login-powered">Desenvolvido por CarmoIA</p>
        </div>
      </div>

      {/* Painel direito — formulário */}
      <div className="login-form-panel">
        <div className="login-form-inner">
          <div className="login-form-header">
            <h2>Bem-vindo de volta</h2>
            <p>Entre com suas credenciais de acesso</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="login-field">
              <label htmlFor="password">Senha</label>
              <div className="login-pwd-wrap">
                <input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  className="login-pwd-toggle"
                  onClick={() => setShowPwd(v => !v)}
                  aria-label={showPwd ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPwd ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="login-error" role="alert">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 7a1 1 0 012 0v4a1 1 0 01-2 0V7zm1 8a1 1 0 100-2 1 1 0 000 2z"/>
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="login-btn"
              disabled={loading || !email || !password}
            >
              {loading ? (
                <>
                  <svg className="login-spinner" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,.3)" strokeWidth="3"/>
                    <path d="M12 2a10 10 0 0110 10" stroke="#fff" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Entrando…
                </>
              ) : 'Entrar'}
            </button>
          </form>

          <p className="login-hint">
            Acesso restrito. Solicite credenciais ao administrador.
          </p>
        </div>
      </div>
    </div>
  )
}
