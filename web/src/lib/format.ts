export function fmtR(v: number | null | undefined): string {
  if (v == null) return '—'
  return 'R$ ' + Math.round(v).toLocaleString('pt-BR')
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—'
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')
  return s + '%'
}

export function fmtKm(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR') + ' km'
}

export function fmtAno(fab: number | null, mod: number | null): string {
  if (!fab) return ''
  const m = mod ? String(mod).slice(-2) : '?'
  return `${fab}/${m}`
}

export function fmtData(iso: string): string {
  // "2026-06-25" → "25/06/2026"
  return iso.split('-').reverse().join('/')
}

/** Classe CSS para colorir a célula de margem líquida. */
export function margemClass(pct: number | null | undefined): string {
  if (pct == null) return 'mg-none'
  if (pct >= 20) return 'mg-high'
  if (pct >= 15) return 'mg-mid'
  return 'mg-low'
}
