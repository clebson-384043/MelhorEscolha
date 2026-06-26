"""
parser_referencia.py — Extrator validado dos PDFs de estoque (Radar de Estoque).
Acompanha o BOT-SPEC.md. Testado em 6 PDFs reais (1.482 veículos, 24/06).

Trata: orçamento opcional (custo de reparo), valores R$ com espaço espúrio,
categoria/ano embaralhados em modelos longos, e calcula margem líquida.

Uso:  regs, alertas = parse_pdf("caminho/arquivo.pdf")
Dep:  pip install pdfplumber
"""
import pdfplumber, re, json, glob, os, sys
from dotenv import load_dotenv

CATEGORIAS = ['SUV COMPACTO','PICAPE GRANDE','UTILITÁRIO GRANDE','UTILITÁRIO COMPACTO',
              'INTERMEDIÁRIO','EXECUTIVO','BÁSICO','PREMIUM']

def limpa_dinheiro(s):
    if not s: return None
    s = s.replace('R$','').replace(' ','').strip()
    if s in ('','-','#DIV/0!'): return None
    neg = s.startswith('-'); s = s.replace('-','')
    s = s.replace('.','').replace(',','.')
    try:
        v = float(s); return -v if neg else v
    except: return None

def limpa_int(s):
    if not s: return None
    s = re.sub(r'\D','', s)
    return int(s) if s else None

def separa_categoria_anos(c3, c4):
    """
    c3/c4 podem vir limpos (ex: 'BÁSICO' / '2021') ou embaralhados
    (ex: 'SUV CO' / 'MPA2C0T2O4' onde se misturam 'COMPACTO' e '2024').
    Retorna (categoria, ano_fab, ano_mod) reconstruídos.
    """
    c3 = (c3 or '').strip(); c4 = (c4 or '').strip()
    junto = c3 + c4
    # extrai todos os dígitos na ordem -> são os 8 dígitos de ano_fab+ano_mod
    digitos = re.sub(r'\D','', junto)
    ano_fab = ano_mod = None
    if len(digitos) >= 8:
        ano_fab = int(digitos[:4]); ano_mod = int(digitos[4:8])
    elif len(digitos) == 4:
        ano_fab = ano_mod = int(digitos)
    # extrai as letras -> reconstroi a categoria
    letras = re.sub(r'[\d\s]','', junto).upper()
    categoria = None
    alvo = letras.replace('Ç','C').replace('Á','A').replace('Í','I').replace('Ó','O').replace('Ú','U')
    for cat in CATEGORIAS:
        chave = cat.replace(' ','').replace('Ç','C').replace('Á','A').replace('Í','I').replace('Ó','O').replace('Ú','U')
        if chave == alvo:
            categoria = cat; break
    if not categoria:
        # tenta por prefixo (casos truncados)
        for cat in CATEGORIAS:
            chave = cat.replace(' ','').replace('Ç','C').replace('Á','A')[:6]
            if alvo.startswith(chave[:5]):
                categoria = cat; break
    if not categoria:
        categoria = c3  # fallback: o que veio
    return categoria, ano_fab, ano_mod

PATIO_NOME = {
    'VCEBH': 'Pátio Contagem',    # corrigido (era 'Via Shopping')
    'VCPSB': 'Via Shopping',       # corrigido (era 'Shopping Contagem')
    'VCPGM': 'Shopping Contagem',  # corrigido (era 'Pátio Contagem')
    'VCPSI': 'Shopping Cidade',
    'VCBET': 'Betim',
    'VCBHZ': 'BH',
    'VCCMA': 'Contagem',
    'VCLEX': 'Lexus',
    'VCSMS': 'Sumaré',
    'VCVNO': 'Venda Nova',
}

def parse_pdf(path):
    registros = []; alertas = []
    with pdfplumber.open(path) as pdf:
        for pi, page in enumerate(pdf.pages):
            tabelas = page.extract_tables()
            if not tabelas:
                # página sem tabela detectável -> possível PDF imagem/layout diferente
                if page.extract_text():
                    alertas.append(f'pág {pi+1}: texto presente mas sem tabela')
                else:
                    alertas.append(f'pág {pi+1}: SEM TEXTO (possível PDF escaneado)')
                continue
            for tbl in tabelas:
                for row in tbl:
                    if not row or not row[0]: continue
                    patio = row[0].strip()
                    if patio == 'PÁTIO' or (len(row)>1 and 'PLACA' in str(row[1])): continue
                    if len(row) < 14: continue
                    placa = (row[1] or '').strip()
                    if not re.match(r'^[A-Z]{3}\d', placa): continue

                    modelo = (row[2] or '').strip()
                    categoria, ano_fab, ano_mod = separa_categoria_anos(row[3], row[4])
                    # Coluna 5 tem o ano do modelo quando separado (§2 do spec — "inconsistente")
                    # Se fab == mod o parser encontrou só um ano; tenta ler o mod da coluna 5
                    if ano_fab is not None and ano_fab == ano_mod:
                        ano5 = limpa_int((row[5] or '').strip())
                        if ano5 and 2000 <= ano5 <= 2035:
                            ano_mod = ano5
                    km   = limpa_int(row[6])
                    cor  = (row[7] or '').strip()
                    uf   = (row[8] or '').strip()
                    orcamento = limpa_dinheiro(row[9])   # CUSTO DE REPARO (opcional)
                    fpe       = limpa_dinheiro(row[10])  # preço tabela
                    margem    = limpa_dinheiro(row[11])  # desconto bruto R$
                    portal    = limpa_dinheiro(row[12])  # preço de venda
                    pct       = (row[13] or '').strip()
                    pct_num   = limpa_int(pct.replace('%','')) if '%' in pct else None

                    # MARGEM LÍQUIDA = desconto bruto - custo de reparo
                    margem_liq = None
                    if margem is not None:
                        margem_liq = margem - (orcamento or 0)
                    margem_liq_pct = None
                    if margem_liq is not None and portal:
                        margem_liq_pct = round(margem_liq / portal * 100, 1)

                    registros.append({
                        'patio': patio, 'patio_nome': PATIO_NOME.get(patio, patio),
                        'placa': placa, 'modelo': modelo, 'categoria': categoria,
                        'ano_fab': ano_fab, 'ano_mod': ano_mod, 'km': km, 'cor': cor, 'uf': uf,
                        'orcamento': orcamento, 'fpe': fpe, 'margem': margem,
                        'portal': portal, 'margem_pct': pct_num,
                        'margem_liq': margem_liq, 'margem_liq_pct': margem_liq_pct,
                        'tem_reparo': orcamento is not None
                    })
    return registros, alertas


def valida_extracao(registros, arquivo, expected_min=None):
    """
    Retorna (ok, motivo_falha).
    ok=False → não ingerir, não rodar diff, notificar admin (§7 do spec).
    expected_min: contagem histórica do pátio; se None, o check de 50% é pulado.
    Alertas de página escaneada já são propagados separadamente pelo chamador.
    """
    if not registros:
        return False, f"{arquivo}: 0 veículos extraídos"

    if expected_min is not None and len(registros) < expected_min * 0.5:
        return False, (
            f"{arquivo}: {len(registros)} extraídos, esperado >= {expected_min * 0.5:.0f} "
            f"(< 50% do histórico de {expected_min})"
        )

    com_portal = sum(1 for r in registros if r["portal"] is not None)
    taxa_portal = com_portal / len(registros)
    if taxa_portal < 0.80:
        return False, (
            f"{arquivo}: apenas {taxa_portal:.0%} dos registros têm PORTAL preenchido "
            f"— possível mudança de layout"
        )

    return True, None


if __name__ == '__main__':
    load_dotenv()

    pdf_dir = os.getenv('PDF_INPUT_DIR', 'pipeline/input')
    output  = os.getenv('OUTPUT_JSON', 'pipeline/output/base.json')
    os.makedirs(os.path.dirname(output), exist_ok=True)

    arquivos = sorted(glob.glob(os.path.join(pdf_dir, '*.pdf')))
    if not arquivos:
        print(f'Nenhum PDF encontrado em {pdf_dir}')
        sys.exit(1)

    todos = []; todos_alertas = {}; falhas = []

    for f in arquivos:
        nome = os.path.basename(f)
        regs, alertas = parse_pdf(f)
        ok, motivo = valida_extracao(regs, nome)

        if not ok:
            falhas.append(motivo)
            print(f'FALHA  {nome}: {motivo}')
            continue

        todos.extend([{**r, 'arquivo': nome} for r in regs])
        if alertas:
            todos_alertas[nome] = alertas
        com_rep = sum(1 for r in regs if r['tem_reparo'])
        print(f'OK     {nome:28} -> {len(regs):4} veículos | {com_rep:3} c/ reparo')

    print(f'\nTOTAL INGERÍVEL: {len(todos)} veículos em {len(arquivos) - len(falhas)} arquivo(s)')

    if falhas:
        print(f'\n⚠️  FALHAS ({len(falhas)}) — não ingerir estes arquivos:')
        for m in falhas:
            print(f'  • {m}')

    if todos_alertas:
        print('\n⚠️  ALERTAS DE EXTRAÇÃO:')
        for arq, al in todos_alertas.items():
            print(f'  {arq}: {len(al)} alerta(s) — {al[0]}')

    if todos:
        json.dump(todos, open(output, 'w'), ensure_ascii=False, indent=2)
        print(f'\nJSON salvo em: {output}')

    com_orc = [r for r in todos if r['tem_reparo']]
    if com_orc:
        print('\n--- EXEMPLO: impacto do reparo na margem ---')
        exemplos = sorted(com_orc, key=lambda x: -(x['orcamento'] or 0))[:6]
        print(f"{'PLACA':9} {'MODELO':24} {'PORTAL':>11} {'REPARO':>10} {'MG.BRUTA':>9} {'MG.LÍQ':>9} {'%BRUTO':>7} {'%LÍQ':>6}")
        for r in exemplos:
            print(f"{r['placa']:9} {r['modelo'][:24]:24} {r['portal']:>11,.0f} {r['orcamento']:>10,.0f} "
                  f"{(r['margem'] or 0):>9,.0f} {(r['margem_liq'] or 0):>9,.0f} "
                  f"{str(r['margem_pct'])+'%':>7} {str(r['margem_liq_pct'])+'%':>6}")