import { useEffect, useState, useMemo } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

// Tenants disponíveis e seus rótulos de exibição
const TENANTS: { id: string; label: string; cor: string }[] = [
  { id: 'piloto',      label: 'Estoque Regular', cor: '#22C55E' },
  { id: 'lista_morte', label: 'Lista da Morte',  cor: '#F97316' },
]
const DEFAULT_TENANT = (import.meta.env.VITE_TENANT as string | undefined) ?? 'piloto'
import { getSession, onAuthChange, signOut } from './lib/auth'
import { fmtData } from './lib/format'
import { Vehicle, Filters, SortKey, SortDir } from './types'
import KpiCards from './components/KpiCards'
import FilterBar from './components/FilterBar'
import VehicleTable from './components/VehicleTable'
import VehicleCard from './components/VehicleCard'
import PriceHistory from './components/PriceHistory'
import Login from './pages/Login'
import Admin from './pages/Admin'
import Upload from './pages/Upload'
import { calcScore } from './lib/score'
import './App.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(makeQuery: () => any): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  let offset = 0
  while (true) {
    const { data, error } = await makeQuery().range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    all.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
    offset += PAGE
  }
  return all
}

const EMPTY_FILTERS: Filters = {
  busca: '', margemMin: '', arquivo: '', precoMax: '', categoria: '', somenteNovos: false,
}

// undefined = verificando sessão | null = não autenticado | Session = autenticado
type AuthState = Session | null | undefined

export default function App() {
  const [session, setSession] = useState<AuthState>(undefined)

  // Verifica sessão existente e escuta mudanças de auth
  useEffect(() => {
    getSession().then(setSession)
    const sub = onAuthChange(setSession)
    return () => sub.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="msg-loading">Carregando…</div>
      </div>
    )
  }

  if (!session) return <Login />

  return <Dashboard session={session} />
}

// ─── Dashboard (só renderiza quando autenticado) ───────────────────────────

function Dashboard({ session }: { session: Session }) {
  const [view, setView]             = useState<'dashboard' | 'admin' | 'upload'>('dashboard')
  const [isAdmin, setIsAdmin]       = useState(false)
  const [tenantId, setTenantId]     = useState<string>(DEFAULT_TENANT)
  const [selVehicle, setSelVehicle] = useState<Vehicle | null>(null)
  const [vehicles, setVehicles]     = useState<Vehicle[]>([])
  const [newPlacas, setNewPlacas]   = useState<Set<string>>(new Set())
  const [availDates, setAvailDates] = useState<string[]>([])
  const [selDate, setSelDate]       = useState<string>('')
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [filters, setFilters]       = useState<Filters>(EMPTY_FILTERS)
  const [sortKey, setSortKey]       = useState<SortKey>('margem_liq_pct')
  const [sortDir, setSortDir]       = useState<SortDir>('desc')

  // Verifica se o usuário logado é super admin
  useEffect(() => {
    supabase
      .from('admin_perfis')
      .select('email')
      .eq('email', session.user.email ?? '')
      .maybeSingle()
      .then(({ data }) => setIsAdmin(!!data))
  }, [session.user.email])

  // Ao trocar de tenant: limpa dados e recarrega datas
  function handleTenantChange(id: string) {
    setTenantId(id)
    setVehicles([])
    setNewPlacas(new Set())
    setAvailDates([])
    setSelDate('')
    setFilters(EMPTY_FILTERS)
    setSelVehicle(null)
  }

  // 1. Busca datas disponíveis (re-executa ao trocar tenant)
  useEffect(() => {
    setLoading(true)
    supabase
      .from('datas_disponiveis')
      .select('data_ref')
      .eq('tenant_id', tenantId)
      .order('data_ref', { ascending: false })
      .limit(60)
      .then(({ data, error: err }) => {
        if (err || !data?.length) {
          const hoje = new Date().toISOString().slice(0, 10)
          setAvailDates([hoje])
          setSelDate(hoje)
        } else {
          const datas = data.map(r => r.data_ref as string)
          setAvailDates(datas)
          setSelDate(datas[0])
        }
      })
  }, [tenantId])

  // 2. Busca veículos quando a data muda
  useEffect(() => {
    if (!selDate) return
    setLoading(true)
    setError(null)

    Promise.all([
      fetchAll<Vehicle>(() =>
        supabase
          .from('veiculos_snapshot')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('data_ref', selDate)
          .order('margem_liq_pct', { ascending: false })
      ),
      supabase
        .from('eventos_diarios')
        .select('placa')
        .eq('tenant_id', tenantId)
        .eq('data_ref', selDate)
        .eq('tipo', 'novo'),
    ])
      .then(([veics, { data: novos }]) => {
        setVehicles(veics)
        setNewPlacas(new Set((novos ?? []).map(r => r.placa as string)))
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selDate])

  // 3. Filtragem e ordenação client-side
  const filtered = useMemo(() => {
    let v = vehicles

    if (filters.busca) {
      const q = filters.busca.toLowerCase()
      v = v.filter(r =>
        r.modelo?.toLowerCase().includes(q) ||
        r.placa.toLowerCase().includes(q) ||
        r.categoria?.toLowerCase().includes(q),
      )
    }
    if (filters.arquivo)      v = v.filter(r => r.arquivo === filters.arquivo)
    if (filters.categoria)    v = v.filter(r => r.categoria === filters.categoria)
    if (filters.margemMin)    v = v.filter(r => (r.margem_liq_pct ?? 0) >= Number(filters.margemMin))
    if (filters.precoMax)     v = v.filter(r => (r.portal ?? Infinity) <= Number(filters.precoMax))
    if (filters.somenteNovos) v = v.filter(r => newPlacas.has(r.placa))

    return [...v].sort((a, b) => {
      // score é calculado, não é propriedade de Vehicle
      if (sortKey === 'score') {
        const sa = calcScore(a), sb = calcScore(b)
        return sortDir === 'asc' ? sa - sb : sb - sa
      }
      const av = a[sortKey as keyof Vehicle]
      const bv = b[sortKey as keyof Vehicle]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string' && typeof bv === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv, 'pt-BR') : bv.localeCompare(av, 'pt-BR')
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [vehicles, filters, newPlacas, sortKey, sortDir])

  // Lista de documentos únicos (nomes dos PDFs, sem extensão)
  const arquivos = useMemo(() => {
    const set = new Set<string>()
    vehicles.forEach(v => { if (v.arquivo) set.add(v.arquivo) })
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [vehicles])
  const categorias = useMemo(
    () => [...new Set(vehicles.map(v => v.categoria))].filter(Boolean).sort() as string[],
    [vehicles],
  )

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const userEmail   = session.user.email ?? ''
  const userInitial = userEmail[0]?.toUpperCase() ?? '?'

  if (view === 'admin') {
    return <Admin session={session} onBack={() => setView('dashboard')} />
  }

  if (view === 'upload') {
    return <Upload session={session} onBack={() => setView('dashboard')} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Escolha Certa</h1>

        {/* Seletor de tenant */}
        <div className="tenant-switcher">
          {TENANTS.map(t => (
            <button
              key={t.id}
              className={`tenant-btn ${tenantId === t.id ? 'active' : ''}`}
              style={{ '--tenant-cor': t.cor } as React.CSSProperties}
              onClick={() => handleTenantChange(t.id)}
              title={t.label}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          value={selDate}
          onChange={e => { setSelDate(e.target.value); setFilters(EMPTY_FILTERS) }}
          disabled={!availDates.length}
        >
          {availDates.map(d => (
            <option key={d} value={d}>{fmtData(d)}</option>
          ))}
        </select>

        {/* Espaçador */}
        <div style={{ flex: 1 }} />

        {/* Botão upload (só para admins) */}
        {isAdmin && (
          <button className="header-admin-btn" onClick={() => setView('upload')}
            style={{ background: 'rgba(34,197,94,.15)', borderColor: 'rgba(34,197,94,.25)', color: '#4ADE80' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            <span className="btn-label">Upload</span>
          </button>
        )}

        {/* Botão admin (só visível para super admins) */}
        {isAdmin && (
          <button className="header-admin-btn" onClick={() => setView('admin')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
            Usuários
          </button>
        )}

        {/* Usuário + Logout */}
        <div className="header-user">
          <div className="header-avatar" aria-hidden="true">{userInitial}</div>
          <span className="header-email" title={userEmail}>{userEmail}</span>
          <button
            className="header-logout"
            onClick={() => signOut()}
            aria-label="Sair"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sair
          </button>
        </div>
      </header>

      {error && <div className="msg-error">{error}</div>}

      {loading ? (
        <div className="msg-loading">Carregando…</div>
      ) : (
        <>
          <KpiCards vehicles={vehicles} newPlacas={newPlacas} />
          <FilterBar
            filters={filters}
            arquivos={arquivos}
            categorias={categorias}
            onChange={setFilters}
          />
          <p className="result-count">
            {filtered.length.toLocaleString('pt-BR')} de {vehicles.length.toLocaleString('pt-BR')} veículos
          </p>
          {/* Desktop: tabela completa */}
          <div className="desktop-only">
            <VehicleTable
              vehicles={filtered}
              newPlacas={newPlacas}
              sortKey={sortKey}
              sortDir={sortDir}
              selectedId={selVehicle?.id ?? null}
              onSort={handleSort}
              onRowClick={v => setSelVehicle(v)}
            />
          </div>

          {/* Mobile: cards por veículo */}
          <div className="mobile-only cards-list">
            {filtered.map(v => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                isNew={newPlacas.has(v.placa)}
                onClick={setSelVehicle}
              />
            ))}
            {filtered.length === 0 && (
              <p className="empty-mobile">Nenhum veículo encontrado com estes filtros.</p>
            )}
          </div>

          {selVehicle && (
            <PriceHistory
              vehicle={selVehicle}
              onClose={() => setSelVehicle(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
