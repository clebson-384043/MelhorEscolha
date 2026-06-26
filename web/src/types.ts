export interface Vehicle {
  id: number
  tenant_id: string
  data_ref: string
  arquivo: string
  patio: string
  patio_nome: string | null
  placa: string
  modelo: string | null
  categoria: string | null
  ano_fab: number | null
  ano_mod: number | null
  km: number | null
  cor: string | null
  uf: string | null
  orcamento: number | null
  fpe: number | null
  margem_bruta: number | null
  portal: number | null
  margem_pct: number | null
  margem_liq: number | null
  margem_liq_pct: number | null
  tem_reparo: boolean
}

export interface Filters {
  busca: string
  margemMin: string
  arquivo: string    // filtro por documento (PDF de origem)
  precoMax: string
  categoria: string
  somenteNovos: boolean
}

// Colunas que o usuário pode usar para ordenar
export type SortKey =
  | 'score'
  | 'modelo'
  | 'portal'
  | 'margem_pct'
  | 'margem_liq_pct'
  | 'km'
  | 'patio_nome'

export type SortDir = 'asc' | 'desc'
