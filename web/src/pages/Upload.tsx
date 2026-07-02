import { useState, useRef, useCallback, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/auth'
import './Upload.css'

interface Resultado {
  arquivo: string
  status: 'ok' | 'aviso' | 'erro' | 'enviando' | 'aguardando'
  veiculos?: number
  alertas?: string[]
  motivo?: string
}

const TENANT_OPTS = [
  { id: 'piloto',      label: 'Estoque Regular' },
  { id: 'lista_morte', label: 'Lista da Morte'  },
]

function hojeISO() { return new Date().toISOString().slice(0, 10) }
function fmtData(d: string) { return d.split('-').reverse().join('/') }

// Remove acentos, espaços e caracteres inválidos para Supabase Storage paths
function sanitizeKey(filename: string): string {
  return filename
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
}

interface Props { session: Session; onBack: () => void }

export default function Upload({ onBack }: Props) {
  const [arquivos, setArquivos]   = useState<File[]>([])
  const [tenantId, setTenantId]   = useState('piloto')
  const [dataRef, setDataRef]     = useState(hojeISO())
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [processando, setProcessando] = useState(false)
  const [erro, setErro]           = useState<string | null>(null)
  const inputRef                  = useRef<HTMLInputElement>(null)

  const [deletando, setDeletando]     = useState(false)
  const [deleteMsg, setDeleteMsg]     = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [datasDisponiveis, setDatasDisponiveis] = useState<{ data_ref: string; veiculos: number; arquivos: number }[]>([])
  const [carregandoDatas, setCarregandoDatas]   = useState(true)

  const addFiles = useCallback((files: FileList | File[]) => {
    const pdfs = [...files].filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    setArquivos(prev => {
      const nomes = new Set(prev.map(f => f.name))
      return [...prev, ...pdfs.filter(f => !nomes.has(f.name))]
    })
  }, [])

  function removeFile(nome: string) {
    setArquivos(prev => prev.filter(f => f.name !== nome))
    setResultados(prev => prev.filter(r => r.arquivo !== nome))
  }

  async function processar() {
    if (!arquivos.length) return
    setProcessando(true)
    setErro(null)
    setResultados(arquivos.map(f => ({ arquivo: f.name, status: 'enviando' })))

    // Processa um arquivo por vez para não estourar o limite de CPU da Edge Function
    let difRodado = false
    for (const file of arquivos) {
      try {
        // 1. Upload para Supabase Storage (nome sanitizado para remover acentos e espaços)
        const safeName = sanitizeKey(file.name)
        const path = `${tenantId}/${dataRef}/${safeName}`
        const { error: upErr } = await supabase.storage.from('pdfs').upload(path, file, { upsert: true })
        if (upErr) throw new Error(`Falha no upload: ${upErr.message}`)

        setResultados(prev => prev.map(r => r.arquivo === file.name ? { ...r, status: 'aguardando' } : r))

        // 2. Chama Edge Function para este arquivo individualmente
        const { data, error: fnErr } = await supabase.functions.invoke('process-pdfs', {
          body: {
            storage_paths: [path],
            tenant_id: tenantId,
            data_ref: dataRef,
            run_diff: !difRodado,  // diff só no primeiro arquivo bem-sucedido
          },
        })

        if (fnErr) throw new Error(fnErr.message)

        const r = data?.resultados?.[0] as Resultado | undefined
        if (r) {
          if (r.status === 'ok' || r.status === 'aviso') difRodado = true
          setResultados(prev => prev.map(p => p.arquivo === file.name
            ? { ...p, status: r.status, veiculos: r.veiculos, alertas: r.alertas, motivo: r.motivo }
            : p
          ))
        }

      } catch (e) {
        setResultados(prev => prev.map(r => r.arquivo === file.name
          ? { ...r, status: 'erro', motivo: String(e) }
          : r
        ))
      }
    }

    setProcessando(false)
  }

  const carregarDatas = useCallback(async () => {
    setCarregandoDatas(true)
    const { data } = await supabase
      .from('processamentos')
      .select('data_ref, veiculos, status')
      .eq('tenant_id', tenantId)
      .order('data_ref', { ascending: false })
    if (data) {
      const map = new Map<string, { veiculos: number; arquivos: number }>()
      for (const row of data) {
        const prev = map.get(row.data_ref) ?? { veiculos: 0, arquivos: 0 }
        map.set(row.data_ref, { veiculos: prev.veiculos + (row.veiculos ?? 0), arquivos: prev.arquivos + 1 })
      }
      setDatasDisponiveis([...map.entries()].map(([data_ref, info]) => ({ data_ref, ...info })))
    }
    setCarregandoDatas(false)
  }, [tenantId])

  useEffect(() => { carregarDatas() }, [carregarDatas])

  async function excluirData(dataRef: string) {
    const dataFmt = fmtData(dataRef)
    if (!window.confirm(`Excluir TODOS os registros de ${dataFmt}?\n\nEsta ação não pode ser desfeita.`)) return
    setDeletando(true)
    setDeleteMsg(null)
    try {
      const { error: e1 } = await supabase.from('veiculos_snapshot').delete().eq('data_ref', dataRef).eq('tenant_id', tenantId)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('eventos_diarios').delete().eq('data_ref', dataRef).eq('tenant_id', tenantId)
      if (e2) throw e2
      const { error: e3 } = await supabase.from('processamentos').delete().eq('data_ref', dataRef).eq('tenant_id', tenantId)
      if (e3) throw e3
      setDeleteMsg({ tipo: 'ok', texto: `Registros de ${dataFmt} excluídos.` })
      setDatasDisponiveis(prev => prev.filter(d => d.data_ref !== dataRef))
    } catch (e) {
      setDeleteMsg({ tipo: 'erro', texto: `Erro: ${(e as { message?: string }).message ?? String(e)}` })
    } finally {
      setDeletando(false)
    }
  }

  const totalOk  = resultados.filter(r => r.status === 'ok' || r.status === 'aviso').length
  const totalVei = resultados.reduce((a, r) => a + (r.veiculos ?? 0), 0)

  return (
    <div className="upload-page">
      <header className="app-header">
        <button className="admin-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Voltar
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 15, fontWeight: 700, color: '#F1F5F9' }}>Upload de PDFs</h1>
          <span className="admin-badge">Processamento</span>
        </div>
      </header>

      <div className="upload-content">
        {/* Configuração */}
        <div className="upload-config">
          <div className="upload-config-item">
            <label>Tenant / Origem</label>
            <div className="upload-tenant-sel">
              {TENANT_OPTS.map(t => (
                <button key={t.id} className={`upload-tenant-btn ${tenantId === t.id ? 'active' : ''}`}
                  onClick={() => setTenantId(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div className="upload-config-item">
            <label>Data de referência</label>
            <input type="date" value={dataRef} onChange={e => setDataRef(e.target.value)}
              className="upload-date-input"/>
            <span className="upload-date-hint">{fmtData(dataRef)}</span>
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={`upload-zone ${processando ? 'disabled' : ''}`}
          onDragOver={e => { e.preventDefault() }}
          onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
          onClick={() => !processando && inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".pdf,application/pdf"
            multiple hidden onChange={e => addFiles(e.target.files ?? [])} />
          <div className="upload-zone-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
          </div>
          <p className="upload-zone-label">Arraste os PDFs aqui ou clique para selecionar</p>
          <p className="upload-zone-hint">Aceita múltiplos arquivos PDF • máx. 20 MB cada</p>
        </div>

        {/* Lista de arquivos */}
        {arquivos.length > 0 && (
          <div className="upload-list">
            <div className="upload-list-header">
              <span>{arquivos.length} arquivo{arquivos.length !== 1 ? 's' : ''} selecionado{arquivos.length !== 1 ? 's' : ''}</span>
              {!processando && <button className="upload-clear" onClick={() => { setArquivos([]); setResultados([]) }}>Limpar todos</button>}
            </div>

            {arquivos.map(f => {
              const res = resultados.find(r => r.arquivo === f.name)
              return (
                <div key={f.name} className={`upload-file ${res?.status ?? ''}`}>
                  <div className="upload-file-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/>
                    </svg>
                  </div>
                  <div className="upload-file-info">
                    <span className="upload-file-name">{f.name}</span>
                    <span className="upload-file-size">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    {res?.veiculos && <span className="upload-file-count">{res.veiculos} veículos</span>}
                    {res?.alertas?.map((a, i) => <span key={i} className="upload-alerta">{a}</span>)}
                    {res?.motivo && <span className="upload-erro-msg">{res.motivo}</span>}
                  </div>
                  <div className="upload-file-status">
                    {!res && !processando && (
                      <button className="upload-remove" onClick={() => removeFile(f.name)}>×</button>
                    )}
                    {res?.status === 'enviando' && <span className="upload-spinner"/>}
                    {res?.status === 'aguardando' && <span className="upload-status aguardando">⟳ processando</span>}
                    {res?.status === 'ok'    && <span className="upload-status ok">✓ OK</span>}
                    {res?.status === 'aviso' && <span className="upload-status aviso">⚠ aviso</span>}
                    {res?.status === 'erro'  && <span className="upload-status erro">✕ erro</span>}
                  </div>
                </div>
              )
            })}

            {/* Resumo após processar */}
            {resultados.length > 0 && resultados.every(r => r.status !== 'enviando' && r.status !== 'aguardando') && (
              <div className="upload-summary">
                <span className="summary-ok">{totalOk} arquivo{totalOk !== 1 ? 's' : ''} processado{totalOk !== 1 ? 's' : ''}</span>
                <span className="summary-vei">{totalVei.toLocaleString('pt-BR')} veículos inseridos</span>
                <span className="summary-hint">Dados já disponíveis no dashboard →</span>
              </div>
            )}
          </div>
        )}

        {erro && <div className="upload-error">{erro}</div>}

        {/* Zona de exclusão por data */}
        <div className="delete-zone">
          <div className="delete-zone-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
            <span>Registros no banco</span>
            <button className="delete-refresh" onClick={carregarDatas} title="Atualizar lista">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          </div>

          {carregandoDatas ? (
            <div className="delete-loading"><span className="upload-spinner small"/> Carregando…</div>
          ) : datasDisponiveis.length === 0 ? (
            <div className="delete-empty">Nenhum registro encontrado.</div>
          ) : (
            <div className="delete-list">
              {datasDisponiveis.map(d => (
                <div key={d.data_ref} className="delete-list-item">
                  <div className="delete-list-info">
                    <span className="delete-list-date">{fmtData(d.data_ref)}</span>
                    <span className="delete-list-meta">
                      {d.veiculos.toLocaleString('pt-BR')} veículos • {d.arquivos} arquivo{d.arquivos !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={() => excluirData(d.data_ref)}
                    disabled={deletando}
                  >
                    {deletando ? <span className="upload-spinner small"/> : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{width:13,height:13}}>
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                      </svg>
                    )}
                    Excluir
                  </button>
                </div>
              ))}
            </div>
          )}

          {deleteMsg && <div className={`delete-msg ${deleteMsg.tipo}`}>{deleteMsg.texto}</div>}
        </div>

        {/* Botão processar */}
        <button
          className="upload-btn"
          disabled={!arquivos.length || processando}
          onClick={processar}
        >
          {processando ? (
            <><span className="upload-spinner small"/> Processando…</>
          ) : (
            <>Processar {arquivos.length > 0 ? `${arquivos.length} arquivo${arquivos.length !== 1 ? 's' : ''}` : 'PDFs'}</>
          )}
        </button>
      </div>
    </div>
  )
}
