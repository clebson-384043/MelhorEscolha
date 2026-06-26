"""
ingest.py — Ingestão diária de PDFs no Supabase (passo 2 do spec, §11).
Importa parse_pdf e valida_extracao do parser.py; faz upsert idempotente
por (tenant_id, data_ref, placa). Arquivos que falham na validação são
ignorados sem sobrescrever o snapshot bom do dia anterior (§7).

Uso:
  python pipeline/ingest.py
  python pipeline/ingest.py --data 2026-06-24   # reprocessar data específica
  python pipeline/ingest.py --tenant piloto      # explícito (padrão)

Saída: exit 0 se tudo OK, exit 1 se algum arquivo falhou (útil para n8n).
"""
import argparse, glob, os, re, sys
from datetime import date

from dotenv import load_dotenv
from supabase import create_client

from parser import parse_pdf, valida_extracao

BATCH_SIZE = 500  # linhas por request para não estourar o limite do Supabase


def get_data_ref(nome_arquivo, override=None):
    """Extrai data de referência do nome do arquivo ou usa override/hoje."""
    if override:
        return override
    m = re.search(r'(\d{4}-\d{2}-\d{2})', nome_arquivo)
    if m:
        return m.group(1)
    m = re.search(r'(\d{2})[-_](\d{2})[-_](\d{4})', nome_arquivo)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return str(date.today())


def montar_row(r, nome_arquivo, data_ref, tenant_id):
    return {
        'tenant_id':      tenant_id,
        'data_ref':       data_ref,
        'arquivo':        nome_arquivo,
        'patio':          r['patio'],
        'patio_nome':     r['patio_nome'],
        'placa':          r['placa'],
        'modelo':         r['modelo'],
        'categoria':      r['categoria'],
        'ano_fab':        r['ano_fab'],
        'ano_mod':        r['ano_mod'],
        'km':             r['km'],
        'cor':            r['cor'],
        'uf':             r['uf'],
        'orcamento':      r['orcamento'],
        'fpe':            r['fpe'],
        'margem_bruta':   r['margem'],       # parser chama de 'margem'; DB usa 'margem_bruta'
        'portal':         r['portal'],
        'margem_pct':     r['margem_pct'],
        'margem_liq':     r['margem_liq'],
        'margem_liq_pct': r['margem_liq_pct'],
        'tem_reparo':     r['tem_reparo'],
    }


def upsert_em_lotes(supabase, rows):
    """Faz upsert em batches para não estourar o limite de payload do Supabase."""
    for i in range(0, len(rows), BATCH_SIZE):
        lote = rows[i:i + BATCH_SIZE]
        (supabase
         .table('veiculos_snapshot')
         .upsert(lote, on_conflict='tenant_id,data_ref,placa')
         .execute())


def ingerir_arquivo(supabase, caminho, data_override, tenant_id):
    """
    Processa um PDF e faz upsert no Supabase.
    Retorna (ok, motivo_falha, alertas).
    """
    nome = os.path.basename(caminho)
    data_ref = get_data_ref(nome, data_override)

    regs, alertas = parse_pdf(caminho)
    ok, motivo = valida_extracao(regs, nome)
    if not ok:
        return False, motivo, alertas

    rows = [montar_row(r, nome, data_ref, tenant_id) for r in regs]
    upsert_em_lotes(supabase, rows)

    com_rep = sum(1 for r in regs if r['tem_reparo'])
    print(f'OK     {nome:30} data={data_ref} -> {len(regs):4} upsertados | {com_rep:3} c/ reparo')
    return True, None, alertas


if __name__ == '__main__':
    load_dotenv()

    ap = argparse.ArgumentParser()
    ap.add_argument('--data',   help='Data de referência YYYY-MM-DD (padrão: extraída do nome ou hoje)')
    ap.add_argument('--tenant', default='piloto', help='Tenant ID (padrão: piloto)')
    args = ap.parse_args()

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not supabase_url or not supabase_key:
        print('Erro: SUPABASE_URL e SUPABASE_SERVICE_KEY devem estar no .env')
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)
    pdf_dir  = os.getenv('PDF_INPUT_DIR', 'pipeline/input')

    arquivos = sorted(glob.glob(os.path.join(pdf_dir, '*.pdf')))
    if not arquivos:
        print(f'Nenhum PDF encontrado em {pdf_dir}')
        sys.exit(1)

    falhas = []; todos_alertas = {}

    for caminho in arquivos:
        nome = os.path.basename(caminho)
        try:
            ok, motivo, alertas = ingerir_arquivo(supabase, caminho, args.data, args.tenant)
        except Exception as exc:
            ok, motivo, alertas = False, str(exc), []

        if not ok:
            falhas.append((nome, motivo))
            print(f'FALHA  {nome}: {motivo}')
        if alertas:
            todos_alertas[nome] = alertas

    total_ok = len(arquivos) - len(falhas)
    print(f'\nIngestão concluída: {total_ok}/{len(arquivos)} arquivo(s) OK')

    if falhas:
        print(f'\n⚠️  Arquivos NÃO ingeridos ({len(falhas)}):')
        for nome, motivo in falhas:
            print(f'  • {nome}: {motivo}')

    if todos_alertas:
        print('\n⚠️  Alertas de extração:')
        for arq, al in todos_alertas.items():
            print(f'  {arq}: {len(al)} alerta(s) — {al[0]}')

    sys.exit(1 if falhas else 0)
