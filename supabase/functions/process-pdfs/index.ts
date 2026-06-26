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
  const n = parseFloat(v.replace('.','').replace(',','.'))
  return isNaN(n) ? null : (neg ? -n : n)
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
  return [categoria ?? c3 || null, ano_fab, ano_mod]
}

// ── Extração de tabela do PDF ──────────────────────────────────────────────

async function extraiTabela(buffer: ArrayBuffer): Promise<string[][]> {
  const doc = await getDocumentProxy(new Uint8Array(buffer))
  const linhas: string[][] = []
  const Y_TOL = 3

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const items = content.items as Array<{ str: string; transform: number[] }>

    // Agrupa por Y com tolerância
    const grupos: { y: number; items: typeof items }[] = []
    for (const item of items) {
      const y = item.transform[5]
      const grp = grupos.find(g => Math.abs(g.y - y) <= Y_TOL)
      if (grp) grp.items.push(item)
      else grupos.push({ y, items: [item] })
    }

    // Ordena grupos de cima para baixo, itens da esquerda para direita
    grupos.sort((a, b) => b.y - a.y)
    for (const grp of grupos) {
      grp.items.sort((a, b) => a.transform[4] - b.transform[4])
      // Combina textos adjacentes na mesma célula (heurística: gap > 15px = nova célula)
      const celulas: string[] = []
      let celAtual = ''
      let xAnterior = -Infinity
      for (const it of grp.items) {
        const x = it.transform[4]
        if (celAtual === '' || x - xAnterior < 15) {
          celAtual += it.str
        } else {
          celulas.push(celAtual.trim())
          celAtual = it.str
        }
        xAnterior = x + (it.str.length * 5) // estimativa de largura
      }
      if (celAtual.trim()) celulas.push(celAtual.trim())
      if (celulas.length >= 10) linhas.push(celulas)
    }
  }
  return linhas
}

// ── Parser principal ───────────────────────────────────────────────────────

function parseLinhas(linhas: string[][], arquivo: string): { registros: Veiculo[], alertas: string[] } {
  const registros: Veiculo[] = []
  const alertas: string[] = []

  for (const row of linhas) {
    const patio = (row[0] ?? '').trim()
    if (!patio || patio === 'PÁTIO' || patio === 'PATÍO') continue
    if (row.length < 10) continue

    const placa = (row[1] ?? '').trim()
    if (!/^[A-Z]{3}\d/.test(placa)) continue

    // Detecta layout estendido (endereço/bairro) — 18+ colunas vs 14 padrão
    const ext = row.length >= 18
    const [km_i, cor_i, uf_i] = ext ? [6, 7, 12] : [6, 7, 8]
    const [orc_i, fpe_i, mg_i, portal_i, pct_i] = ext ? [13, 14, 15, 16, 17] : [9, 10, 11, 12, 13]

    const modelo = (row[2] ?? '').trim()
    let [categoria, ano_fab, ano_mod] = separaCategoria(row[3] ?? '', row[4] ?? '')

    // Coluna 5 pode ter o ano do modelo quando separado
    if (ano_fab && ano_fab === ano_mod) {
      const ano5 = limpaInt(row[5])
      if (ano5 && ano5 >= 2000 && ano5 <= 2035) ano_mod = ano5
    }

    const km        = limpaInt(row[km_i])
    const cor       = (row[cor_i] ?? '').trim()
    const uf        = (row[uf_i] ?? '').trim()
    const orcamento = limpaDinheiro(row[orc_i])
    const fpe       = limpaDinheiro(row[fpe_i])
    const margem    = limpaDinheiro(row[mg_i])
    const portal    = limpaDinheiro(row[portal_i])
    const pctStr    = (row[pct_i] ?? '').trim()
    const margem_pct = pctStr.includes('%') ? limpaInt(pctStr.replace('%','')) : null

    // Margem líquida
    const margem_liq = margem != null ? margem - (orcamento ?? 0) : null
    const margem_liq_pct = margem_liq != null && portal ? parseFloat((margem_liq / portal * 100).toFixed(1)) : null

    registros.push({
      patio, patio_nome: PATIO_NOME[patio] ?? patio,
      placa, modelo, categoria, ano_fab, ano_mod, km, cor, uf,
      orcamento, fpe, margem, portal, margem_pct,
      margem_liq, margem_liq_pct,
      tem_reparo: orcamento != null,
    })
  }

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
    const { storage_paths, tenant_id = 'piloto', data_ref } = await req.json() as {
      storage_paths: string[]; tenant_id?: string; data_ref: string
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
            .upsert(rows.slice(i, i + BATCH), { onConflict: 'tenant_id,data_ref,placa' })
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

    // Roda diff ao final
    try { await rodaDiff(admin, tenant_id, data_ref) } catch (_) { /* diff não crítico */ }

    return json({ ok: true, resultados })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
