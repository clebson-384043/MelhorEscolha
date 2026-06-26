"""
whatsapp.py — Gera e envia o resumo diário via Evolution API (§9 do BOT-SPEC.md).

Uso:
  python pipeline/whatsapp.py                   # envia para hoje
  python pipeline/whatsapp.py --data 2026-06-25
  python pipeline/whatsapp.py --dry-run          # imprime sem enviar
  python pipeline/whatsapp.py --tenant piloto

Saída: exit 0 se OK, exit 1 em falha.
"""
import argparse, os, sys
from datetime import date

import requests
from dotenv import load_dotenv
from supabase import create_client


# Limites de itens por seção (mensagem WhatsApp deve ser legível no celular)
MAX_NOVOS  = 10
MAX_CAIU   = 8
MAX_TOP    = 5
MAX_REPARO = 5


# ---------------------------------------------------------------------------
# Formatação
# ---------------------------------------------------------------------------

def fmt_r(v):
    """R$ 138.300 — padrão brasileiro (ponto como separador de milhar)."""
    if v is None:
        return '—'
    return f"R$ {v:,.0f}".replace(',', '.')


def fmt_pct(v):
    """19% ou 4,9% — sem zeros desnecessários."""
    if v is None:
        return '—'
    s = f"{v:.1f}".rstrip('0').rstrip('.')
    return s.replace('.', ',') + '%'


def fmt_ano(v):
    return str(v) if v else '?'


def linha_veiculo(v):
    """Ex: HILUX CD STD 2.8 2023/23 — R$ 138.300 • líq 19% • sem reparo • Via Shopping"""
    ano = f" {fmt_ano(v.get('ano_fab'))}/{fmt_ano(v.get('ano_mod', '?'))[2:]}" \
          if v.get('ano_fab') else ''
    preco = fmt_r(v.get('portal'))
    liq   = f"líq {fmt_pct(v.get('margem_liq_pct'))}"
    extra = 'sem reparo' if not v.get('tem_reparo') else f"reparo {fmt_r(v.get('orcamento'))}"
    patio = v.get('patio_nome') or ''
    return f"{v.get('modelo', '')}{ano} — {preco} • {liq} • {extra} • {patio}"


def linha_caiu(e):
    """Ex: COMPASS LONGITUDE — R$ 125.300 (−R$ 4.900) • Pátio Contagem"""
    delta = fmt_r(abs(e.get('delta') or 0))
    return (
        f"{e.get('modelo', '')} — {fmt_r(e.get('valor_novo'))}"
        f" (−{delta}) • {e.get('patio_nome', '')}"
    )


def linha_reparo(v):
    """Ex: COROLLA XEI — bruto 21% mas líq 4,9% (reparo R$ 22.222)"""
    bruto = f"{v.get('margem_pct') or 0}%"
    liq   = fmt_pct(v.get('margem_liq_pct'))
    return (
        f"{v.get('modelo', '')} [{v.get('placa', '')}]"
        f" — bruto {bruto} mas líq {liq} (reparo {fmt_r(v.get('orcamento'))})"
    )


# ---------------------------------------------------------------------------
# Queries ao Supabase
# ---------------------------------------------------------------------------

def busca_preferencias(supabase, tenant_id):
    resp = (supabase.table('preferencias')
            .select('*')
            .eq('tenant_id', tenant_id)
            .eq('ativo', True)
            .limit(1)
            .execute())
    return resp.data[0] if resp.data else {}


def busca_eventos(supabase, tenant_id, data_ref):
    resp = (supabase.table('eventos_diarios')
            .select('tipo,placa,valor_ant,valor_novo,delta,modelo,patio_nome')
            .eq('tenant_id', tenant_id)
            .eq('data_ref', data_ref)
            .execute())
    return resp.data


def busca_novos_detalhado(supabase, tenant_id, data_ref, placas):
    """Detalhes completos das placas novas: ordena por maior margem líquida."""
    if not placas:
        return []
    resp = (supabase.table('veiculos_snapshot')
            .select('modelo,ano_fab,ano_mod,portal,margem_liq_pct,tem_reparo,orcamento,patio_nome')
            .eq('tenant_id', tenant_id)
            .eq('data_ref', data_ref)
            .in_('placa', list(placas))
            .order('margem_liq_pct', desc=True)
            .execute())
    return resp.data


def busca_top_margem(supabase, tenant_id, data_ref, prefs):
    """Top veículos por margem líquida filtrados pelas preferências do cliente."""
    q = (supabase.table('veiculos_snapshot')
         .select('modelo,ano_fab,ano_mod,portal,margem_liq_pct,tem_reparo,orcamento,patio_nome')
         .eq('tenant_id', tenant_id)
         .eq('data_ref', data_ref)
         .order('margem_liq_pct', desc=True))
    if prefs.get('margem_liq_min') is not None:
        q = q.gte('margem_liq_pct', prefs['margem_liq_min'])
    if prefs.get('preco_max') is not None:
        q = q.lte('portal', prefs['preco_max'])
    return q.limit(MAX_TOP).execute().data


def busca_atencao_reparo(supabase, tenant_id, data_ref):
    """Veículos com reparo que mais derrubase a margem (ordenado em Python)."""
    resp = (supabase.table('veiculos_snapshot')
            .select('placa,modelo,portal,margem_pct,margem_liq_pct,orcamento')
            .eq('tenant_id', tenant_id)
            .eq('data_ref', data_ref)
            .eq('tem_reparo', True)
            .limit(500)
            .execute())
    dados = [r for r in resp.data
             if r.get('margem_pct') is not None and r.get('margem_liq_pct') is not None]
    dados.sort(key=lambda r: (r['margem_pct'] - r['margem_liq_pct']), reverse=True)
    return dados[:MAX_REPARO]


def conta_com_flag(supabase, tenant_id, data_ref, **filtros):
    """Conta registros no snapshot com filtros extras (ex: tem_reparo=True)."""
    q = (supabase.table('veiculos_snapshot')
         .select('id', count='exact')
         .eq('tenant_id', tenant_id)
         .eq('data_ref', data_ref)
         .limit(1))
    for col, val in filtros.items():
        q = q.eq(col, val)
    return q.execute().count or 0


# ---------------------------------------------------------------------------
# Monta a mensagem
# ---------------------------------------------------------------------------

def monta_mensagem(data_ref, eventos, novos_det, top_margem, reparo_det,
                   total_veiculos, total_reparo):
    data_fmt = '/'.join(reversed(data_ref.split('-')))  # YYYY-MM-DD → DD/MM/YYYY
    partes = [f"🚗 *RADAR DE ESTOQUE — {data_fmt}*\n"]

    # Novidades
    novos_ev = [e for e in eventos if e['tipo'] == 'novo']
    partes.append(f"🆕 *NOVIDADES HOJE ({len(novos_ev)})*")
    if novos_det:
        for i, v in enumerate(novos_det[:MAX_NOVOS], 1):
            partes.append(f"{i}. {linha_veiculo(v)}")
        if len(novos_ev) > MAX_NOVOS:
            partes.append(f"   _...e mais {len(novos_ev) - MAX_NOVOS}_")
    else:
        partes.append("   Nenhuma novidade hoje.")
    partes.append('')

    # Preços que caíram
    caiu_ev = sorted(
        [e for e in eventos if e['tipo'] == 'preco_caiu'],
        key=lambda e: e.get('delta') or 0,   # mais negativo (maior queda) primeiro
    )
    partes.append(f"📉 *BAIXARAM DE PREÇO ({len(caiu_ev)})*")
    if caiu_ev:
        for i, e in enumerate(caiu_ev[:MAX_CAIU], 1):
            partes.append(f"{i}. {linha_caiu(e)}")
        if len(caiu_ev) > MAX_CAIU:
            partes.append(f"   _...e mais {len(caiu_ev) - MAX_CAIU}_")
    else:
        partes.append("   Nenhuma queda hoje.")
    partes.append('')

    # Top margem líquida (perfil do cliente)
    partes.append("🔥 *TOP MARGEM LÍQUIDA (perfil do cliente)*")
    if top_margem:
        for i, v in enumerate(top_margem, 1):
            partes.append(f"{i}. {linha_veiculo(v)}")
    else:
        partes.append("   Nenhum veículo no perfil configurado.")
    partes.append('')

    # Atenção reparo (só aparece quando há casos relevantes)
    if reparo_det:
        partes.append("⚠️ *ATENÇÃO REPARO*")
        for i, v in enumerate(reparo_det, 1):
            partes.append(f"{i}. {linha_reparo(v)}")
        partes.append('')

    # Totais
    n_novos = len(novos_ev)
    n_remov = sum(1 for e in eventos if e['tipo'] == 'removido')
    partes.append(
        f"Total: {total_veiculos} veículos • "
        f"{n_novos} novos • {n_remov} removidos • "
        f"{total_reparo} c/ reparo"
    )

    return '\n'.join(partes)


# ---------------------------------------------------------------------------
# Envio via Evolution API
# ---------------------------------------------------------------------------

def envia_whatsapp(mensagem, destino, api_url, api_key, instance):
    url  = f"{api_url.rstrip('/')}/message/sendText/{instance}"
    resp = requests.post(
        url,
        json={'number': destino, 'text': mensagem},
        headers={'apikey': api_key, 'Content-Type': 'application/json'},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    load_dotenv()

    ap = argparse.ArgumentParser()
    ap.add_argument('--data',    help='Data YYYY-MM-DD (padrão: hoje)')
    ap.add_argument('--tenant',  default='piloto')
    ap.add_argument('--dry-run', action='store_true',
                    help='Imprime a mensagem sem enviar')
    args = ap.parse_args()

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not supabase_url or not supabase_key:
        print('Erro: SUPABASE_URL e SUPABASE_SERVICE_KEY devem estar no .env')
        sys.exit(1)

    supabase  = create_client(supabase_url, supabase_key)
    data_hoje = args.data or str(date.today())
    tenant_id = args.tenant

    # Preferências (destino WhatsApp + filtros do perfil)
    prefs   = busca_preferencias(supabase, tenant_id)
    destino = prefs.get('whatsapp_destino') or os.environ.get('WHATSAPP_DESTINO')
    if not destino and not args.dry_run:
        print('Erro: configure whatsapp_destino em preferencias ou WHATSAPP_DESTINO no .env')
        sys.exit(1)

    # Busca todos os dados necessários
    eventos      = busca_eventos(supabase, tenant_id, data_hoje)
    placas_novas = {e['placa'] for e in eventos if e['tipo'] == 'novo'}
    novos_det    = busca_novos_detalhado(supabase, tenant_id, data_hoje, placas_novas)
    top_margem   = busca_top_margem(supabase, tenant_id, data_hoje, prefs)
    reparo_det   = busca_atencao_reparo(supabase, tenant_id, data_hoje)
    total_vei    = conta_com_flag(supabase, tenant_id, data_hoje)
    total_rep    = conta_com_flag(supabase, tenant_id, data_hoje, tem_reparo=True)

    if total_vei == 0:
        print(f'Sem dados para {data_hoje} — execute ingest.py e diff.py primeiro.')
        sys.exit(1)

    mensagem = monta_mensagem(
        data_hoje, eventos, novos_det, top_margem, reparo_det, total_vei, total_rep,
    )

    print('--- PRÉVIA ---')
    print(mensagem)
    print('---')

    if args.dry_run:
        print('(dry-run: mensagem não enviada)')
        sys.exit(0)

    api_url  = os.environ.get('EVOLUTION_API_URL')
    api_key  = os.environ.get('EVOLUTION_API_KEY')
    instance = os.environ.get('EVOLUTION_INSTANCE')
    if not all([api_url, api_key, instance, destino]):
        print('Erro: configure EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE no .env')
        sys.exit(1)

    try:
        resultado = envia_whatsapp(mensagem, destino, api_url, api_key, instance)
        print(f'Enviado. Resposta Evolution: {resultado}')
    except requests.HTTPError as e:
        print(f'Erro HTTP ao enviar: {e.response.status_code} — {e.response.text}')
        sys.exit(1)
    except requests.RequestException as e:
        print(f'Erro de conexão: {e}')
        sys.exit(1)

    sys.exit(0)
