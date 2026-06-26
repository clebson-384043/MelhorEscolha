# Radar de Estoque

Análise diária de estoque de veículos para agência de carros. Ingere PDFs de
pátios, calcula margens (bruta e líquida de reparo), detecta o que mudou desde
ontem e entrega via app web + resumo no WhatsApp.

## Estrutura
- `BOT-SPEC.md` — especificação técnica completa
- `CLAUDE.md` — contexto pro Claude Code
- `pipeline/` — extração de PDF, ingestão, diff, notificação
- `supabase/` — schema do banco
- `web/` — app React/Vite
- `n8n/` — fluxo de orquestração
- `docs/prototipo.html` — referência visual da UI

## Rodar o pipeline (local)
```bash
cd pipeline
pip install -r requirements.txt
cp ../.env.example ../.env   # e preencha
python ingest.py ./entrada/PATIO_CONTAGEM.pdf
```

## Rodar o app web
```bash
cd web
npm install
npm run dev
```

## Ordem de implementação
parser → schema/ingestão → diff → WhatsApp → app web (detalhes no BOT-SPEC.md §11)