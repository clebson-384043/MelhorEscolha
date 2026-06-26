# BOT-SPEC.md — Radar de Estoque (Análise Diária de Veículos)

> Documento de especificação para implementação no Claude Code.
> Stack alvo: Supabase + n8n + Evolution API + parser Python + app web (React/Vite).
> Autor da ideia: Clebson (CarmoIA) · Cliente piloto: agência de carros (amigo).

---

## 1. Problema e objetivo

O cliente recebe **6 PDFs por dia** (um por pátio/grupo de pátios), cada um com uma tabela de veículos disponíveis para compra/revenda. Hoje ele abre e lê tudo manualmente para responder duas perguntas:

1. **O que entrou de novo** (ou mudou de preço) desde ontem?
2. **Quais carros têm margem boa** no perfil que ele procura (tipo, faixa de preço, modelo)?

Objetivo: automatizar a ingestão diária, calcular margens (inclusive **líquida de reparo**), detectar o **diff diário**, e entregar via (a) **app web** para exploração e (b) **resumo no WhatsApp** todo dia de manhã.

### Princípio de escopo (MVP)
O **diff diário** ("o que mudou") é o coração do valor — priorizar sobre filtros sofisticados. O WhatsApp sozinho já entrega ~80% do valor no dia 1. App web é a camada de exploração por cima.

---

## 2. Estrutura dos dados de entrada

Cada PDF contém uma tabela com **14 colunas em posição fixa**. O `extract_tables()` do `pdfplumber` mantém o alinhamento mesmo quando há células vazias.

| Idx | Coluna | Descrição | Observação |
|----|--------|-----------|-----------|
| 0 | PÁTIO | Código do pátio (VCEBH, VCPSB…) | Mapear p/ nome amigável |
| 1 | PLACA | Identificador único do veículo | Regex `^[A-Z]{3}\d` |
| 2 | MODELO | Nome + versão | Texto livre |
| 3 | CATEG GERENCIAL | Categoria (BÁSICO, SUV COMPACTO…) | **Pode embaralhar com [4]** |
| 4 | FAB / MOD | Ano fab + ano modelo | **Pode embaralhar com [3]** |
| 5 | (MOD) | 2º ano quando separado | Inconsistente |
| 6 | KM | Quilometragem | |
| 7 | COR | Cor | |
| 8 | UF | Estado | Sempre MG no piloto |
| 9 | **ORÇAMENTO** | **Custo de reparo (R$)** | **Opcional — vazio = sem reparo** |
| 10 | FPE | Preço de tabela/referência | |
| 11 | MARGEM | Desconto bruto (R$) | |
| 12 | PORTAL | Preço de venda | |
| 13 | % | Margem percentual (bruta) | |

### Três armadilhas de extração (já tratadas no parser de referência)

1. **Valores R$ com espaço espúrio:** `"R$ 5 8.729,00"` → limpar todos os espaços antes de parsear.
2. **Categoria/ano embaralhados** em modelos com nome longo: `[3]='SUV CO'`, `[4]='MPA2C0T2O4'` (= "COMPACTO" + "2024" intercalados). Solução: juntar `[3]+[4]`, separar dígitos (8 dígitos = fab+mod) das letras (reconstrói categoria por match contra lista fixa).
3. **`#DIV/0!`** no percentual quando FPE ausente → tratar como nulo.

---

## 3. Regras de cálculo (VALIDADAS COM O CLIENTE)

```
margem_bruta_rs   = MARGEM (coluna 11, já vem pronta)
orcamento         = ORÇAMENTO (coluna 9) ou 0 se vazio
margem_liquida_rs = margem_bruta_rs - orcamento
margem_liquida_pct= margem_liquida_rs / portal * 100
```

**Decisões confirmadas pelo cliente:**
- Reparo é **despesa extra** sobre o preço → entra subtraindo do desconto.
- App e WhatsApp mostram **bruto E líquido lado a lado** (não esconder nenhum).
- Quando não há reparo: `liquido == bruto`.
- `tem_reparo = true/false` como flag para destaque visual.

**Por que isso importa (exemplo real dos dados de 24/06):**
- COROLLA XEI (RUN3G19): margem **bruta 21%** parece ótima, mas tem R$ 22.222 de reparo → margem **líquida 4,9%**. Sem a coluna, seria uma compra ruim disfarçada de boa.
- Nos dados do piloto: **192 de 1.482** veículos têm reparo; em **21** deles o reparo derruba **5+ pontos** de margem.

---

## 4. Arquitetura

```
                                    ┌─────────────────────┐
   PDFs diários                     │   n8n (scheduler)   │
   (e-mail / pasta) ───────────────▶│  trigger + orquestra│
                                    └──────────┬──────────┘
                                               │ dispara
                                               ▼
                                    ┌─────────────────────┐
                                    │  Parser Python       │
                                    │  (pdfplumber)        │
                                    │  + validação         │
                                    └──────────┬──────────┘
                                               │ upsert
                                               ▼
                  ┌────────────────┐   ┌─────────────────────┐
   App Web ◀──────│    Supabase    │◀──│  Diff vs. snapshot  │
   (React/Vite)   │  (Postgres+RLS)│   │  de ontem           │
                  └────────────────┘   └──────────┬──────────┘
                                               │ resumo
                                               ▼
                                    ┌─────────────────────┐
                                    │  Evolution API      │
                                    │  (WhatsApp manhã)   │
                                    └─────────────────────┘
```

---

## 5. Schema do Supabase

```sql
-- Snapshot bruto por dia (idempotente por data+placa)
create table veiculos_snapshot (
  id            bigint generated always as identity primary key,
  data_ref      date not null,              -- data do arquivo (ex: 2026-06-24)
  arquivo       text not null,              -- nome do PDF de origem
  patio         text not null,
  patio_nome    text,
  placa         text not null,
  modelo        text,
  categoria     text,
  ano_fab       int,
  ano_mod       int,
  km            int,
  cor           text,
  uf            text,
  orcamento     numeric,                    -- custo de reparo (null = sem reparo)
  fpe           numeric,                    -- preço tabela
  margem_bruta  numeric,                    -- desconto R$ (coluna MARGEM)
  portal        numeric,                    -- preço venda
  margem_pct    int,                        -- % bruto do PDF
  margem_liq    numeric,                    -- calculado: margem_bruta - coalesce(orcamento,0)
  margem_liq_pct numeric,                   -- calculado
  tem_reparo    boolean default false,
  criado_em     timestamptz default now(),
  unique (data_ref, placa)
);

create index idx_snap_data on veiculos_snapshot(data_ref);
create index idx_snap_placa on veiculos_snapshot(placa);
create index idx_snap_margem on veiculos_snapshot(margem_liq_pct desc);

-- Eventos do diff diário (o que mudou de um dia pro outro)
create table eventos_diarios (
  id          bigint generated always as identity primary key,
  data_ref    date not null,
  placa       text not null,
  tipo        text not null,   -- 'novo' | 'removido' | 'preco_caiu' | 'preco_subiu' | 'reparo_novo'
  valor_ant   numeric,         -- preço/valor anterior (quando aplicável)
  valor_novo  numeric,
  delta       numeric,
  modelo      text,            -- desnormalizado p/ facilitar o resumo
  patio_nome  text,
  criado_em   timestamptz default now()
);

create index idx_ev_data on eventos_diarios(data_ref);

-- Perfil de busca do cliente (alertas personalizados)
create table preferencias (
  id              bigint generated always as identity primary key,
  margem_liq_min  int default 15,          -- alerta se margem líq >= X%
  categorias      text[],                  -- tipos de interesse (null = todos)
  preco_max       numeric,
  modelos_chave   text[],                  -- ex: {'HILUX','S10','TORO'}
  whatsapp_destino text,
  ativo           boolean default true
);
```

> **RLS:** habilitar em todas as tabelas. No piloto é single-tenant (um cliente), mas já modelar com `tenant_id` se a intenção for produtizar (ver §8).

---

## 6. Lógica do diff diário

Roda após cada ingestão, comparando `data_ref` de hoje com a **última data_ref anterior** disponível.

```
hoje    = SELECT placa, portal, orcamento FROM snapshot WHERE data_ref = :hoje
ontem   = SELECT placa, portal, orcamento FROM snapshot WHERE data_ref = :ultima_anterior

NOVOS        = placas em hoje e NÃO em ontem            → tipo 'novo'
REMOVIDOS    = placas em ontem e NÃO em hoje            → tipo 'removido' (vendido?)
PREÇO MUDOU  = placa em ambos, portal_hoje != portal_ontem
                 → 'preco_caiu' se baixou (oportunidade!), 'preco_subiu' se subiu
REPARO NOVO  = placa em ambos, orcamento passou de null→valor → 'reparo_novo'
```

**Regra de robustez crítica:** se a contagem de veículos extraída de um arquivo for muito menor que a média histórica daquele pátio (ex: < 50% do esperado), **NÃO** rodar o diff e disparar **alerta de falha** em vez do resumo. Isso evita que um PDF mal-extraído gere "200 carros removidos" falsos. (Ver §7.)

---

## 7. Validação e modo de falha (o risco nº 1 do produto)

O parser lê texto direto do PDF. Se a matriz mudar o layout, virar PDF escaneado, ou trocar colunas, a extração quebra **silenciosamente**. Blindar:

- **Contagem esperada por pátio:** guardar média móvel; se extração vier < 50% → falha.
- **% de linhas com PORTAL preenchido** deve ser ~100%. Se cair muito → layout mudou.
- **Página sem texto** = provável PDF imagem → alertar (no piloto, `CEMITERIO_VIA` extraiu 0 linhas — investigar se é escaneado ou layout distinto antes de confiar nele).
- Em qualquer falha: **não sobrescrever** o snapshot bom, mandar WhatsApp de erro pro admin (Clebson), não pro cliente.

```
if veiculos_extraidos < (media_historica_patio * 0.5):
    registrar_falha(arquivo, "extração abaixo do esperado")
    notificar_admin()
    abortar_ingestao_deste_arquivo()
```

---

## 8. Nota de produtização (futuro, não-MVP)

Os PDFs são de uma rede específica (padrão seminovos de frota). Outros compradores recebem PDFs de **outras redes, em outros layouts**. O produto real não é "um parser", é "uma plataforma que aceita o PDF de qualquer rede e aprende o layout".

- Modelar `tenant_id` desde já nas tabelas (barato agora, caro depois).
- O parser por-rede vira um "adaptador" plugável.
- Validar uso com o piloto **antes** de investir na generalização.

---

## 9. Resumo WhatsApp (formato sugerido)

```
🚗 RADAR DE ESTOQUE — {data}

🆕 NOVIDADES HOJE ({n})
1. HILUX CD STD 2.8 2023/23 — R$ 138.300 • líq 19% • Via Shopping
2. ...

📉 BAIXARAM DE PREÇO ({n})
1. COMPASS LONGITUDE — R$ 125.300 (−R$ 4.900) • Pátio Contagem

🔥 TOP MARGEM LÍQUIDA (perfil do cliente)
1. S10 CD LS 2023/24 — R$ 119.100 • líq 29% • sem reparo
2. ...

⚠️ ATENÇÃO REPARO
1. COROLLA XEI — bruto 21% mas líq 4,9% (reparo R$ 22.222)

Total: {n} veículos • {n} novos • {n} c/ reparo
```

---

## 10. App web (referência de UI)

Protótipo funcional já existe (`garagem_radar.html`) com os 1.482 veículos reais. Replicar no React/Vite:
- Tabela densa, ordenável, com margem destacada por faixa de cor.
- Colunas **bruto e líquido lado a lado**; badge quando `tem_reparo`.
- Filtros: busca livre, margem líq mínima, pátio, preço máx, tipo.
- Linha destacada para "novo hoje" (vem da tabela `eventos_diarios`).
- KPIs: total, margem 20%+, novidades hoje, maior margem líquida.

---

## 11. Ordem de implementação sugerida

1. **Parser + validação** (já validado — usar `parser_referencia.py` como base).
2. **Schema Supabase** + ingestão (upsert idempotente por data+placa).
3. **Diff diário** + tabela de eventos.
4. **Resumo WhatsApp** via Evolution API + agendamento n8n.
5. **App web** lendo do Supabase.
6. (Depois) Preferências/alertas personalizados.

> O parser de referência validado acompanha este spec em `parser_referencia.py`.