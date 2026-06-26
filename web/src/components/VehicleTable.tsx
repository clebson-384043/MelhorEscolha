import { Vehicle, SortKey, SortDir } from '../types'
import { fmtR, fmtPct, fmtKm, fmtAno, margemClass } from '../lib/format'
import { calcScore, scoreClass, scoreLabel, scoreBreakdown } from '../lib/score'

interface Props {
  vehicles: Vehicle[]
  newPlacas: Set<string>
  sortKey: SortKey
  sortDir: SortDir
  selectedId: number | null
  onSort: (key: SortKey) => void
  onRowClick: (v: Vehicle) => void
}

type Col = { key: SortKey; label: string; sub?: string; align?: 'right' }

const SORT_COLS: Col[] = [
  { key: 'score',          label: 'Score',        sub: 'oportunidade',   align: 'right' },
  { key: 'modelo',         label: 'Modelo'                                               },
  { key: 'portal',         label: 'Preço',        sub: 'de compra',      align: 'right' },
  { key: 'margem_liq_pct', label: 'Desc. líq',    sub: '% real',         align: 'right' },
  { key: 'margem_pct',     label: 'Desc. bruto',  sub: '% antes reparo', align: 'right' },
  { key: 'patio_nome',     label: 'Pátio'                                                },
  { key: 'km',             label: 'KM',           sub: 'quilometragem',  align: 'right' },
]

function Th({ col, sortKey, sortDir, onSort }: {
  col: Col; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void
}) {
  const active = sortKey === col.key
  const arrow  = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <th
      className={['sortable', col.align ?? '', active ? 'active' : ''].join(' ')}
      onClick={() => onSort(col.key)}
    >
      <span className="th-main">{col.label}{arrow}</span>
      {col.sub && <span className="th-sub">{col.sub}</span>}
    </th>
  )
}

function buildTooltip(v: Vehicle, score: number) {
  const bd  = scoreBreakdown(v)
  const lbl = scoreLabel(score)
  const bar = (n: number, max: number) =>
    '█'.repeat(Math.round((n / max) * 8)).padEnd(8, '░')
  return [
    `${score}/100 — ${lbl}`,
    '',
    `Margem líq  ${bar(bd.margem, 50)}  ${bd.margem}/50 pts`,
    `KM          ${bar(bd.km,     30)}  ${bd.km}/30 pts`,
    `Reparo      ${bar(bd.reparo, 20)}  ${bd.reparo}/20 pts`,
  ].join('\n')
}

const IconDetail = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
       style={{ width: 14, height: 14 }}>
    <path d="M7 10h6M10 7l3 3-3 3"/>
  </svg>
)

/*
  ORDEM DAS COLUNAS (header e body devem estar em sincronia):
  1. Badge   2. Placa   3. Score   4. Modelo
  5. FIPE    6. Portal  7. Desc Líq%  8. Desc Bruto%
  9. Pátio  10. Ano/KM  11. Cor  12. Custo Reparo
  13. Ganho R$  14. → (detalhe)
*/
export default function VehicleTable({
  vehicles, newPlacas, sortKey, sortDir, selectedId, onSort, onRowClick,
}: Props) {
  return (
    <div className="table-wrap">
      <table className="vehicle-table">
        <thead>
          <tr>
            {/* 1 */ } <th style={{ width: 42 }}></th>
            {/* 2 */ } <th>Placa</th>
            {/* 3 */ } <Th col={SORT_COLS[0]} sortKey={sortKey} sortDir={sortDir} onSort={onSort}/>
            {/* 4 */ } <Th col={SORT_COLS[1]} sortKey={sortKey} sortDir={sortDir} onSort={onSort}/>
            {/* 5 */ } <th className="right">
                         <span className="th-main">Ano</span>
                         <span className="th-sub">fab / mod</span>
                       </th>
            {/* 6 */ } <Th col={SORT_COLS[6]} sortKey={sortKey} sortDir={sortDir} onSort={onSort}/>
            {/* 7 */ } <th className="right">
                         <span className="th-main">FIPE</span>
                         <span className="th-sub">referência</span>
                       </th>
            {/* 8 */ } <Th col={SORT_COLS[2]} sortKey={sortKey} sortDir={sortDir} onSort={onSort}/>
            {/* 9 */ } <th className="right">Custo reparo</th>
            {/* 10*/}  <Th col={SORT_COLS[3]} sortKey={sortKey} sortDir={sortDir} onSort={onSort}/>
            {/* 11*/}  <Th col={SORT_COLS[4]} sortKey={sortKey} sortDir={sortDir} onSort={onSort}/>
            {/* 12*/}  <Th col={SORT_COLS[5]} sortKey={sortKey} sortDir={sortDir} onSort={onSort}/>
            {/* 13*/}  <th>Cor</th>
            {/* 14*/}  <th className="right">Ganho R$</th>
            {/* 15*/}  <th style={{ width: 36 }}></th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map(v => {
            const isNew      = newPlacas.has(v.placa)
            const mgCls      = margemClass(v.margem_liq_pct)
            const score      = calcScore(v)
            const sCls       = scoreClass(score)
            const isSelected = v.id === selectedId

            return (
              <tr
                key={v.id}
                className={[
                  isNew      ? 'row-new'      : '',
                  isSelected ? 'row-selected' : '',
                ].join(' ')}
                onClick={() => onRowClick(v)}
              >
                {/* 1 — badge */}
                <td className="td-badge">
                  {isNew && <span className="badge-new">NOVO</span>}
                </td>

                {/* 2 — placa */}
                <td className="td-placa">{v.placa}</td>

                {/* 3 — score */}
                <td className="right">
                  <span className={`score-badge ${sCls}`} data-tooltip={buildTooltip(v, score)}>
                    {score}
                  </span>
                </td>

                {/* 4 — modelo */}
                <td className="td-modelo">{v.modelo}</td>

                {/* 5 — ano */}
                <td className="right mono">{fmtAno(v.ano_fab, v.ano_mod)}</td>

                {/* 6 — km */}
                <td className="right mono">{fmtKm(v.km)}</td>

                {/* 7 — FIPE (referência) */}
                <td className="right mono td-fipe">{fmtR(v.fpe)}</td>

                {/* 8 — preço de compra (portal) */}
                <td className="right mono">{fmtR(v.portal)}</td>

                {/* 9 — custo de reparo (logo após o preço) */}
                <td className="right">
                  {v.tem_reparo
                    ? <span className="badge-reparo">{fmtR(v.orcamento)}</span>
                    : <span className="dash">—</span>}
                </td>

                {/* 10 — desconto líquido % */}
                <td className={`right mg-cell ${mgCls}`}>
                  {fmtPct(v.margem_liq_pct)}
                </td>

                {/* 11 — desconto bruto % */}
                <td className="right td-desc-bruto">{fmtPct(v.margem_pct)}</td>

                {/* 12 — pátio */}
                <td>{v.patio_nome}</td>

                {/* 13 — cor */}
                <td className="td-cor">{v.cor ?? '—'}</td>

                {/* 14 — ganho líquido R$ */}
                <td className="right mono td-ganho">{fmtR(v.margem_liq)}</td>

                {/* 15 — ícone de detalhe */}
                <td className="td-detail">
                  <span className="detail-icon"><IconDetail/></span>
                </td>
              </tr>
            )
          })}
          {vehicles.length === 0 && (
            <tr>
              <td colSpan={15} className="empty">Nenhum veículo encontrado.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
