-- 001_initial_schema.sql
-- Schema inicial do Radar de Estoque (§5 do BOT-SPEC.md).
-- tenant_id adicionado em todas as tabelas para futura produtização (§8).
-- No piloto MVP o default 'piloto' é transparente.

-- =====================================================================
-- Snapshot bruto por dia (upsert idempotente por tenant+data+placa)
-- =====================================================================
create table if not exists veiculos_snapshot (
  id              bigint generated always as identity primary key,
  tenant_id       text        not null default 'piloto',
  data_ref        date        not null,
  arquivo         text        not null,
  patio           text        not null,
  patio_nome      text,
  placa           text        not null,
  modelo          text,
  categoria       text,
  ano_fab         int,
  ano_mod         int,
  km              int,
  cor             text,
  uf              text,
  orcamento       numeric,              -- custo de reparo (null = sem reparo)
  fpe             numeric,              -- preço tabela
  margem_bruta    numeric,              -- desconto R$ (coluna MARGEM do PDF)
  portal          numeric,              -- preço de venda
  margem_pct      int,                  -- % bruto extraído do PDF
  margem_liq      numeric,              -- calculado: margem_bruta - coalesce(orcamento,0)
  margem_liq_pct  numeric,              -- calculado
  tem_reparo      boolean     default false,
  criado_em       timestamptz default now(),
  unique (tenant_id, data_ref, placa)
);

create index if not exists idx_snap_tenant  on veiculos_snapshot(tenant_id);
create index if not exists idx_snap_data    on veiculos_snapshot(data_ref);
create index if not exists idx_snap_placa   on veiculos_snapshot(placa);
create index if not exists idx_snap_margem  on veiculos_snapshot(margem_liq_pct desc);

alter table veiculos_snapshot enable row level security;

-- MVP single-tenant: leitura para autenticados, escrita só via service_role (bypassa RLS)
create policy "snapshot_leitura" on veiculos_snapshot
  for select using (auth.role() = 'authenticated');

-- =====================================================================
-- Eventos do diff diário
-- =====================================================================
create table if not exists eventos_diarios (
  id          bigint generated always as identity primary key,
  tenant_id   text        not null default 'piloto',
  data_ref    date        not null,
  placa       text        not null,
  tipo        text        not null
    check (tipo in ('novo', 'removido', 'preco_caiu', 'preco_subiu', 'reparo_novo')),
  valor_ant   numeric,
  valor_novo  numeric,
  delta       numeric,
  modelo      text,
  patio_nome  text,
  criado_em   timestamptz default now()
);

create index if not exists idx_ev_tenant on eventos_diarios(tenant_id);
create index if not exists idx_ev_data   on eventos_diarios(data_ref);

alter table eventos_diarios enable row level security;

create policy "eventos_leitura" on eventos_diarios
  for select using (auth.role() = 'authenticated');

-- =====================================================================
-- Perfil de busca / alertas personalizados do cliente
-- =====================================================================
create table if not exists preferencias (
  id               bigint generated always as identity primary key,
  tenant_id        text    not null default 'piloto',
  margem_liq_min   int     default 15,
  categorias       text[],
  preco_max        numeric,
  modelos_chave    text[],
  whatsapp_destino text,
  ativo            boolean default true
);

alter table preferencias enable row level security;

create policy "preferencias_leitura" on preferencias
  for select using (auth.role() = 'authenticated');
