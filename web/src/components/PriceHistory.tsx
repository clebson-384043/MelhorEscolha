import { useEffect, useState } from 'react'
import { supabase, TENANT } from '../lib/supabase'
import { fmtR, fmtPct, fmtKm, fmtAno, fmtData } from '../lib/format'
import { calcScore, scoreClass, scoreLabel, scoreBreakdown } from '../lib/score'
import type { Vehicle } from '../types'
import './PriceHistory.css'

interface Point {
  data_ref: string
  portal: number | null
  margem_liq_pct: number | null
  orcamento: number | null
  tem_reparo: boolean
}

interface Props {
  vehicle: Vehicle
  onClose: () => void
}

// ── Análise textual gerada automaticamente ────────────────────────────────
function gerarAnalise(v: Vehicle, score: number): string {
  const margem = v.margem_liq_pct ?? 0
  const km     = v.km ?? 0
  const rep    = v.orcamento ?? 0

  const partes: string[] = []

  if (score >= 75) partes.push('Excelente oportunidade de compra.')
  else if (score >= 55) partes.push('Boa oportunidade, dentro do perfil de interesse.')
  else partes.push('Margem abaixo da média — avalie com cuidado.')

  if (margem >= 30) partes.push(`Desconto líquido de ${fmtPct(margem)} é muito acima da média do estoque.`)
  else if (margem >= 20) partes.push(`Desconto líquido de ${fmtPct(margem)} é competitivo.`)
  else partes.push(`Desconto líquido de ${fmtPct(margem)} está abaixo de 20%.`)

  if (km < 30_000)       partes.push(`KM baixo (${fmtKm(km)}) — veículo conservado.`)
  else if (km < 80_000)  partes.push(`KM moderado (${fmtKm(km)}) — dentro do esperado para o ano.`)
  else                   partes.push(`KM alto (${fmtKm(km)}) — pesa negativamente no score.`)

  if (!v.tem_reparo) {
    partes.push('Sem custo de reparo — o desconto bruto é o ganho real.')
  } else {
    const impacto = v.margem_bruta ? Math.round((rep / v.margem_bruta) * 100) : 0
    partes.push(
      `Reparo de ${fmtR(rep)} consome ${impacto}% do desconto bruto — ` +
      (impacto > 60 ? 'impacto alto, avaliar bem o custo.' : 'ainda deixa boa margem líquida.')
    )
  }

  return partes.join(' ')
}

// ── Mini gráfico SVG ──────────────────────────────────────────────────────
function MiniChart({ data, color }: { data: { x: string; y: number }[]; color: string }) {
  if (data.length < 2) return (
    <p className="ph-single">Gráfico disponível a partir do 2º dia de dados.</p>
  )
  const W = 520, H = 100, PL = 64, PR = 12, PT = 10, PB = 28
  const ys = data.map(d => d.y)
  const minY = Math.min(...ys), maxY = Math.max(...ys), rangeY = maxY - minY || 1
  const sx = (i: number) => PL + (i / (data.length - 1)) * (W - PL - PR)
  const sy = (y: number) => PT + (1 - (y - minY) / rangeY) * (H - PT - PB)
  const pts = data.map((d, i) => ({ x: sx(i), y: sy(d.y), label: d.x }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const fmtY = (v: number) => v > 1000 ? `R$${(v / 1000).toFixed(0)}k` : `${v.toFixed(1)}%`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ph-svg">
      {[0, 0.5, 1].map(t => {
        const cy = PT + t * (H - PT - PB)
        return (
          <g key={t}>
            <line x1={PL} y1={cy} x2={W - PR} y2={cy} stroke="#F1F5F9" strokeWidth="1"/>
            <text x={PL - 4} y={cy + 3.5} textAnchor="end" fontSize="9" fill="#94A3B8">
              {fmtY(maxY - t * rangeY)}
            </text>
          </g>
        )
      })}
      <path d={`${path} L${pts[pts.length-1].x},${H-PB} L${pts[0].x},${H-PB} Z`}
            fill={color} opacity=".1"/>
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round"/>
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill={color} stroke="#fff" strokeWidth="1.5"/>
          {(i === 0 || i === pts.length - 1) && (
            <text x={p.x} y={H - PB + 14} textAnchor="middle" fontSize="9" fill="#64748B">
              {fmtData(p.label).slice(0, 5)}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

// ── Barra de score ────────────────────────────────────────────────────────
function ScoreBar({ label, value, max, color }: {
  label: string; value: number; max: number; color: string
}) {
  const pct = Math.round((value / max) * 100)
  return (
    <div className="ph-sbar">
      <span className="ph-sbar-label">{label}</span>
      <div className="ph-sbar-track">
        <div className="ph-sbar-fill" style={{ width: `${pct}%`, background: color }}/>
      </div>
      <span className="ph-sbar-val">{value}/{max}</span>
    </div>
  )
}

// ── Linha da cascata financeira ───────────────────────────────────────────
function WaterfallRow({ label, value, pct, variant = 'normal' }: {
  label: string; value: number | null; pct?: number | null
  variant?: 'total' | 'deduct' | 'normal' | 'result'
}) {
  return (
    <div className={`ph-wf-row ph-wf-${variant}`}>
      <span className="ph-wf-label">{label}</span>
      <span className="ph-wf-value">
        {fmtR(value)}
        {pct != null && <span className="ph-wf-pct"> ({fmtPct(pct)})</span>}
      </span>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────
export default function PriceHistory({ vehicle: v, onClose }: Props) {
  const [history, setHistory] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('veiculos_snapshot')
      .select('data_ref,portal,margem_liq_pct,orcamento,tem_reparo')
      .eq('tenant_id', TENANT)
      .eq('placa', v.placa)
      .order('data_ref', { ascending: true })
      .then(({ data }) => { setHistory((data ?? []) as Point[]); setLoading(false) })
  }, [v.placa])

  const score = calcScore(v)
  const bd    = scoreBreakdown(v)
  const sCls  = scoreClass(score)
  const sLbl  = scoreLabel(score)
  const analise = gerarAnalise(v, score)

  const portalData = history.map(d => ({ x: d.data_ref, y: d.portal ?? 0 }))
  const margemData = history.map(d => ({ x: d.data_ref, y: d.margem_liq_pct ?? 0 }))

  const trend = (() => {
    if (history.length < 2) return null
    const delta = (history[history.length-1].portal ?? 0) - (history[0].portal ?? 0)
    if (delta < -500)  return { cls: 'down', txt: `↓ Preço caindo ${fmtR(Math.abs(delta))} — comprar agora!` }
    if (delta > 500)   return { cls: 'up',   txt: `↑ Preço subindo ${fmtR(delta)}` }
    return { cls: 'flat', txt: '→ Preço estável' }
  })()

  return (
    <>
      <div className="ph-backdrop" onClick={onClose}/>
      <aside className="ph-panel">

        {/* Cabeçalho */}
        <div className="ph-header">
          <div className="ph-header-info">
            <span className="ph-placa">{v.placa}</span>
            <h2 className="ph-modelo">{v.modelo}</h2>
            <p className="ph-specs">
              {fmtAno(v.ano_fab, v.ano_mod)}
              {v.km   != null && ` · ${fmtKm(v.km)}`}
              {v.cor  && ` · ${v.cor}`}
              {v.categoria && ` · ${v.categoria}`}
            </p>
          </div>
          <button className="ph-close" onClick={onClose} aria-label="Fechar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                 strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="ph-body">

          {/* Score + análise */}
          <div className="ph-score-block">
            <div className="ph-score-left">
              <div className={`ph-score-num ${sCls}`}>{score}</div>
              <div className="ph-score-lbl">{sLbl}</div>
            </div>
            <p className="ph-analise">{analise}</p>
          </div>

          {/* Breakdown do score */}
          <div className="ph-section">
            <h3>Composição do score</h3>
            <ScoreBar label="Desconto líquido" value={bd.margem} max={50} color="#1D4ED8"/>
            <ScoreBar label="Quilometragem"    value={bd.km}     max={30} color="#7C3AED"/>
            <ScoreBar label="Custo de reparo"  value={bd.reparo} max={20} color="#059669"/>
          </div>

          {/* Cascata financeira */}
          <div className="ph-section">
            <h3>Análise financeira</h3>
            <div className="ph-waterfall">
              <WaterfallRow label="FPE (preço de referência)" value={v.fpe} variant="normal"/>
              <WaterfallRow label="(−) Desconto bruto" value={v.margem_bruta ? -v.margem_bruta : null}
                            pct={v.margem_pct} variant="deduct"/>
              <WaterfallRow label="= Preço de compra (Portal)" value={v.portal} variant="total"/>
              {v.tem_reparo && (
                <WaterfallRow label="(−) Custo de reparo" value={v.orcamento ? -v.orcamento : null}
                              variant="deduct"/>
              )}
              <WaterfallRow label="= GANHO LÍQUIDO" value={v.margem_liq}
                            pct={v.margem_liq_pct} variant="result"/>
            </div>
          </div>

          {/* Localização */}
          <div className="ph-section">
            <h3>Onde está</h3>
            <div className="ph-info-grid">
              <div><span>Pátio</span><strong>{v.patio_nome ?? v.patio}</strong></div>
              <div><span>UF</span><strong>{v.uf ?? '—'}</strong></div>
              <div><span>Cor</span><strong>{v.cor ?? '—'}</strong></div>
              <div><span>Categoria</span><strong>{v.categoria ?? '—'}</strong></div>
            </div>
          </div>

          {/* Histórico */}
          {!loading && (
            <>
              {trend && (
                <div className={`ph-trend ph-trend-${trend.cls}`}>{trend.txt}</div>
              )}

              <div className="ph-section">
                <h3>Histórico do preço de compra</h3>
                <MiniChart data={portalData} color="#1D4ED8"/>
              </div>

              <div className="ph-section">
                <h3>Histórico do desconto líquido (%)</h3>
                <MiniChart data={margemData} color="#059669"/>
              </div>

              {history.length > 1 && (
                <div className="ph-section">
                  <h3>Tabela de histórico</h3>
                  <table className="ph-table">
                    <thead>
                      <tr><th>Data</th><th>Preço</th><th>Desc líq</th><th>Reparo</th></tr>
                    </thead>
                    <tbody>
                      {[...history].reverse().map(d => (
                        <tr key={d.data_ref}>
                          <td>{fmtData(d.data_ref)}</td>
                          <td>{fmtR(d.portal)}</td>
                          <td className="green">{fmtPct(d.margem_liq_pct)}</td>
                          <td>{d.tem_reparo ? fmtR(d.orcamento) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {history.length === 1 && (
                <p className="ph-single">
                  Histórico de variação disponível a partir do 2º dia de ingestão.
                </p>
              )}
            </>
          )}

          {loading && <div className="ph-loading">Carregando dados…</div>}
        </div>
      </aside>
    </>
  )
}
