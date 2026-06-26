import { Vehicle } from '../types'
import { fmtPct } from '../lib/format'

interface Props {
  vehicles: Vehicle[]
  newPlacas: Set<string>
}

export default function KpiCards({ vehicles, newPlacas }: Props) {
  const total = vehicles.length
  const margem20 = vehicles.filter(v => (v.margem_liq_pct ?? 0) >= 20).length
  const novos = newPlacas.size
  const maiorMargem = vehicles.reduce<number | null>((acc, v) =>
    v.margem_liq_pct != null && (acc == null || v.margem_liq_pct > acc)
      ? v.margem_liq_pct : acc, null)

  return (
    <div className="kpi-grid">
      <div className="kpi-card">
        <div className="kpi-label">Total de veículos</div>
        <div className="kpi-value">{total.toLocaleString('pt-BR')}</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-label">Margem líq ≥ 20%</div>
        <div className="kpi-value green">{margem20.toLocaleString('pt-BR')}</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-label">Novidades hoje</div>
        <div className="kpi-value blue">{novos.toLocaleString('pt-BR')}</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-label">Maior margem líquida</div>
        <div className="kpi-value green">{fmtPct(maiorMargem)}</div>
      </div>
    </div>
  )
}
