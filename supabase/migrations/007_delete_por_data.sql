-- 007_delete_por_data.sql
-- Permite que admins autenticados excluam registros por data (limpeza manual).

create policy "snapshot_delete" on veiculos_snapshot
  for delete using (auth.role() = 'authenticated');

create policy "eventos_delete" on eventos_diarios
  for delete using (auth.role() = 'authenticated');

create policy "proc_delete" on processamentos
  for delete using (auth.role() = 'authenticated');
