import type { Vehicle } from '../types'

/**
 * Score de oportunidade 0–100.
 * Componentes:
 *  - Margem líquida  (0–50 pts): 25%+ = máximo
 *  - KM              (0–30 pts): 0 km = máximo, 150k = 0
 *  - Impacto reparo  (0–20 pts): sem reparo = 20, reparo > bruto = 0
 */
export function calcScore(v: Vehicle): number {
  const sMargem = Math.min(50, Math.max(0, (v.margem_liq_pct ?? 0) * 2))

  const km = v.km ?? 150_000
  const sKm = Math.max(0, 30 - Math.floor(km / 5_000))

  let sReparo = 20
  if (v.tem_reparo && v.margem_bruta && v.margem_bruta > 0) {
    const impacto = (v.orcamento ?? 0) / v.margem_bruta
    sReparo = Math.max(0, Math.round(20 * (1 - impacto)))
  }

  return Math.min(100, Math.round(sMargem + sKm + sReparo))
}

export function scoreClass(n: number) {
  if (n >= 75) return 'score-high'
  if (n >= 55) return 'score-good'
  if (n >= 35) return 'score-ok'
  return 'score-low'
}

export function scoreLabel(n: number) {
  if (n >= 75) return 'Excelente'
  if (n >= 55) return 'Bom'
  if (n >= 35) return 'Ok'
  return 'Fraco'
}

/** Detalhamento dos componentes para o tooltip. */
export function scoreBreakdown(v: Vehicle): { margem: number; km: number; reparo: number } {
  const margem = Math.min(50, Math.max(0, Math.round((v.margem_liq_pct ?? 0) * 2)))
  const km     = Math.max(0, 30 - Math.floor((v.km ?? 150_000) / 5_000))
  let reparo   = 20
  if (v.tem_reparo && v.margem_bruta && v.margem_bruta > 0) {
    reparo = Math.max(0, Math.round(20 * (1 - (v.orcamento ?? 0) / v.margem_bruta)))
  }
  return { margem, km, reparo }
}
