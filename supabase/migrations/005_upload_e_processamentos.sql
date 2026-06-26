-- 005_upload_e_processamentos.sql
-- Bucket de armazenamento de PDFs + tabela de controle de processamento

-- ── Storage bucket ────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pdfs',
  'pdfs',
  false,
  20971520,   -- 20 MB por arquivo
  array['application/pdf']
)
on conflict (id) do nothing;

-- Admins autenticados podem fazer upload
create policy "upload_autenticado" on storage.objects
  for insert to authenticated
  using (bucket_id = 'pdfs');

-- Admins podem ler/deletar os próprios uploads
create policy "leitura_autenticado" on storage.objects
  for select to authenticated
  using (bucket_id = 'pdfs');

create policy "delete_autenticado" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pdfs');

-- ── Tabela de processamentos ──────────────────────────────────────────────
create table if not exists processamentos (
  id              bigint generated always as identity primary key,
  tenant_id       text        not null default 'piloto',
  data_ref        date        not null,
  arquivo         text        not null,
  storage_path    text        not null,
  status          text        not null default 'pendente'
    check (status in ('pendente','processando','ok','erro','aviso')),
  veiculos        int,
  alertas         jsonb       default '[]',
  erro            text,
  criado_em       timestamptz default now(),
  processado_em   timestamptz
);

create index if not exists idx_proc_tenant_data on processamentos(tenant_id, data_ref);

alter table processamentos enable row level security;

create policy "proc_leitura" on processamentos
  for select using (auth.role() = 'authenticated');
create policy "proc_escrita" on processamentos
  for all using (auth.role() = 'service_role');
