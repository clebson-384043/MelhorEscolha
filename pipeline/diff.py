"""
diff.py — Diff diário entre hoje e a última data anterior disponível (§6 do spec).
Popula eventos_diarios. Idempotente: apaga eventos do dia antes de reinserir.

Tipos gerados: 'novo' | 'removido' | 'preco_caiu' | 'preco_subiu' | 'reparo_novo'

Uso:
  python pipeline/diff.py
  python pipeline/diff.py --data 2026-06-25
  python pipeline/diff.py --tenant piloto

Saída: exit 0 se OK, exit 1 em falha (útil para n8n parar a cadeia).
"""
import argparse, os, sys
from datetime import date

from dotenv import load_dotenv
from supabase import create_client


# ---------------------------------------------------------------------------
# Acesso ao Supabase
# ---------------------------------------------------------------------------

def fetch_snapshot(supabase, tenant_id, data_ref):
    """Busca snapshot completo de uma data com paginação (Supabase retorna ≤1000/req)."""
    PAGE = 1000
    rows = []
    offset = 0
    while True:
        resp = (supabase.table('veiculos_snapshot')
                .select('placa,portal,orcamento,modelo,patio_nome')
                .eq('tenant_id', tenant_id)
                .eq('data_ref', data_ref)
                .range(offset, offset + PAGE - 1)
                .execute())
        rows.extend(resp.data)
        if len(resp.data) < PAGE:
            break
        offset += PAGE
    return rows


def busca_data_anterior(supabase, tenant_id, data_hoje):
    """Retorna a última data_ref antes de data_hoje, ou None se não existir."""
    resp = (supabase.table('veiculos_snapshot')
            .select('data_ref')
            .eq('tenant_id', tenant_id)
            .lt('data_ref', data_hoje)
            .order('data_ref', desc=True)
            .limit(1)
            .execute())
    return resp.data[0]['data_ref'] if resp.data else None


# ---------------------------------------------------------------------------
# Lógica do diff
# ---------------------------------------------------------------------------

def calcula_diff(hoje_rows, ontem_rows):
    """
    Compara dois snapshots e retorna lista de dicts de eventos.
    Cada dict já tem todos os campos esperados pela tabela eventos_diarios.
    """
    hoje_idx  = {r['placa']: r for r in hoje_rows}
    ontem_idx = {r['placa']: r for r in ontem_rows}
    hoje_set  = set(hoje_idx)
    ontem_set = set(ontem_idx)

    eventos = []

    # Veículos novos (entraram hoje)
    for placa in (hoje_set - ontem_set):
        r = hoje_idx[placa]
        eventos.append({
            'tipo': 'novo', 'placa': placa,
            'valor_ant': None, 'valor_novo': r['portal'], 'delta': None,
            'modelo': r['modelo'], 'patio_nome': r['patio_nome'],
        })

    # Veículos removidos (saíram / vendidos)
    for placa in (ontem_set - hoje_set):
        r = ontem_idx[placa]
        eventos.append({
            'tipo': 'removido', 'placa': placa,
            'valor_ant': r['portal'], 'valor_novo': None, 'delta': None,
            'modelo': r['modelo'], 'patio_nome': r['patio_nome'],
        })

    # Veículos comuns: verificar mudanças de preço e reparo
    for placa in (hoje_set & ontem_set):
        h = hoje_idx[placa]
        o = ontem_idx[placa]

        # Mudança de preço de venda
        ph, po = h['portal'], o['portal']
        if ph is not None and po is not None and ph != po:
            delta = ph - po
            eventos.append({
                'tipo': 'preco_caiu' if delta < 0 else 'preco_subiu',
                'placa': placa,
                'valor_ant': po, 'valor_novo': ph, 'delta': delta,
                'modelo': h['modelo'], 'patio_nome': h['patio_nome'],
            })

        # Reparo que apareceu hoje (orcamento foi de null → valor)
        if o['orcamento'] is None and h['orcamento'] is not None:
            eventos.append({
                'tipo': 'reparo_novo', 'placa': placa,
                'valor_ant': None, 'valor_novo': h['orcamento'], 'delta': None,
                'modelo': h['modelo'], 'patio_nome': h['patio_nome'],
            })

    return eventos


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    load_dotenv()

    ap = argparse.ArgumentParser()
    ap.add_argument('--data',   help='Data de referência YYYY-MM-DD (padrão: hoje)')
    ap.add_argument('--tenant', default='piloto')
    args = ap.parse_args()

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not supabase_url or not supabase_key:
        print('Erro: SUPABASE_URL e SUPABASE_SERVICE_KEY devem estar no .env')
        sys.exit(1)

    supabase  = create_client(supabase_url, supabase_key)
    data_hoje = args.data or str(date.today())
    tenant_id = args.tenant

    # 1. Snapshot de hoje
    hoje_rows = fetch_snapshot(supabase, tenant_id, data_hoje)
    if not hoje_rows:
        print(f'Sem snapshot para {data_hoje} — execute ingest.py primeiro.')
        sys.exit(1)

    # 2. Data anterior disponível
    data_ant = busca_data_anterior(supabase, tenant_id, data_hoje)
    if not data_ant:
        print('Primeiro dia de operação — sem data anterior para comparar. Diff pulado.')
        sys.exit(0)

    ontem_rows = fetch_snapshot(supabase, tenant_id, data_ant)

    # 3. Check de saúde (§7): se hoje < 50% de ontem, provável ingestão incompleta
    if len(hoje_rows) < len(ontem_rows) * 0.5:
        print(
            f'ABORTAR: hoje {len(hoje_rows)} veículos vs {data_ant} {len(ontem_rows)} '
            f'— abaixo de 50% do dia anterior. Ingestão provavelmente incompleta. '
            f'Notifique o admin, não rode o diff.'
        )
        sys.exit(1)

    print(
        f'Comparando {data_hoje} ({len(hoje_rows)} veículos) '
        f'← {data_ant} ({len(ontem_rows)} veículos)'
    )

    # 4. Calcula o diff
    eventos = calcula_diff(hoje_rows, ontem_rows)

    por_tipo = {t: sum(1 for e in eventos if e['tipo'] == t)
                for t in ('novo', 'removido', 'preco_caiu', 'preco_subiu', 'reparo_novo')}
    print(
        f"  → {por_tipo['novo']} novos | {por_tipo['removido']} removidos | "
        f"{por_tipo['preco_caiu']} preço caiu | {por_tipo['preco_subiu']} preço subiu | "
        f"{por_tipo['reparo_novo']} reparo novo"
    )

    # 5. Persiste (idempotente: apaga eventos do dia antes de reinserir)
    (supabase.table('eventos_diarios')
     .delete()
     .eq('tenant_id', tenant_id)
     .eq('data_ref', data_hoje)
     .execute())

    if eventos:
        rows = [{'tenant_id': tenant_id, 'data_ref': data_hoje, **e} for e in eventos]
        supabase.table('eventos_diarios').insert(rows).execute()
        print(f'  → {len(rows)} eventos gravados em eventos_diarios.')
    else:
        print('  → Nenhuma mudança detectada.')

    sys.exit(0)
