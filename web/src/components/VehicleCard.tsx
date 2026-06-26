import { Vehicle } from '../types'
import { fmtR, fmtPct, fmtKm, fmtAno, margemClass } from '../lib/format'
import { calcScore, scoreClass } from '../lib/score'

interface Props {
  vehicle: Vehicle
  isNew: boolean
  onClick: (v: Vehicle) => void
}

export default function VehicleCard({ vehicle: v, isNew, onClick }: Props) {
  const score = calcScore(v)
  const sCls  = scoreClass(score)
  const mgCls = margemClass(v.margem_liq_pct)

  return (
    <div
      className={`vcard ${isNew ? 'vcard-new' : ''}`}
      onClick={() => onClick(v)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(v)}
      aria-label={`Ver detalhes de ${v.modelo}`}
    >
      {/* Linha 1: placa + score + margem */}
      <div className="vcard-top">
        <div className="vcard-top-left">
          {isNew && <span className="badge-new">NOVO</span>}
          <span className="vcard-placa">{v.placa}</span>
          <span className={`score-badge ${sCls}`}>{score}</span>
        </div>
        <div className={`vcard-margem mg-cell ${mgCls}`}>
          {fmtPct(v.margem_liq_pct)}
        </div>
      </div>

      {/* Modelo */}
      <div className="vcard-modelo">{v.modelo}</div>

      {/* Pátio + Ano/KM */}
      <div className="vcard-meta">
        <span className="vcard-patio">{v.patio_nome}</span>
        <span className="vcard-anokm">
          {fmtAno(v.ano_fab, v.ano_mod)} · {fmtKm(v.km)}
        </span>
      </div>

      {/* Financeiro */}
      <div className="vcard-finance">
        <div className="vcard-fin-item">
          <span>Preço de compra</span>
          <strong>{fmtR(v.portal)}</strong>
        </div>
        <div className="vcard-fin-item">
          <span>Ganho líquido</span>
          <strong className="green">{fmtR(v.margem_liq)}</strong>
        </div>
        {v.tem_reparo && (
          <div className="vcard-fin-item">
            <span>Custo reparo</span>
            <span className="badge-reparo">{fmtR(v.orcamento)}</span>
          </div>
        )}
      </div>

      <div className="vcard-hint">Toque para ver análise completa →</div>
    </div>
  )
}
