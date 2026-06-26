import { Filters } from '../types'

interface Props {
  filters: Filters
  arquivos: string[]        // nomes dos PDFs de origem
  categorias: (string | null)[]
  onChange: (f: Filters) => void
}

function fmtArquivo(nome: string): string {
  // Remove extensão .pdf e sufixos de data comuns para exibição limpa
  return nome.replace(/\.pdf$/i, '').replace(/_?\d{4}[-_]\d{2}[-_]\d{2}$/, '').replace(/_?\d{8}$/, '') || nome
}

export default function FilterBar({ filters, arquivos, categorias, onChange }: Props) {
  function set(patch: Partial<Filters>) {
    onChange({ ...filters, ...patch })
  }

  const hasFilter = filters.busca || filters.margemMin || filters.arquivo ||
                    filters.precoMax || filters.categoria || filters.somenteNovos

  return (
    <div className="filter-bar">
      <input
        type="text"
        placeholder="Buscar modelo ou placa…"
        value={filters.busca}
        onChange={e => set({ busca: e.target.value })}
      />
      <input
        type="number"
        placeholder="Margem líq mín %"
        value={filters.margemMin}
        onChange={e => set({ margemMin: e.target.value })}
        min={0} max={100}
      />
      <input
        type="number"
        placeholder="Preço máx R$"
        value={filters.precoMax}
        onChange={e => set({ precoMax: e.target.value })}
        min={0}
      />
      <select value={filters.arquivo} onChange={e => set({ arquivo: e.target.value })}>
        <option value="">Todos os documentos</option>
        {arquivos.map(a => (
          <option key={a} value={a}>{fmtArquivo(a)}</option>
        ))}
      </select>
      <select value={filters.categoria} onChange={e => set({ categoria: e.target.value })}>
        <option value="">Todas as categorias</option>
        {categorias.filter(Boolean).map(c => (
          <option key={c!} value={c!}>{c}</option>
        ))}
      </select>
      <label className="filter-check">
        <input
          type="checkbox"
          checked={filters.somenteNovos}
          onChange={e => set({ somenteNovos: e.target.checked })}
        />
        Só novos
      </label>
      {hasFilter && (
        <button
          className="btn-clear"
          onClick={() => onChange({ busca: '', margemMin: '', arquivo: '', precoMax: '', categoria: '', somenteNovos: false })}
        >
          Limpar filtros
        </button>
      )}
    </div>
  )
}
