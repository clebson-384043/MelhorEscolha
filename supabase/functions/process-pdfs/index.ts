/**
 * process-pdfs — Edge Function que processa PDFs de estoque.
 * Replica toda a lógica do parser.py e ingest.py em TypeScript.
 * Roda no servidor Supabase (Deno), sem dependência de Python local.
 *
 * Deploy: supabase functions deploy process-pdfs
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// unpdf = wrapper de pdfjs-dist sem dependências nativas (funciona em Deno/Edge)
import { getDocumentProxy } from 'https://esm.sh/unpdf@0.10.1'

// ── Tipagem ────────────────────────────────────────────────────────────────

interface Veiculo {
  patio: string; patio_nome: string; placa: string; modelo: string
  categoria: string | null; ano_fab: number | null; ano_mod: number | null
  km: number | null; cor: string; uf: string
  orcamento: number | null; fpe: number | null; margem: number | null
  portal: number | null; margem_pct: number | null
  margem_liq: number | null; margem_liq_pct: number | null
  tem_reparo: boolean
}

// ── Mapeamento de pátios ───────────────────────────────────────────────────

const PATIO_NOME: Record<string, string> = {
  VCANT: 'Antonio Carlos', VCEBH: 'Pátio Contagem', VCPSB: 'Via Shopping',
  VCPGM: 'Shopping Contagem', VCPSI: 'Shopping Cidade', VCBET: 'Betim',
  VCBHZ: 'BH', VCCMA: 'Contagem', VCLEX: 'Lexus', VCSMS: 'Sumaré', VCVNO: 'Venda Nova',
}

const CATEGORIAS = [
  'SUV COMPACTO','PICAPE GRANDE','UTILITÁRIO GRANDE','UTILITÁRIO COMPACTO',
  'INTERMEDIÁRIO','EXECUTIVO','BÁSICO','PREMIUM',
]

// ── Utilitários de limpeza ─────────────────────────────────────────────────

function limpaDinheiro(s: string | null | undefined): number | null {
  if (!s) return null
  const t = s.replace(/R\$/g,'').replace(/\s+/g,'').trim()
  if (!t || t === '-' || t === '#DIV/0!') return null
  const neg = t.startsWith('-'); const v = t.replace('-','')
  // /\./g remove TODOS os pontos (separadores de milhar em pt-BR)
  const n = parseFloat(v.replace(/\./g,'').replace(',','.'))
  return isNaN(n) ? null : (neg ? -n : n)
}

// Funde células "R$" isoladas com a célula seguinte (alguns PDFs separam o símbolo do valor)
function normalizeRow(row: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < row.length; i++) {
    if (row[i].trim() === 'R$' && i + 1 < row.length) {
      result.push('R$ ' + row[i + 1].trim())
      i++
    } else {
      result.push(row[i])
    }
  }
  return result
}

function limpaInt(s: string | null | undefined): number | null {
  if (!s) return null
  const t = s.replace(/\D/g,'')
  return t ? parseInt(t, 10) : null
}

function separaCategoria(c3: string, c4: string): [string | null, number | null, number | null] {
  const junto = (c3 + c4).replace(/\s/g, '')
  const digitos = junto.replace(/\D/g,'')
  let ano_fab: number | null = null, ano_mod: number | null = null
  if (digitos.length >= 8) {
    ano_fab = parseInt(digitos.slice(0,4)); ano_mod = parseInt(digitos.slice(4,8))
  } else if (digitos.length === 4) {
    ano_fab = ano_mod = parseInt(digitos)
  }
  const letras = junto.replace(/[\d]/g,'').toUpperCase()
    .replace(/Ç/g,'C').replace(/Á/g,'A').replace(/Í/g,'I').replace(/Ó/g,'O').replace(/Ú/g,'U')
  let categoria: string | null = null
  for (const cat of CATEGORIAS) {
    const k = cat.replace(/\s/g,'').replace(/Ç/g,'C').replace(/Á/g,'A').replace(/Í/g,'I').replace(/Ó/g,'O').replace(/Ú/g,'U')
    if (k === letras) { categoria = cat; break }
  }
  if (!categoria) {
    for (const cat of CATEGORIAS) {
      const k = cat.replace(/\s/g,'').replace(/Ç/g,'C').replace(/Á/g,'A').slice(0,5)
      if (letras.startsWith(k)) { categoria = cat; break }
    }
  }
  return [(categoria ?? c3) || null, ano_fab, ano_mod]
}

// ── Extração de tabela do PDF ──────────────────────────────────────────────

async function extraiTabela(buffer: ArrayBuffer): Promise<string[][]> {
  const doc = await getDocumentProxy(new Uint8Array(buffer))
  const linhas: string[][] = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const items = content.items as Array<{ str: string; transform: number[]; width?: number }>

    if (!items.length) continue

    // Snap Y em múltiplos de 4 para agrupamento inicial
    const grupos = new Map<number, Array<{ str: string; x: number; w: number }>>()
    for (const it of items) {
      const s = it.str
      if (!s.trim()) continue
      const ySnap = Math.round(it.transform[5] / 4) * 4
      if (!grupos.has(ySnap)) grupos.set(ySnap, [])
      grupos.get(ySnap)!.push({
        str: s,
        x: it.transform[4],
        w: it.width ?? s.length * 5,
      })
    }

    // Mescla grupos Y adjacentes dentro de 5px (baseline variável dentro de uma linha)
    const ysOrdenados = [...grupos.keys()].sort((a, b) => b - a)
    const mesclados = new Map<number, Array<{ str: string; x: number; w: number }>>()
    let repY = ysOrdenados[0]
    for (const y of ysOrdenados) {
      if (repY - y > 5) repY = y
      if (!mesclados.has(repY)) mesclados.set(repY, [])
      mesclados.get(repY)!.push(...grupos.get(y)!)
    }

    // Gera células por linha mesclada
    const linhasOrdenadas = [...mesclados.entries()].sort((a, b) => b[0] - a[0])
    console.log(`[extraiTabela p${p}] ${linhasOrdenadas.length} linhas brutas`)

    for (const [, grp] of linhasOrdenadas) {
      const sorted = grp.sort((a, b) => a.x - b.x)

      // Constrói células: gap > 8px entre itens = nova célula
      const celulas: string[] = []
      let cel = ''
      let xFim = -9999

      for (const it of sorted) {
        const gap = it.x - xFim
        if (cel === '' || gap <= 8) {
          cel += it.str
        } else {
          const t = cel.trim()
          if (t) celulas.push(t)
          cel = it.str
        }
        xFim = it.x + it.w
      }
      const last = cel.trim()
      if (last) celulas.push(last)

      if (celulas.length >= 6) {
        const joined = celulas.join(' ')
        const temPlaca = /[A-Z]{3}\d/.test(joined)
        const temValor = /R\$/.test(joined) || /%/.test(joined)
        if (temPlaca || temValor) linhas.push(celulas)
      }
    }
  }
  console.log(`[extraiTabela] total linhas válidas: ${linhas.length}`)
  return linhas
}

// ── Helpers do parser ─────────────────────────────────────────────────────

// Extrai km e cor de célula fundida: "13027PRATA SHARK" → [13027, "PRATA SHARK"]
function extraiKmCor(s: string): [number | null, string] {
  const mKm = s.match(/^(\d+)/)
  const km = mKm ? parseInt(mKm[1]) : null
  const rest = mKm ? s.slice(mKm[1].length) : s
  const mAddr = rest.match(/^(.*?)\s+(?:AV(?:ENIDA)?|RUA|ROD(?:OVIA)?|AL(?:AMEDA)?|ESTR(?:ADA)?|TRAVESSA|TV)\b/i)
  const cor = (mAddr ? mAddr[1] : rest.slice(0, 30)).trim()
  return [km, cor]
}

// Extrai múltiplos valores de célula fundida: "R$X,XXR$Y,YYR$" → [X, Y]
function extraiFinanceiros(blob: string): number[] {
  return blob.split('R$').map(s => limpaDinheiro(s.trim())).filter(v => v !== null) as number[]
}

// ── Parser principal ───────────────────────────────────────────────────────

function parseLinhas(linhas: string[][], arquivo: string): { registros: Veiculo[], alertas: string[] } {
  const registros: Veiculo[] = []
  const alertas: string[] = []
  let cFiltro = 0, cPlaca = 0, cLen = 0

  // Log das primeiras 5 linhas brutas para diagnóstico de estrutura
  for (let di = 0; di < Math.min(5, linhas.length); di++) {
    console.log(`[parse-raw ${arquivo}] row${di}(${linhas[di].length}):`, JSON.stringify(linhas[di]))
  }

  for (const rawRow of linhas) {
    const row = normalizeRow(rawRow)
    const col0 = (row[0] ?? '').trim()
    if (!col0 || col0 === 'PÁTIO' || col0 === 'PATÍO') { cFiltro++; continue }
    if (row.length < 6) { cLen++; continue }

    // Busca placa em QUALQUER posição — aceita célula exata ou fundida com modelo
    // Ex. fundida: "ABC1234FIAT UNO" quando gap ≤8px funde as duas colunas
    let placaIdx = -1
    let placaExtraida = ''
    for (let i = 0; i < row.length; i++) {
      const c = (row[i] ?? '').trim()
      // Caso 1: célula é exatamente a placa (7 chars)
      if (/^[A-Z]{3}[\dA-Z]{4}$/.test(c) && /\d/.test(c)) {
        placaIdx = i; placaExtraida = c; break
      }
      // Caso 2: placa fundida com modelo ("ABC1234FIAT UNO" ou "ABC1D23 FIAT")
      const mFused = c.match(/^([A-Z]{3}[\dA-Z]{4})\s*([A-Z].+)$/)
      if (mFused && /\d/.test(mFused[1])) {
        row.splice(i, 1, mFused[1], mFused[2].trim())  // separa in-place
        placaIdx = i; placaExtraida = mFused[1]; break
      }
    }
    if (placaIdx < 0) {
      cPlaca++
      if (cPlaca <= 5) console.log(`[parse-semPlaca ${arquivo}] row(${row.length}):`, JSON.stringify(row))
      continue
    }
    console.log(`[parse-ok ${arquivo}] placaIdx=${placaIdx} placa=${placaExtraida} row(${row.length}):`, JSON.stringify(row.slice(0, placaIdx + 3)))

    let patioCod: string, patioNome: string, r: string[]

    if (placaIdx === 0) {
      // ── Formato B: sem coluna de pátio (relatórios multi-pátio/atacado)
      r = row
      patioCod = 'MULTI'
      patioNome = arquivo.replace(/\.[^.]+$/, '').replace(/_/g, ' ').slice(0, 60)
    } else {
      // ── Formato A: pátio na posição placaIdx-1
      r = placaIdx === 1 ? row : row.slice(placaIdx - 1)
      patioCod = (r[0] ?? '').trim()
      patioNome = PATIO_NOME[patioCod] ?? patioCod
    }

    const placa = placaIdx === 0 ? placaExtraida : (r[1] ?? '').trim()
    if (!/^[A-Z]{3}\d/.test(placa)) continue

    let modelo: string
    let categoria: string | null, ano_fab: number | null, ano_mod: number | null
    let km: number | null, cor: string, uf: string
    let orcamento: number | null, fpe: number | null, margem: number | null
    let portal: number | null, margem_pct: number | null

    if (placaIdx === 0) {
      // ── Formato B: parse esquerda + direita ─────────────────────────────
      // Esquerda: placa[0], modelo[1], categoria+ano_fab[2], ano_mod[3], km+cor[4]
      modelo = (r[1] ?? '').trim()
      ;[categoria, ano_fab, ano_mod] = separaCategoria(r[2] ?? '', r[3] ?? '')
      ;[km, cor] = extraiKmCor(r[4] ?? '')

      // Direita: last=%, last-1=portal, last-2=blob(orc+fpe+margem)
      const last = r.length - 1
      const pctStr = (r[last] ?? '').trim()
      margem_pct = pctStr.includes('%') ? (parseInt(pctStr) || null) : null
      portal = limpaDinheiro(r[last - 1])
      const vals = extraiFinanceiros(r[last - 2] ?? '')
      // Blob tem de 1 a 3 valores; sem orcamento quando só 2
      orcamento = vals.length >= 3 ? vals[0] : null
      fpe       = vals.length >= 3 ? vals[1] : vals.length >= 2 ? vals[0] : null
      margem    = vals.length >= 3 ? vals[2] : vals.length >= 2 ? vals[1] : vals[0] ?? null

      // UF: célula de 2 letras maiúsculas entre last-3 e last-6
      uf = ''
      for (let i = last - 3; i >= Math.max(5, last - 6); i--) {
        const c = (r[i] ?? '').trim()
        if (/^[A-Z]{2}$/.test(c)) { uf = c; break }
      }
    } else {
      // ── Formato A: índices fixos ─────────────────────────────────────────
      modelo = (r[2] ?? '').trim()
      ;[categoria, ano_fab, ano_mod] = separaCategoria(r[3] ?? '', r[4] ?? '')

      if (ano_fab && ano_fab === ano_mod) {
        const ano5 = limpaInt(r[5])
        if (ano5 && ano5 >= 2000 && ano5 <= 2035) ano_mod = ano5
      }

      const ext = r.length >= 18
      const [km_i, cor_i, uf_i] = ext ? [6, 7, 12] : [6, 7, 8]
      const [orc_i, fpe_i, mg_i, portal_i, pct_i] = ext ? [13, 14, 15, 16, 17] : [9, 10, 11, 12, 13]

      km        = limpaInt(r[km_i])
      cor       = (r[cor_i] ?? '').trim()
      uf        = (r[uf_i] ?? '').trim()
      orcamento = limpaDinheiro(r[orc_i])
      fpe       = limpaDinheiro(r[fpe_i])
      margem    = limpaDinheiro(r[mg_i])
      portal    = limpaDinheiro(r[portal_i])
      const pctStr = (r[pct_i] ?? '').trim()
      margem_pct = pctStr.includes('%') ? limpaInt(pctStr.replace('%', '')) : null
    }

    const margem_liq = margem != null ? margem - (orcamento ?? 0) : null
    const margem_liq_pct = margem_liq != null && portal
      ? parseFloat((margem_liq / portal * 100).toFixed(1))
      : null

    registros.push({
      patio: patioCod, patio_nome: patioNome,
      placa, modelo, categoria, ano_fab, ano_mod, km, cor, uf,
      orcamento, fpe, margem, portal, margem_pct,
      margem_liq, margem_liq_pct,
      tem_reparo: orcamento != null,
    })
  }

  console.log(`[parse-resumo ${arquivo}] total=${linhas.length} filtro=${cFiltro} semPlaca=${cPlaca} curto=${cLen} ok=${registros.length}`)
  if (registros.length === 0) alertas.push(`${arquivo}: nenhum registro extraído`)
  return { registros, alertas }
}

// ── Validação (§7) ─────────────────────────────────────────────────────────

function valida(registros: Veiculo[], arquivo: string): { ok: boolean; motivo?: string; avisos: string[] } {
  const avisos: string[] = []
  if (registros.length === 0) return { ok: false, motivo: `${arquivo}: 0 veículos`, avisos }
  const comPortal = registros.filter(r => r.portal != null).length
  if (comPortal / registros.length < 0.80)
    return { ok: false, motivo: `${arquivo}: apenas ${Math.round(comPortal/registros.length*100)}% com PORTAL preenchido`, avisos }
  return { ok: true, avisos }
}

// ── Diff ───────────────────────────────────────────────────────────────────

async function rodaDiff(admin: ReturnType<typeof createClient>, tenantId: string, dataRef: string) {
  const hoje = await admin.from('veiculos_snapshot')
    .select('placa,portal,orcamento,modelo,patio_nome')
    .eq('tenant_id', tenantId).eq('data_ref', dataRef)
  if (!hoje.data?.length) return

  // Última data anterior
  const ant = await admin.from('veiculos_snapshot')
    .select('data_ref').eq('tenant_id', tenantId).lt('data_ref', dataRef)
    .order('data_ref', { ascending: false }).limit(1)
  if (!ant.data?.length) return

  const ontem = await admin.from('veiculos_snapshot')
    .select('placa,portal,orcamento,modelo,patio_nome')
    .eq('tenant_id', tenantId).eq('data_ref', ant.data[0].data_ref)

  const hMap = new Map((hoje.data ?? []).map(r => [r.placa, r]))
  const oMap = new Map((ontem.data ?? []).map(r => [r.placa, r]))
  const eventos: object[] = []

  for (const [placa, h] of hMap) {
    if (!oMap.has(placa))
      eventos.push({ tenant_id: tenantId, data_ref: dataRef, placa, tipo: 'novo', valor_novo: h.portal, modelo: h.modelo, patio_nome: h.patio_nome })
    else {
      const o = oMap.get(placa)!
      if (h.portal && o.portal && h.portal !== o.portal) {
        const delta = h.portal - o.portal
        eventos.push({ tenant_id: tenantId, data_ref: dataRef, placa, tipo: delta < 0 ? 'preco_caiu' : 'preco_subiu', valor_ant: o.portal, valor_novo: h.portal, delta, modelo: h.modelo, patio_nome: h.patio_nome })
      }
      if (!o.orcamento && h.orcamento)
        eventos.push({ tenant_id: tenantId, data_ref: dataRef, placa, tipo: 'reparo_novo', valor_novo: h.orcamento, modelo: h.modelo, patio_nome: h.patio_nome })
    }
  }
  for (const [placa, o] of oMap) {
    if (!hMap.has(placa))
      eventos.push({ tenant_id: tenantId, data_ref: dataRef, placa, tipo: 'removido', valor_ant: o.portal, modelo: o.modelo, patio_nome: o.patio_nome })
  }

  if (eventos.length) {
    await admin.from('eventos_diarios').delete().eq('tenant_id', tenantId).eq('data_ref', dataRef)
    await admin.from('eventos_diarios').insert(eventos)
  }
}

// ── CORS ───────────────────────────────────────────────────────────────────

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ── Entrypoint ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // Verifica autenticação
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Não autenticado' }, 401)
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await caller.auth.getUser()
  if (!user) return json({ error: 'Token inválido' }, 401)

  try {
    const { storage_paths, tenant_id = 'piloto', data_ref, run_diff = true } = await req.json() as {
      storage_paths: string[]; tenant_id?: string; data_ref: string; run_diff?: boolean
    }

    if (!storage_paths?.length || !data_ref) return json({ error: 'storage_paths e data_ref obrigatórios' }, 400)

    const resultados: object[] = []
    const BATCH = 500

    for (const storagePath of storage_paths) {
      const arquivo = storagePath.split('/').pop() ?? storagePath

      // Atualiza status → processando
      const { data: proc } = await admin.from('processamentos').insert({
        tenant_id, data_ref, arquivo, storage_path: storagePath, status: 'processando',
      }).select('id').single()

      try {
        // Download do PDF
        const { data: blob, error: dlErr } = await admin.storage.from('pdfs').download(storagePath)
        if (dlErr || !blob) throw new Error(`Falha ao baixar ${arquivo}: ${dlErr?.message}`)

        const buffer = await blob.arrayBuffer()
        const linhas = await extraiTabela(buffer)
        const { registros, alertas: alertasParser } = parseLinhas(linhas, arquivo)
        const { ok, motivo, avisos } = valida(registros, arquivo)

        if (!ok) {
          await admin.from('processamentos').update({ status: 'erro', erro: motivo, processado_em: new Date().toISOString() }).eq('id', proc?.id)
          resultados.push({ arquivo, status: 'erro', motivo })
          continue
        }

        // Upsert em lotes
        const rows = registros.map(r => ({
          tenant_id, data_ref, arquivo,
          patio: r.patio, patio_nome: r.patio_nome, placa: r.placa,
          modelo: r.modelo, categoria: r.categoria, ano_fab: r.ano_fab, ano_mod: r.ano_mod,
          km: r.km, cor: r.cor, uf: r.uf, orcamento: r.orcamento, fpe: r.fpe,
          margem_bruta: r.margem, portal: r.portal, margem_pct: r.margem_pct,
          margem_liq: r.margem_liq, margem_liq_pct: r.margem_liq_pct, tem_reparo: r.tem_reparo,
        }))

        for (let i = 0; i < rows.length; i += BATCH) {
          const { error: upsertErr } = await admin.from('veiculos_snapshot')
            .upsert(rows.slice(i, i + BATCH), { onConflict: 'tenant_id,data_ref,arquivo,placa' })
          if (upsertErr) throw new Error(upsertErr.message)
        }

        const status = avisos.length > 0 || alertasParser.length > 0 ? 'aviso' : 'ok'
        await admin.from('processamentos').update({
          status, veiculos: registros.length,
          alertas: [...alertasParser, ...avisos],
          processado_em: new Date().toISOString(),
        }).eq('id', proc?.id)

        resultados.push({ arquivo, status, veiculos: registros.length, alertas: [...alertasParser, ...avisos] })

      } catch (err) {
        const msg = String(err)
        await admin.from('processamentos').update({ status: 'erro', erro: msg, processado_em: new Date().toISOString() }).eq('id', proc?.id)
        resultados.push({ arquivo, status: 'erro', motivo: msg })
      }
    }

    // Roda diff ao final (só quando solicitado — evita rodar N vezes para N arquivos)
    if (run_diff) {
      try { await rodaDiff(admin, tenant_id, data_ref) } catch (_) { /* diff não crítico */ }
    }

    return json({ ok: true, resultados })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
