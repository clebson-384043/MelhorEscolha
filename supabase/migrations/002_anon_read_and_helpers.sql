-- 002_anon_read_and_helpers.sql
-- Permite leitura via anon key (app web do piloto sem autenticação) e
-- adiciona view de datas disponíveis para o seletor do app.

-- Políticas anon (RLS já habilitado pela migration 001)
create policy "snapshot_leitura_anon" on veiculos_snapshot
  for select using (true);

create policy "eventos_leitura_anon" on eventos_diarios
  for select using (true);

create policy "preferencias_leitura_anon" on preferencias
  for select using (true);

-- View de datas disponíveis por tenant (p/ seletor do app web)
create or replace view datas_disponiveis as
  select distinct tenant_id, data_ref
  from veiculos_snapshot
  order by data_ref desc;
