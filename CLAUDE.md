# CLAUDE.md — Radar de Estoque

Contexto permanente do projeto. Leia antes de qualquer tarefa.

## O que é
Ferramenta de análise diária de estoque de veículos para uma agência de carros.
Ingere 6 PDFs/dia (um por pátio), calcula margens, detecta o que mudou desde
ontem (diff diário) e entrega via app web + resumo no WhatsApp.

**Especificação completa em `BOT-SPEC.md`. Sempre consulte antes de implementar.**

## Stack
- Pipeline: Python (pdfplumber) → Supabase (Postgres + RLS)
- Orquestração: n8n (agendamento + trigger)
- WhatsApp: Evolution API
- App web: React 18 + Vite + TypeScript

## Regras de negócio que NÃO podem ser violadas
- `margem_liquida = margem_bruta − orcamento` (reparo é despesa extra).
- App e WhatsApp mostram bruto E líquido lado a lado. Nunca esconder um deles.
- `orcamento` (custo de reparo) é OPCIONAL — vazio significa "sem reparo".
- Validação crítica: se a extração de um PDF vier < 50% do esperado, NÃO rodar
  o diff. Alertar o admin (Clebson), não o cliente. (Ver §7 do spec.)

## Ordem de implementação (do spec, §11)
1. parser + validação  2. schema + ingestão  3. diff  4. WhatsApp  5. app web

## Convenções
- Diffs aprovados explicitamente antes de aplicar.
- Parser já validado em `pipeline/parser.py` — é o ponto de partida, não reescrever do zero.
- Segredos só em `.env` (nunca commitar). Template em `.env.example`.

## Pendência conhecida
- `CEMITERIO_VIA` extraiu 0 linhas (possível PDF escaneado/layout diferente).
  Investigar antes de confiar em produção.